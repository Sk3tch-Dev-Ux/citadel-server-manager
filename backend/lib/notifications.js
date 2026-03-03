/**
 * Notifications, Discord webhooks, and custom webhook delivery.
 */
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const logger = require('./logger');
const ctx = require('./context');
const { saveJSON } = require('./data-store');
const { sanitizeString } = require('./helpers');

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
  'title.updated':        'Game update available',
  'mod.updated':          'Mod update available',
  'server.updated_title': 'Game update applied to server',
  'server.updated_mod':   'Mod update applied to server',
  'player.joined':        'Player connected',
  'player.left':          'Player disconnected',
  'backup.created':       'Backup created',
  'backup.restored':      'Backup restored',
  'scheduler.executed':   'Scheduled task executed',
};

/** Delivery record TTL: 7 days in milliseconds */
const DELIVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const NOTIFICATION_ICONS = {
  'server.started': '🟢', 'server.stopped': '🔴', 'server.crashed': '💥', 'server.restarted': '🔄',
  'server.health': '⚠️', 'player.join': '👋', 'player.leave': '👤', 'player.kick': '🦶',
  'player.ban': '🔨', 'mod.installed': '📦', 'mod.updated': '📦', 'mod.removed': '🗑️',
  'scheduler.task': '📅', 'backup.created': '💾', 'update.available': '🆕', 'rcon.command': '🖥️',
};

/**
 * Add an in-app notification and emit via Socket.IO.
 */
function addNotification(serverId, type, title, message, severity) {
  severity = severity || 'info';
  const n = {
    id: uuid(), serverId, type, title: sanitizeString(title), message: sanitizeString(message), severity,
    icon: NOTIFICATION_ICONS[type] || '🔔',
    timestamp: new Date().toISOString(), read: false,
  };
  ctx.notifications.unshift(n);
  if (ctx.notifications.length > 200) ctx.notifications.length = 200;
  if (ctx.io) ctx.io.emit('notification', n);
  return n;
}

/**
 * Send a message to the configured Discord webhook.
 */
async function sendDiscordWebhook(content, embeds) {
  if (!ctx.CONFIG.webhookUrl) return;
  try {
    const fetch = (await import('node-fetch')).default;
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
    'server':     jsonSafeValue(data.serverName || 'Unknown'),
    'server_id':  jsonSafeValue(data.serverId || ''),
    'timestamp':  jsonSafeValue(now.toLocaleString()),
    'date_iso':   now.toISOString(),
    'event':      jsonSafeValue(eventType),
    'reason':     jsonSafeValue(data.reason || 'N/A'),
    'player':     jsonSafeValue(data.playerId || data.playerName || ''),
    'mod':        jsonSafeValue(data.modName || ''),
    // Legacy aliases
    'server.name': jsonSafeValue(data.serverName || 'Unknown'),
    'server.id':   jsonSafeValue(data.serverId || ''),
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
 * Deliver a single webhook. Separated from fireWebhooks so retry logic
 * does not mutate the webhook object or re-filter.
 */
async function deliverWebhook(wh, eventType, data, attemptNum, maxRetries) {
  const idempotenceToken = crypto.randomUUID();
  const standardHeaders = {
    'Content-Type': 'application/json',
    'X-WebHook': 'Citadel Agent',
    'X-WebHook-Id': wh.id,
    'X-WebHook-Event': eventType,
    'X-Event-Idempotence': idempotenceToken,
  };

  try {
    const fetch = (await import('node-fetch')).default;
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
    if (wh.deliveries.length > 50) wh.deliveries = wh.deliveries.slice(0, 50);
    saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks);
  } catch (err) {
    // Record failure
    if (!wh.deliveries) wh.deliveries = [];
    pruneDeliveries(wh);
    wh.deliveries.unshift({
      timestamp: new Date().toISOString(), status: 'failed', event: eventType,
      error: err.message, idempotenceToken, attempt: attemptNum,
    });
    if (wh.deliveries.length > 50) wh.deliveries = wh.deliveries.slice(0, 50);
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
 */
async function fireWebhooks(eventType, data) {
  const matching = ctx.webhooks.filter(w => w.enabled && webhookMatchesEvent(w, eventType));
  for (const wh of matching) {
    const maxRetries = Math.min(Math.max(parseInt(wh.retryCount, 10) || 3, 1), 10);
    await deliverWebhook(wh, eventType, data, 1, maxRetries);
  }
}

module.exports = { addNotification, sendDiscordWebhook, fireWebhooks, NOTIFICATION_ICONS, WEBHOOK_EVENTS };
