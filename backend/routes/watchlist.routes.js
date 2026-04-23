/**
 * Watchlist CRUD routes.
 *
 * The watchlist is a global (not per-server) list of flagged players —
 * known cheaters, griefers, staff-to-watch, etc. Each entry supports
 * free-form tags, a long-form note, and tracks who added/updated it.
 *
 * When a watched player connects to any server, the session-diff in
 * player-profiles fires `watchlist.hit` notifications so admins who are
 * viewing the dashboard see an alert in real time. See `_checkWatchlist`
 * in lib/watchlist.js for the hook.
 */
const { v4: uuid } = require('uuid');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const auth = require('../middleware/auth');
const { addAudit } = require('../lib/audit');

module.exports = function (app) {
  // GET — list (optional ?q=<search>&tag=<tag>)
  app.get('/api/watchlist', auth(), (req, res) => {
    const { q, tag } = req.query;
    let entries = Array.isArray(ctx.watchList) ? ctx.watchList : [];

    if (tag) {
      entries = entries.filter((e) => Array.isArray(e.tags) && e.tags.includes(tag));
    }
    if (q && typeof q === 'string') {
      const needle = q.toLowerCase();
      entries = entries.filter((e) =>
        (e.name || '').toLowerCase().includes(needle) ||
        (e.steamId || '').includes(needle) ||
        (e.reason || '').toLowerCase().includes(needle) ||
        (e.note || '').toLowerCase().includes(needle)
      );
    }

    // Build the tag facet so the UI can show an "all tags" chip row
    const tagCounts = {};
    for (const e of ctx.watchList || []) {
      for (const t of (e.tags || [])) tagCounts[t] = (tagCounts[t] || 0) + 1;
    }

    res.json({
      total: (ctx.watchList || []).length,
      entries,
      tags: Object.entries(tagCounts).map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    });
  });

  // POST — create
  app.post('/api/watchlist', auth('players.ban'), (req, res) => {
    const { name, steamId, reason, note, tags } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name required' });
    }
    const now = new Date().toISOString();
    const entry = {
      id: uuid(),
      name: name.trim(),
      steamId: typeof steamId === 'string' ? steamId.trim() : '',
      reason: typeof reason === 'string' ? reason.trim() : '',
      note: typeof note === 'string' ? note.trim() : '',
      tags: Array.isArray(tags) ? tags.map(String).filter(Boolean).slice(0, 10) : [],
      addedAt: now,
      addedBy: req.user.username,
      updatedAt: now,
      updatedBy: req.user.username,
      lastSeenAt: null,
      hitCount: 0,
    };
    ctx.watchList.push(entry);
    saveJSON(ctx.CONFIG.dataDir, 'watchlist.json', ctx.watchList);
    addAudit(req.user.id, req.user.username, 'watchlist.add',
      `Added ${entry.name}${entry.steamId ? ` (${entry.steamId})` : ''} to watchlist`);
    res.json(entry);
  });

  // PATCH — update
  app.patch('/api/watchlist/:id', auth('players.ban'), (req, res) => {
    const idx = ctx.watchList.findIndex((w) => w.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Entry not found' });
    const { name, steamId, reason, note, tags } = req.body || {};
    const current = ctx.watchList[idx];
    const updated = {
      ...current,
      name: typeof name === 'string' ? name.trim() : current.name,
      steamId: typeof steamId === 'string' ? steamId.trim() : current.steamId,
      reason: typeof reason === 'string' ? reason.trim() : current.reason,
      note: typeof note === 'string' ? note.trim() : current.note,
      tags: Array.isArray(tags) ? tags.map(String).filter(Boolean).slice(0, 10) : current.tags,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.username,
    };
    ctx.watchList[idx] = updated;
    saveJSON(ctx.CONFIG.dataDir, 'watchlist.json', ctx.watchList);
    addAudit(req.user.id, req.user.username, 'watchlist.update',
      `Updated watchlist entry for ${updated.name}`);
    res.json(updated);
  });

  // DELETE — single
  app.delete('/api/watchlist/:id', auth('players.ban'), (req, res) => {
    const entry = ctx.watchList.find((w) => w.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    ctx.watchList = ctx.watchList.filter((w) => w.id !== req.params.id);
    saveJSON(ctx.CONFIG.dataDir, 'watchlist.json', ctx.watchList);
    addAudit(req.user.id, req.user.username, 'watchlist.remove',
      `Removed ${entry.name} from watchlist`);
    res.json({ ok: true });
  });

  // POST /bulk-delete — { ids: [...] }
  app.post('/api/watchlist/bulk-delete', auth('players.ban'), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const before = ctx.watchList.length;
    const idSet = new Set(ids);
    const removed = ctx.watchList.filter((w) => idSet.has(w.id));
    ctx.watchList = ctx.watchList.filter((w) => !idSet.has(w.id));
    saveJSON(ctx.CONFIG.dataDir, 'watchlist.json', ctx.watchList);
    addAudit(req.user.id, req.user.username, 'watchlist.bulk-remove',
      `Removed ${removed.length} watchlist entries`);
    res.json({ ok: true, removed: removed.length, before, after: ctx.watchList.length });
  });
};
