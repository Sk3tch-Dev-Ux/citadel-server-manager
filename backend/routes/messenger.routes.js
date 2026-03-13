/**
 * Messenger routes — CRUD for automated broadcast messages (per server).
 * Data model matches scheduler-engine.js processMessenger() expectations.
 * Persists to data/messenger-{serverId}.json
 */
const { v4: uuid } = require('uuid');
const ctx = require('../lib/context');
const { authForServer } = require('../middleware/auth');
const { saveJSON } = require('../lib/data-store');
const { addAudit } = require('../lib/audit');

function getMessenger(serverId) {
  const state = ctx.serverStates[serverId];
  if (!state) return null;
  if (!state.messenger) state.messenger = { enabled: true, messages: [] };
  return state.messenger;
}

function persistMessenger(serverId) {
  const messenger = getMessenger(serverId);
  if (!messenger) return;
  // Don't persist the runtime lastSent map
  const { lastSent, ...data } = messenger;
  saveJSON(ctx.CONFIG.dataDir, `messenger-${serverId}.json`, data);
}

module.exports = function (app) {
  // ─── Get messenger config + messages ────────────────────
  app.get('/api/servers/:id/messenger', authForServer(), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    const messenger = getMessenger(req.params.id);
    res.json({
      enabled: messenger.enabled,
      messages: messenger.messages || [],
    });
  });

  // ─── Toggle messenger enabled/disabled ──────────────────
  app.patch('/api/servers/:id/messenger/toggle', authForServer('messenger.manage'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    const messenger = getMessenger(req.params.id);
    messenger.enabled = !messenger.enabled;
    persistMessenger(req.params.id);
    res.json({ enabled: messenger.enabled });
  });

  // ─── Create a new message ──────────────────────────────
  app.post('/api/servers/:id/messenger', authForServer('messenger.manage'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const { text, intervalSeconds, startDelaySeconds } = req.body;

    if (!text || text.trim().length === 0) return res.status(400).json({ error: 'Message text is required' });
    if (!intervalSeconds || intervalSeconds < 30) return res.status(400).json({ error: 'Interval must be at least 30 seconds' });

    const msg = {
      id: uuid(),
      text: text.trim(),
      intervalSeconds: parseInt(intervalSeconds, 10) || 300,
      startDelaySeconds: parseInt(startDelaySeconds, 10) || 0,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    const messenger = getMessenger(req.params.id);
    if (!messenger.messages) messenger.messages = [];
    messenger.messages.push(msg);
    persistMessenger(req.params.id);
    addAudit(req.user?.id || 'system', req.user?.username || 'system', 'message.create', `Created message on server ${req.params.id}`);
    res.json(msg);
  });

  // ─── Update a message ──────────────────────────────────
  app.put('/api/servers/:id/messenger/:msgId', authForServer('messenger.manage'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const messenger = getMessenger(req.params.id);
    const msg = (messenger.messages || []).find(m => m.id === req.params.msgId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const { text, intervalSeconds, startDelaySeconds, enabled } = req.body;

    if (text !== undefined) msg.text = text.trim();
    if (intervalSeconds !== undefined) msg.intervalSeconds = Math.max(30, parseInt(intervalSeconds, 10) || 300);
    if (startDelaySeconds !== undefined) msg.startDelaySeconds = parseInt(startDelaySeconds, 10) || 0;
    if (enabled !== undefined) msg.enabled = !!enabled;

    persistMessenger(req.params.id);
    addAudit(req.user?.id || 'system', req.user?.username || 'system', 'message.update', `Updated message on server ${req.params.id}`);
    res.json(msg);
  });

  // ─── Toggle a message ──────────────────────────────────
  app.patch('/api/servers/:id/messenger/:msgId/toggle', authForServer('messenger.manage'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const messenger = getMessenger(req.params.id);
    const msg = (messenger.messages || []).find(m => m.id === req.params.msgId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    msg.enabled = !msg.enabled;
    persistMessenger(req.params.id);
    res.json(msg);
  });

  // ─── Delete a message ──────────────────────────────────
  app.delete('/api/servers/:id/messenger/:msgId', authForServer('messenger.manage'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const messenger = getMessenger(req.params.id);
    const msgs = messenger.messages || [];
    const idx = msgs.findIndex(m => m.id === req.params.msgId);
    if (idx === -1) return res.status(404).json({ error: 'Message not found' });

    const removed = msgs.splice(idx, 1)[0];
    persistMessenger(req.params.id);
    addAudit(req.user?.id || 'system', req.user?.username || 'system', 'message.delete', `Deleted message on server ${req.params.id}`);
    res.json({ message: 'Deleted', id: removed.id });
  });

  // ─── Reorder messages ──────────────────────────────────
  app.put('/api/servers/:id/messenger/reorder', authForServer('messenger.manage'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Order array is required' });

    const messenger = getMessenger(req.params.id);
    const msgs = messenger.messages || [];
    const reordered = [];
    for (const id of order) {
      const msg = msgs.find(m => m.id === id);
      if (msg) reordered.push(msg);
    }
    // Append any messages not in the order array
    for (const msg of msgs) {
      if (!reordered.find(m => m.id === msg.id)) reordered.push(msg);
    }
    messenger.messages = reordered;
    persistMessenger(req.params.id);
    res.json({ messages: reordered });
  });
};
