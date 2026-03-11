/**
 * Notifications, Discord webhooks, and custom webhook delivery.
 */
const crypto = require('crypto');
const dns = require('dns');
const { v4: uuid } = require('uuid');
const logger = require('./logger');
const ctx = require('./context');
const { saveJSON, loadJSON } = require('./data-store');
const { sanitizeString } = require('./helpers');
const { MAX_NOTIFICATION_COUNT, MAX_WEBHOOK_DELIVERIES } = require('./constants');

/** Notifications older than this are pruned (7 days) */
const NOTIFICATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Check if an IP address belongs to a private/internal range.
 * Covers: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *         169.254.0.0/16, ::1, fc00::/7
 */
function isPrivateIP(ip) {
  // IPv6 loopback
  if (ip === '::1') return true;
  // IPv6 unique-local (fc00::/7 covers fc00:: through fdff::)
  if (/^f[cd]/i.test(ip)) return true;
  // IPv4 private ranges
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    if (parts[0] === 127) return true;                                      // 127.0.0.0/8
    if (parts[0] === 10) return true;                                       // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;  // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;                  // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;                  // 169.254.0.0/16
    if (parts[0] === 0) return true;                                        // 0.0.0.0/8
  }
  return false;
}

/**
 * SSRF protection: validate that a webhook URL does not resolve to a
 * private/internal IP address. Returns true if private/blocked, false if safe.
 */
async function isPrivateUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const { address } = await dns.promises.lookup(parsed.hostname);
    if (isPrivateIP(address)) {
      logger.warn({ url: urlString, resolvedIP: address }, 'Webhook URL resolves to private IP — blocked (SSRF protection)');
      return true;
    }
    return false;
  } catch (err) {
    logger.warn({ url: urlString, err: err.message }, 'DNS lookup failed for webhook URL — skipping');
    return true; // Fail closed: treat DNS failures as unsafe
  }
}

/**
 * Supported webhook event types with human-readable descriptions.
 */
const WEBHOOK_EVENTS = {
  'agent.ready':          'Agent startup complete',
  'session.begin':        'User connected to dashboard',
  'session.ended':        'User disconnected from dashboard',
  'server.started':       'Server process started',
  'server.stopped':       'Server process stopped',
  'server.crashed':       'Server crash detected',
  'server.restarted':     'Server restart completed',
  'server.health':        'Server health alert triggered',
  'title.updated':        'Game update available',
  'mod.updated':          'Mod update available',
  'mod.installed':        'Mod installed on server',
  'mod.removed':          'Mod removed from server',
  'server.updated_title': 'Game update applied to server',
  'server.updated_mod':   'Mod update applied to server',
  'player.joined':        'Player connected',
  'player.left':          'Player disconnected',
  'player.kick':          'Player kicked from server',
  'player.ban':           'Player banned from server',
  'backup.created':       'Backup created',
  'backup.restored':      'Backup restored',
  'scheduler.executed':   'Scheduled task executed',
  'store.purchased':      'Store purchase completed',
  'player.unban':         'Player unbanned from server',
};

/** Delivery record TTL: 7 days in milliseconds */
const DELIVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const NOTIFICATION_ICONS = {
  'server.started': '🟢', 'server.stopped': '🔴', 'server.crashed': '💥', 'server.restarted': '🔄',
  'server.health': '⚠️', 'player.join': '👋', 'player.leave': '👤', 'player.kick': '🦶',
  'player.ban': '🔨', 'mod.installed': '📦', 'mod.updated': '📦', 'mod.removed': '🗑️',
  'scheduler.task': '📅', 'backup.created': '💾', 'update.available': '🆕', 'rcon.command': '🖥️',
  'store.purchased': '🛒', 'player.unban': '✅',
};

/**
 * Load notifications from persistent storage on startup.
 * Prunes notifications older than 7 days.
 */
function loadNotifications() {
  const stored = loadJSON(ctx.CONFIG.dataDir, 'notifications.json', []);
  const now = Date.now();
  const notificationsToKeep = stored.filter(n => {
    const created = new Date(n.timestamp).getTime();
    const age = now - created;
    return age < NOTIFICATION_RETENTION_MS;
  });
  ctx.notifications = notificationsToKeep;
  logger.info({ count: notificationsToKeep.length }, 'Loaded notifications from persistent storage');
}

/**
 * Add an in-app notification, persist, and emit via Socket.IO.
 */
