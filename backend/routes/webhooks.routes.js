/**
 * Webhook CRUD and test routes.
 */
const { v4: uuid } = require('uuid');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { validateFields } = require('../lib/helpers');
const { addAudit } = require('../lib/audit');
const { fireWebhooks } = require('../lib/notifications');
const auth = require('../middleware/auth');
const requireLicense = require('../middleware/license');

module.exports = function(app) {
  app.get('/api/webhooks', auth('webhooks.manage'), requireLicense(), (req, res) => { res.json(ctx.webhooks); });

  app.post('/api/webhooks', auth('webhooks.manage'), (req, res) => {
    const { event, url, template, retryEnabled, timeout, headers } = req.body;
    const error = validateFields(req.body, {
      event: { required: true, type: 'string', minLength: 2 },
      url: { required: true, type: 'string', pattern: /^https?:\/\// },
      template: { required: false, type: 'string' },
      retryEnabled: { required: false, type: 'boolean' },
      timeout: { required: false, type: 'number' },
      headers: { required: false, type: 'object' },
    });
    if (error) return res.status(400).json({ error });
    const isDiscord = url.includes('discord.com/api/webhooks');
    let isValidJson = false;
    if (template) { try { JSON.parse(template); isValidJson = true; } catch {} }
    const wh = {
      id: uuid(), event, url, template: template || (isDiscord ? JSON.stringify({ content: '**{server.name}** — {timestamp}' }) : ''),
      retryEnabled: retryEnabled !== false, timeout: timeout || 60000,
      headers: headers || {}, enabled: true, isDiscord, isValidJson,
      deliveries: [], createdAt: new Date().toISOString(),
    };
    ctx.webhooks.push(wh); saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks);
    addAudit(req.user.id, req.user.username, 'webhook.create', `Created webhook for ${event}`);
    res.json(wh);
  });

  app.patch('/api/webhooks/:id', auth('webhooks.manage'), (req, res) => {
    const wh = ctx.webhooks.find(w => w.id === req.params.id);
    if (!wh) return res.status(404).json({ error: 'Webhook not found' });
    const allowed = ['event','url','template','retryEnabled','timeout','headers','enabled'];
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
    try { await fireWebhooks(wh.event, { serverId: 'test', serverName: 'Test Server' }); res.json({ message: 'Test fired' }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });
};
