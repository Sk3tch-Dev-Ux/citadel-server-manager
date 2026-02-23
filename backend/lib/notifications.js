/**
 * Notifications, Discord webhooks, and custom webhook delivery.
 */
const { v4: uuid } = require('uuid');
const logger = require('./logger');
const ctx = require('./context');
const { saveJSON } = require('./data-store');
const { sanitizeString } = require('./helpers');

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
 * Fire all matching custom webhooks for a given event type.
 * Supports Discord webhook format and generic JSON POST.
 * Retries up to 3 times on failure if retryEnabled is set.
 */
async function fireWebhooks(eventType, data) {
  const matching = ctx.webhooks.filter(w => w.enabled && w.event === eventType);
  for (const wh of matching) {
    try {
      const fetch = (await import('node-fetch')).default;
      const payload = { event: eventType, timestamp: new Date().toISOString(), data };
      if (wh.url.includes('discord.com/api/webhooks')) {
        let body;
        try { body = JSON.parse(wh.template || '{}'); } catch { body = {}; }
        let content = body.content || `**${eventType}** event fired`;
        content = content.replace(/\{server\.name\}/g, data.serverName || 'Unknown');
        content = content.replace(/\{server\.id\}/g, data.serverId || '');
        content = content.replace(/\{timestamp\}/g, new Date().toLocaleString());
        body.content = content;
        await fetch(wh.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(wh.timeout || 60000) });
      } else {
        await fetch(wh.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(wh.headers || {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(wh.timeout || 60000) });
      }
      if (!wh.deliveries) wh.deliveries = [];
      wh.deliveries.unshift({ timestamp: new Date().toISOString(), status: 'success', event: eventType });
      if (wh.deliveries.length > 50) wh.deliveries = wh.deliveries.slice(0, 50);
    } catch (err) {
      if (!wh.deliveries) wh.deliveries = [];
      wh.deliveries.unshift({ timestamp: new Date().toISOString(), status: 'failed', event: eventType, error: err.message });
      if (wh.deliveries.length > 50) wh.deliveries = wh.deliveries.slice(0, 50);
      if (wh.retryEnabled && (!wh._retryCount || wh._retryCount < 3)) {
        wh._retryCount = (wh._retryCount || 0) + 1;
        setTimeout(() => fireWebhooks(eventType, data), 5000 * wh._retryCount);
      }
    }
  }
  saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks);
}

module.exports = { addNotification, sendDiscordWebhook, fireWebhooks, NOTIFICATION_ICONS };
