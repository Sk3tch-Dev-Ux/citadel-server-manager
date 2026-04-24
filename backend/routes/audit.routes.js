/**
 * Audit log routes.
 *
 *   GET  /api/audit                — filterable list (q, user, action, from, to, limit, offset)
 *   GET  /api/audit/actions        — distinct action types (for filter dropdowns)
 *   GET  /api/audit/users          — distinct usernames (for filter dropdowns)
 *   GET  /api/audit/export.csv     — CSV export, respects filters
 *
 * Backed by ctx.auditLog (see lib/audit.js — capped in-memory, persisted).
 */
const ctx = require('../lib/context');
const auth = require('../middleware/auth');

function applyFilters(entries, { q, user, action, from, to }) {
  let filtered = entries;
  if (user) {
    filtered = filtered.filter((e) => e.username === user || e.userId === user);
  }
  if (action) {
    filtered = filtered.filter((e) => e.action === action);
  }
  if (from) {
    const ts = Date.parse(from);
    if (!Number.isNaN(ts)) filtered = filtered.filter((e) => Date.parse(e.timestamp) >= ts);
  }
  if (to) {
    const ts = Date.parse(to);
    if (!Number.isNaN(ts)) filtered = filtered.filter((e) => Date.parse(e.timestamp) <= ts);
  }
  if (q) {
    const needle = String(q).toLowerCase();
    filtered = filtered.filter((e) =>
      (e.action || '').toLowerCase().includes(needle) ||
      (e.username || '').toLowerCase().includes(needle) ||
      (e.details || '').toLowerCase().includes(needle)
    );
  }
  return filtered;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = function (app) {
  // GET — filterable list
  app.get('/api/audit', auth('users.manage'), (req, res) => {
    const { q, user, action, from, to } = req.query;
    const limit = Math.min(1000, parseInt(req.query.limit, 10) || 100);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const filtered = applyFilters(ctx.auditLog || [], { q, user, action, from, to });
    res.json({
      entries: filtered.slice(offset, offset + limit),
      total: filtered.length,
      unfilteredTotal: (ctx.auditLog || []).length,
    });
  });

  // GET — distinct action types (for filter dropdown)
  app.get('/api/audit/actions', auth('users.manage'), (req, res) => {
    const counts = {};
    for (const e of ctx.auditLog || []) {
      if (!e.action) continue;
      counts[e.action] = (counts[e.action] || 0) + 1;
    }
    res.json({
      actions: Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    });
  });

  // GET — distinct users (for filter dropdown)
  app.get('/api/audit/users', auth('users.manage'), (req, res) => {
    const counts = {};
    for (const e of ctx.auditLog || []) {
      if (!e.username) continue;
      counts[e.username] = (counts[e.username] || 0) + 1;
    }
    res.json({
      users: Object.entries(counts)
        .map(([username, count]) => ({ username, count }))
        .sort((a, b) => b.count - a.count),
    });
  });

  // GET — CSV export respecting current filters
  app.get('/api/audit/export.csv', auth('users.manage'), (req, res) => {
    const { q, user, action, from, to } = req.query;
    const filtered = applyFilters(ctx.auditLog || [], { q, user, action, from, to });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="citadel-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write('timestamp,user,action,details\n');
    for (const e of filtered) {
      res.write(`${csvEscape(e.timestamp)},${csvEscape(e.username || '')},${csvEscape(e.action || '')},${csvEscape(e.details || '')}\n`);
    }
    res.end();
  });
};