function addNotification(serverId, type, title, message, severity) {
  severity = severity || 'info';
  const n = {
    id: uuid(),
    serverId,
    type,
    title: sanitizeString(title),
    message: sanitizeString(message),
    severity,
    icon: NOTIFICATION_ICONS[type] || '🔔',
    timestamp: new Date().toISOString(),
    read: false,
  };
  ctx.notifications.unshift(n);

  // Enforce max notification count with FIFO eviction
  if (ctx.notifications.length > MAX_NOTIFICATION_COUNT) {
    ctx.notifications.length = MAX_NOTIFICATION_COUNT;
  }

  // Persist to disk
  saveJSON(ctx.CONFIG.dataDir, 'notifications.json', ctx.notifications);

  // Emit via Socket.IO
  if (ctx.io) ctx.io.emit('notification', n);

  return n;
}

/**
 * Send a message to the configured Discord webhook.
 */
async function sendDiscordWebhook(content, embeds) {
  if (!ctx.CONFIG.webhookUrl) return;
  try {
    // SSRF protection: block webhooks targeting private/internal IPs
    if (await isPrivateUrl(ctx.CONFIG.webhookUrl)) {
      logger.warn({ url: ctx.CONFIG.webhookUrl }, 'Discord webhook URL resolves to private IP — blocked');
      return;
    }
    await fetch(ctx.CONFIG.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds }),
    });
  } catch (err) {
    logger.error({ err }, 'Discord webhook failed');
  }
}

/**
 * Escape a string for safe insertion into a JSON template string.
 */
function jsonSafeValue(val) {
  return String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/**
 * Replace all {{variable}} and legacy {variable} placeholders in a template string.
 * Works on the raw JSON string so every field (embeds, fields, content, etc.) is handled.
 */
function substituteVariables(templateStr, eventType, data) {
  const now = new Date();
  const vars = {
    'server':       jsonSafeValue(data.serverName || 'Unknown'),
    'server_id':    jsonSafeValue(data.serverId || ''),
    'timestamp':    jsonSafeValue(now.toLocaleString()),
    'date_iso':     now.toISOString(),
    'event':        jsonSafeValue(eventType),
    'reason':       jsonSafeValue(data.reason || 'N/A'),
    'player':       jsonSafeValue(data.playerId || data.playerName || ''),
    'player_name':  jsonSafeValue(data.playerName || ''),
    'player_id':    jsonSafeValue(data.playerId || ''),
    'mod':          jsonSafeValue(data.modName || ''),
    'mod_id':       jsonSafeValue(data.modId || ''),
    'build':        jsonSafeValue(data.build || ''),
    'action':       jsonSafeValue(data.action || ''),
    'job':          jsonSafeValue(data.job || ''),
    // Legacy aliases
    'server.name':  jsonSafeValue(data.serverName || 'Unknown'),
    'server.id':    jsonSafeValue(data.serverId || ''),
  };

  let result = templateStr;
  for (const [key, value] of Object.entries(vars)) {
    const escaped = key.replace(/\./g, '\\.');
    // {{double-brace}} (preferred)
    result = result.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, 'g'), value);
    // {single-brace} (legacy)
    result = result.replace(new RegExp(`(?<!\\{)\\{${escaped}\\}(?!\\})`, 'g'), value);
  }
  return result;
}

/**
 * Prune delivery records older than 7 days from a webhook's deliveries array.
 * Called on-access when adding a new delivery to avoid needing a timer.
 */
function pruneDeliveries(wh) {
  if (!wh.deliveries || wh.deliveries.length === 0) return;
  const cutoff = Date.now() - DELIVERY_TTL_MS;
  wh.deliveries = wh.deliveries.filter(d => new Date(d.timestamp).getTime() > cutoff);
}

/**
 * Check if a webhook should fire for a given event type.
 * If the webhook has a non-empty `events` array, the event must be in that list.
 * Also checks the legacy `event` field for backward compatibility.
 */
function webhookMatchesEvent(wh, eventType) {
  // New multi-event filtering: if `events` array is present and non-empty, check it
  if (Array.isArray(wh.events) && wh.events.length > 0) {
    return wh.events.includes(eventType);
  }
  // Legacy single-event field for backward compatibility
  if (wh.event) {
    return wh.event === eventType;
  }
  // No filter at all — fire for everything
  return true;
}

/**
 * Check if a webhook should fire for a given server.
 * If the webhook has a non-empty `serverIds` array, the server must be in that list.
 * Empty or missing serverIds means the webhook fires for all servers.
 */
