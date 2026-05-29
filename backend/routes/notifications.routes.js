/**
 * Notification routes.
 *
 *   GET    /api/notifications                 — list (filter: severity, server, type, q, limit, offset)
 *   GET    /api/notifications/unread-count    — { count } — cheap for badge polling
 *   GET    /api/notifications/facets          — distinct severity/type/server values
 *   PATCH  /api/notifications/read            — mark all or specific IDs as read
 *   DELETE /api/notifications                 — clear all
 *   DELETE /api/notifications/:id             — delete one
 *
 * Storage is ctx.notifications (capped in-memory at 200, persisted to disk).
 * See lib/notifications.js for addNotification() and webhook integration.
 */
const ctx = require('../lib/context');
const auth = require('../middleware/auth');
const { validate } = require('../lib/request-validator');

function applyFilters(items, { severity, server, type, q }) {
  let out = items;
  if (severity) out = out.filter((n) => n.severity === severity);
  if (server) out = out.filter((n) => n.serverId === server);
  if (type) out = out.filter((n) => n.type === type);
  if (q) {
    const needle = String(q).toLowerCase();
    out = out.filter((n) =>
      (n.title || '').toLowerCase().includes(needle) ||
      (n.message || '').toLowerCase().includes(needle)
    );
  }
  return out;
}

module.exports = function (app) {
  // GET — list with filters
  app.get('/api/notifications', auth(), (req, res) => {
    const { severity, server, type, q } = req.query;
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 50);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const all = Array.isArray(ctx.notifications) ? ctx.notifications : [];
    const filtered = applyFilters(all, { severity, server, type, q });

    // Keep backward compat: when no filters/pagination requested, return the
    // raw array (matches NotificationCenter's current expectation).
    const hasQueryParams = severity || server || type || q || req.query.limit || req.query.offset;
    if (!hasQueryParams) {
      return res.json(all.slice(0, limit));
    }

    res.json({
      entries: filtered.slice(offset, offset + limit),
      total: filtered.length,
      unfilteredTotal: all.length,
    });
  });

  // GET — unread count (cheap endpoint for badge polling, avoids full list fetch)
  app.get('/api/notifications/unread-count', auth(), (req, res) => {
    const count = (ctx.notifications || []).filter((n) => !n.read).length;
    res.json({ count });
  });

  // GET — distinct facets for filter dropdowns
  app.get('/api/notifications/facets', auth(), (req, res) => {
    const severities = {};
    const types = {};
    const servers = {};
    for (const n of ctx.notifications || []) {
      if (n.severity) severities[n.severity] = (severities[n.severity] || 0) + 1;
      if (n.type) types[n.type] = (types[n.type] || 0) + 1;
      if (n.serverId) servers[n.serverId] = (servers[n.serverId] || 0) + 1;
    }
    const toList = (obj) => Object.entries(obj).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    res.json({
      severities: toList(severities),
      types: toList(types),
      servers: toList(servers),
    });
  });

  // PATCH — mark read (all, or specific IDs)
  app.patch('/api/notifications/read', auth(), validate({ ids: { type: 'array' } }), (req, res) => {
    const { ids } = req.body || {};
    if (ids && Array.isArray(ids)) {
      ids.forEach((id) => { const n = ctx.notifications.find((x) => x.id === id); if (n) n.read = true; });
    } else {
      ctx.notifications.forEach((n) => { n.read = true; });
    }
    res.json({ ok: true });
  });

  // DELETE — clear all
  app.delete('/api/notifications', auth(), (req, res) => {
    ctx.notifications.length = 0;
    res.json({ ok: true });
  });

  // DELETE — single
  app.delete('/api/notifications/:id', auth(), (req, res) => {
    const idx = (ctx.notifications || []).findIndex((n) => n.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });
    ctx.notifications.splice(idx, 1);
    res.json({ ok: true });
  });
};
