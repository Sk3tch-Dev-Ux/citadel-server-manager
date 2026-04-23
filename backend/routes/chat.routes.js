/**
 * Chat log endpoints — consumes `type: 'chat'` events from the in-game mod
 * via the CitadelBridge cache. Chat events contain { steamId, name,
 * message, channel, timestamp } and are logged to events.jsonl by the
 * @CitadelAdmin mod's `LogChat` hook.
 *
 *   GET /api/servers/:id/chat                — paginated filtered log
 *   GET /api/servers/:id/chat/channels       — distinct channels seen recently
 *   GET /api/servers/:id/chat/export.csv     — CSV download (respects filters)
 *
 * All filters are query-params: from, to (ISO timestamps), player (name or
 * steamId), channel (exact match), q (case-insensitive substring), limit.
 */
const { getBridge } = require('../lib/citadel-bridge');
const ctx = require('../lib/context');
const { authForServer } = require('../middleware/auth');
const { safeError } = require('../lib/http-errors');

function applyFilters(events, { from, to, player, channel, q }) {
  return events.filter((e) => {
    if (e?.type !== 'chat') return false;
    if (channel && e.channel !== channel) return false;
    if (player) {
      const needle = player.toLowerCase();
      if (!(e.name || '').toLowerCase().includes(needle) && e.steamId !== player) return false;
    }
    if (q) {
      if (!(e.message || '').toLowerCase().includes(q.toLowerCase())) return false;
    }
    if (from || to) {
      const t = Date.parse(e.timestamp || '');
      if (!Number.isNaN(t)) {
        if (from && t < Date.parse(from)) return false;
        if (to && t > Date.parse(to)) return false;
      }
    }
    return true;
  });
}

/** Quote a CSV cell — double-quote + escape embedded quotes. */
function csvCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = function (app) {
  // ─── GET chat log ────────────────────────────────────────
  app.get('/api/servers/:id/chat', authForServer(), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const limit = Math.min(2000, parseInt(req.query.limit, 10) || 200);
    try {
      const bridge = getBridge(srv.id);
      const all = bridge?.getRecentEvents?.(5000, 'chat') || [];
      const filtered = applyFilters(all, req.query);
      const messages = filtered.slice(-limit).reverse();
      res.json({ count: messages.length, total: filtered.length, messages });
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });

  // ─── GET distinct channels ───────────────────────────────
  // Populates the channel filter dropdown on the frontend.
  app.get('/api/servers/:id/chat/channels', authForServer(), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      const bridge = getBridge(srv.id);
      const all = bridge?.getRecentEvents?.(5000, 'chat') || [];
      const channels = [...new Set(all.map((e) => e.channel).filter(Boolean))].sort();
      res.json({ channels });
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });

  // ─── GET chat as CSV ─────────────────────────────────────
  app.get('/api/servers/:id/chat/export.csv', authForServer(), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
      const bridge = getBridge(srv.id);
      const all = bridge?.getRecentEvents?.(5000, 'chat') || [];
      const filtered = applyFilters(all, req.query);

      const fname = `chat-${srv.name.replace(/[^a-z0-9]/gi, '_')}-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);

      // Stream rows rather than building a huge string. Header first.
      res.write('timestamp,channel,player,steamid,message\n');
      for (const e of filtered) {
        res.write([
          csvCell(e.timestamp),
          csvCell(e.channel),
          csvCell(e.name),
          csvCell(e.steamId),
          csvCell(e.message),
        ].join(',') + '\n');
      }
      res.end();
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });
};