function webhookMatchesServer(wh, data) {
  if (Array.isArray(wh.serverIds) && wh.serverIds.length > 0) {
    return wh.serverIds.includes(data.serverId);
  }
  return true;
}

/**
 * Deliver a single webhook. Separated from fireWebhooks so retry logic
 * does not mutate the webhook object or re-filter.
 */
async function deliverWebhook(wh, eventType, data, attemptNum, maxRetries) {
  // SSRF protection: block webhooks targeting private/internal IPs
  if (await isPrivateUrl(wh.url)) {
    logger.warn({ webhookId: wh.id, url: wh.url, event: eventType }, 'Skipping webhook — URL resolves to private IP');
    return;
  }

  const idempotenceToken = crypto.randomUUID();
  const standardHeaders = {
    'Content-Type': 'application/json',
    'X-WebHook': 'Citadel Agent',
    'X-WebHook-Id': wh.id,
    'X-WebHook-Event': eventType,
    'X-Event-Idempotence': idempotenceToken,
  };

  try {
    if (wh.url.includes('discord.com/api/webhooks')) {
      // Substitute variables across the ENTIRE template, then parse
      const raw = substituteVariables(wh.template || '{}', eventType, data);
      let body;
      try { body = JSON.parse(raw); } catch { body = { content: `**${eventType}** event fired` }; }
      // Ensure there is at least some content if template was empty
      if (!body.content && (!body.embeds || body.embeds.length === 0)) {
        body.content = `**${eventType}** event fired`;
      }
      await fetch(wh.url, {
        method: 'POST',
        headers: standardHeaders,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(wh.timeout || 60000),
      });
    } else {
      const payload = { event: eventType, timestamp: new Date().toISOString(), data };
      await fetch(wh.url, {
        method: 'POST',
        headers: { ...standardHeaders, ...(wh.headers || {}) },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(wh.timeout || 60000),
      });
    }
    // Record success
    if (!wh.deliveries) wh.deliveries = [];
    pruneDeliveries(wh);
    wh.deliveries.unshift({
      timestamp: new Date().toISOString(), status: 'success', event: eventType,
      idempotenceToken, attempt: attemptNum,
    });
    if (wh.deliveries.length > MAX_WEBHOOK_DELIVERIES) wh.deliveries = wh.deliveries.slice(0, MAX_WEBHOOK_DELIVERIES);
    saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks);
  } catch (err) {
    // Record failure
    if (!wh.deliveries) wh.deliveries = [];
    pruneDeliveries(wh);
    wh.deliveries.unshift({
      timestamp: new Date().toISOString(), status: 'failed', event: eventType,
      error: err.message, idempotenceToken, attempt: attemptNum,
    });
    if (wh.deliveries.length > MAX_WEBHOOK_DELIVERIES) wh.deliveries = wh.deliveries.slice(0, MAX_WEBHOOK_DELIVERIES);
    saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks);

    // Retry with exponential backoff — use separate counter, do NOT mutate wh._retryCount
    if (wh.retryEnabled && attemptNum < maxRetries) {
      const nextAttempt = attemptNum + 1;
      setTimeout(() => deliverWebhook(wh, eventType, data, nextAttempt, maxRetries), 5000 * nextAttempt);
    }
  }
}

/**
 * Fire all matching custom webhooks for a given event type.
 * Supports Discord webhook format (embeds + variable substitution) and generic JSON POST.
 * Retries up to `retryCount` times (default 3) on failure if retryEnabled is set.
 * Includes standard HTTP headers, idempotence tokens, event filtering, and delivery TTL cleanup.
 * Also forwards events to Citadel Cloud when connected.
 */
async function fireWebhooks(eventType, data) {
  const matching = ctx.webhooks.filter(w => w.enabled && webhookMatchesEvent(w, eventType) && webhookMatchesServer(w, data));
  for (const wh of matching) {
    const maxRetries = Math.min(Math.max(parseInt(wh.retryCount, 10) || 3, 1), 10);
    await deliverWebhook(wh, eventType, data, 1, maxRetries);
  }

  // Forward event to Citadel Cloud (lazy-loaded to avoid circular dependency)
  try {
    const cloudAgent = require('./cloud-agent');
    if (cloudAgent.isEnabled() && data.serverId) {
      cloudAgent.pushEvent(data.serverId, eventType, data);
    }
  } catch { /* cloud-agent not available */ }
}

module.exports = { addNotification, loadNotifications, sendDiscordWebhook, fireWebhooks, NOTIFICATION_ICONS, WEBHOOK_EVENTS, isPrivateIP };
