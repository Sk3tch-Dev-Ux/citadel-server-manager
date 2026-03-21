/**
 * Webhook CRUD, test, and event listing routes.
 */
const { v4: uuid } = require('uuid');
const dns = require('dns').promises;
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { validateFields } = require('../lib/helpers');
const { addAudit } = require('../lib/audit');
const { fireWebhooks, WEBHOOK_EVENTS, isPrivateIP } = require('../lib/notifications');
const auth = require('../middleware/auth');
const logger = require('../lib/logger');

/** Delivery record TTL: 7 days in milliseconds */
const DELIVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Max payload size for Discord webhooks (characters) */
const DISCORD_MAX_PAYLOAD_CHARS = 2000;

/** Max payload size for generic webhooks (bytes) */
const GENERIC_MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Validate webhook payload template size at creation time.
 * Returns { valid: boolean, error: string|null }
 */
function validatePayloadSize(url, template) {
  const isDiscord = url.includes('discord.com/api/webhooks');

  if (isDiscord) {
    // For Discord, check the template content length
    if (template && template.length > DISCORD_MAX_PAYLOAD_CHARS) {
      return {
        valid: false,
        error: `Discord webhook payload template exceeds ${DISCORD_MAX_PAYLOAD_CHARS} characters (got ${template.length})`
      };
    }
  } else {
    // For generic webhooks, estimate the rendered payload size
    const estimatedPayload = JSON.stringify({
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { serverName: 'Test Server', serverId: 'test', reason: 'Test message' }
    });
    const templateSize = template ? Buffer.byteLength(template, 'utf8') : 0;
    const totalEstimate = templateSize + estimatedPayload.length;

    if (totalEstimate > GENERIC_MAX_PAYLOAD_BYTES) {
      return {
        valid: false,
        error: `Generic webhook payload exceeds ${GENERIC_MAX_PAYLOAD_BYTES} bytes (estimated ${totalEstimate})`
      };
    }
  }

  return { valid: true, error: null };
}

/**
 * Validate webhook URL for SSRF at creation time.
 * Resolves the hostname and checks against private IP ranges.
 * Returns { valid: boolean, error: string|null }
 */
async function validateWebhookUrlSsrf(urlString) {
  try {
    const parsed = new URL(urlString);
    const address = await dns.lookup(parsed.hostname).then(result => result.address);

    if (isPrivateIP(address)) {
      return {
        valid: false,
        error: `Webhook URL resolves to private IP (${address}). SSRF protection blocks internal addresses.`
      };
    }

    // Also check for metadata service endpoints
    if (address === '169.254.169.254') {
      return {
        valid: false,
        error: 'Webhook URL resolves to metadata service endpoint. This is blocked for security.'
      };
    }

    return { valid: true, error: null };
  } catch (err) {
    // DNS resolution failed — fail closed for safety
    return {
      valid: false,
      error: `Failed to validate webhook URL: ${err.message}. SSRF check failed closed.`
    };
  }
}

/** Prune delivery records older than 7 days from all webhooks. */
function pruneAllDeliveries() {
  const cutoff = Date.now() - DELIVERY_TTL_MS;
  let pruned = false;
  for (const wh of ctx.webhooks) {
    if (!wh.deliveries || wh.deliveries.length === 0) continue;
    const before = wh.deliveries.length;
    wh.deliveries = wh.deliveries.filter(d => new Date(d.timestamp).getTime() > cutoff);
    if (wh.deliveries.length !== before) pruned = true;
  }
  if (pruned) saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks);
}

module.exports = function(app) {
  /**
   * GET /api/webhooks/events — Return all supported event types with descriptions.
   * This must be registered BEFORE the parameterized /api/webhooks/:id routes.
   */
  app.get('/api/webhooks/events', auth('webhooks.manage'), (req, res) => {
    res.json(WEBHOOK_EVENTS);
  });

  app.get('/api/webhooks', auth('webhooks.manage'), (req, res) => {
    // Prune old delivery records on list access
    pruneAllDeliveries();
    res.json(ctx.webhooks);
  });

  app.post('/api/webhooks', auth('webhooks.manage'), async (req, res) => {
    const { event, url, template, retryEnabled, retryCount, timeout, headers, events, serverIds } = req.body;
    const error = validateFields(req.body, {
      event: { required: true, type: 'string', minLength: 2 },
      url: { required: true, type: 'string', pattern: /^https?:\/\// },
      template: { required: false, type: 'string' },
      retryEnabled: { required: false, type: 'boolean' },
      retryCount: { required: false, type: 'number' },
      timeout: { required: false, type: 'number' },
      headers: { required: false, type: 'object' },
    });
    if (error) return res.status(400).json({ error });

    // Validate events array if provided
    if (events !== undefined) {
      if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be an array' });
      const validEventTypes = Object.keys(WEBHOOK_EVENTS);
      const invalid = events.filter(e => !validEventTypes.includes(e));
      if (invalid.length > 0) return res.status(400).json({ error: `Invalid event types: ${invalid.join(', ')}` });
    }

    // Payload size validation at creation time
    const payloadValidation = validatePayloadSize(url, template);
    if (!payloadValidation.valid) {
      logger.warn({ url, reason: payloadValidation.error }, 'Webhook creation blocked by payload size validation');
      return res.status(400).json({ error: payloadValidation.error });
    }

    // SSRF validation at creation time
    const ssrfValidation = await validateWebhookUrlSsrf(url);
    if (!ssrfValidation.valid) {
      logger.warn({ url, reason: ssrfValidation.error }, 'Webhook creation blocked by SSRF validation');
      return res.status(400).json({ error: ssrfValidation.error });
    }

    // Validate retryCount range
    let parsedRetryCount = 3;
    if (retryCount !== undefined) {
      parsedRetryCount = Math.min(Math.max(parseInt(retryCount, 10) || 3, 1), 10);
    }

    const isDiscord = url.includes('discord.com/api/webhooks');
    let isValidJson = false;
    if (template) { try { JSON.parse(template); isValidJson = true; } catch {} }
    const wh = {
      id: uuid(), event, url, template: template || (isDiscord ? JSON.stringify({ content: '**{server.name}** — {timestamp}' }) : ''),
      retryEnabled: retryEnabled !== false, retryCount: parsedRetryCount,
      timeout: timeout || 60000,
      headers: headers || {}, enabled: true, isDiscord, isValidJson,
      events: Array.isArray(events) ? events : [],
      serverIds: Array.isArray(serverIds) ? serverIds : [],
      deliveries: [], createdAt: new Date().toISOString(),
    };
    ctx.webhooks.push(wh); saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks);
    addAudit(req.user.id, req.user.username, 'webhook.create', `Created webhook for ${event}`);
    res.json(wh);
  });

  app.patch('/api/webhooks/:id', auth('webhooks.manage'), async (req, res) => {
    const wh = ctx.webhooks.find(w => w.id === req.params.id);
    if (!wh) return res.status(404).json({ error: 'Webhook not found' });

    // Validate events array if provided
    if (req.body.events !== undefined) {
      if (!Array.isArray(req.body.events)) return res.status(400).json({ error: 'events must be an array' });
      const validEventTypes = Object.keys(WEBHOOK_EVENTS);
      const invalid = req.body.events.filter(e => !validEventTypes.includes(e));
      if (invalid.length > 0) return res.status(400).json({ error: `Invalid event types: ${invalid.join(', ')}` });
    }

    // Payload size validation if template is being changed
    const checkUrl = req.body.url || wh.url;
    const checkTemplate = req.body.template !== undefined ? req.body.template : wh.template;
    const payloadValidation = validatePayloadSize(checkUrl, checkTemplate);
    if (!payloadValidation.valid) {
      logger.warn({ url: checkUrl, reason: payloadValidation.error }, 'Webhook update blocked by payload size validation');
      return res.status(400).json({ error: payloadValidation.error });
    }

    // SSRF validation if URL is being changed
    if (req.body.url !== undefined && req.body.url !== wh.url) {
      const ssrfValidation = await validateWebhookUrlSsrf(req.body.url);
      if (!ssrfValidation.valid) {
        logger.warn({ url: req.body.url, reason: ssrfValidation.error }, 'Webhook update blocked by SSRF validation');
        return res.status(400).json({ error: ssrfValidation.error });
      }
    }

    // Validate retryCount range if provided
    if (req.body.retryCount !== undefined) {
      req.body.retryCount = Math.min(Math.max(parseInt(req.body.retryCount, 10) || 3, 1), 10);
    }

    // Validate serverIds array if provided
    if (req.body.serverIds !== undefined) {
      if (!Array.isArray(req.body.serverIds)) return res.status(400).json({ error: 'serverIds must be an array' });
    }

    const allowed = ['event','url','template','retryEnabled','retryCount','timeout','headers','enabled','events','serverIds'];
    for (const key of allowed) { if (req.body[key] !== undefined) wh[key] = req.body[key]; }
    wh.isDiscord = wh.url.includes('discord.com/api/webhooks');
    if (wh.template) { try { JSON.parse(wh.template); wh.isValidJson = true; } catch { wh.isValidJson = false; } }
    saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks);
    res.json(wh);
  });

  app.delete('/api/webhooks/:id', auth('webhooks.manage'), (req, res) => {
    ctx.webhooks = ctx.webhooks.filter(w => w.id !== req.params.id);
    saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks);
    addAudit(req.user.id, req.user.username, 'webhook.delete', 'Deleted webhook');
    res.json({ message: 'Deleted' });
  });

  app.get('/api/webhooks/:id/deliveries', auth('webhooks.manage'), (req, res) => {
    const wh = ctx.webhooks.find(w => w.id === req.params.id);
    res.json(wh?.deliveries || []);
  });

  app.post('/api/webhooks/:id/test', auth('webhooks.manage'), async (req, res) => {
    const wh = ctx.webhooks.find(w => w.id === req.params.id);
    if (!wh) return res.status(404).json({ error: 'Not found' });
    // Fire using the webhook's primary event so it matches its own filter
    // Use the first configured serverId (or 'test') so server filtering doesn't block the test
    const testServerId = Array.isArray(wh.serverIds) && wh.serverIds.length > 0 ? wh.serverIds[0] : 'test';
    const testServer = ctx.servers.find(s => s.id === testServerId);
    try { await fireWebhooks(wh.event, { serverId: testServerId, serverName: testServer?.name || 'Test Server' }); res.json({ message: 'Test fired' }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });
};
