/**
 * PvP stats + kill feed endpoints.
 *
 *   GET    /api/servers/:id/pvp/leaderboard[?limit=50&sortBy=kills]
 *   GET    /api/servers/:id/pvp/stats            — aggregate server stats
 *   GET    /api/servers/:id/pvp/player/:steamId  — per-player deep stats
 *   GET    /api/servers/:id/pvp/kills[?limit=200&from=ISO&to=ISO]
 *   POST   /api/servers/:id/pvp/reset            — wipe leaderboard (admin)
 *
 * The leaderboard persists to data/pvp-stats-{serverId}.json and auto-resets
 * when Dangerzone runs a server wipe (see dangerzone.routes.js).
 */
const ctx = require('../lib/context');
const pvpStats = require('../lib/pvp-stats');
const { getBridge } = require('../lib/citadel-bridge');
const { authForServer, auth } = require('../middleware/auth');
const { addAudit } = require('../lib/audit');
const { safeError } = require('../lib/http-errors');

const VALID_SORTS = new Set(['kills', 'headshots', 'longestKill', 'kd']);

module.exports = function (app) {
  app.get('/api/servers/:id/pvp/leaderboard', authForServer(), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 50);
    const sortBy = VALID_SORTS.has(req.query.sortBy) ? req.query.sortBy : 'kills';
    try {
      res.json(pvpStats.getLeaderboard(ctx.CONFIG.dataDir, srv.id, { limit, sortBy }));
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });

  app.get('/api/servers/:id/pvp/stats', authForServer(), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      res.json(pvpStats.getServerStats(ctx.CONFIG.dataDir, srv.id));
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });

  app.get('/api/servers/:id/pvp/player/:steamId', authForServer(), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      const stats = pvpStats.getPlayerStats(ctx.CONFIG.dataDir, srv.id, req.params.steamId);
      if (!stats) return res.status(404).json({ error: 'No stats for this player in the current wipe' });
      res.json(stats);
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * Recent kill feed. Pulls from the bridge's in-memory event cache (which
   * tracks the tail of events.jsonl) and filters to kill events. For longer
   * ranges the caller could walk events.jsonl directly, but most UI use
   * cases only need the last few hundred kills.
   */
  app.get('/api/servers/:id/pvp/kills', authForServer(), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const limit = Math.min(1000, parseInt(req.query.limit, 10) || 200);
    const from = req.query.from ? Date.parse(req.query.from) : null;
    const to = req.query.to ? Date.parse(req.query.to) : null;

    try {
      const bridge = getBridge(srv.id);
      const kills = (bridge?.getRecentEvents?.(1000, 'kill') || [])
        .filter((e) => {
          if (!from && !to) return true;
          const t = Date.parse(e.timestamp || '');
          if (Number.isNaN(t)) return true;
          if (from && t < from) return false;
          if (to && t > to) return false;
          return true;
        })
        .map((e) => ({ ...e, headshot: (e.zone || '').toLowerCase() === 'head' }))
        .slice(-limit)
        .reverse();
      res.json({ count: kills.length, kills });
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });

  app.post('/api/servers/:id/pvp/reset', auth(['admin', 'owner', '*']), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      const result = pvpStats.reset(ctx.CONFIG.dataDir, srv.id);
      addAudit(req.user.id, req.user.username, 'pvp.reset', `Reset PvP leaderboard for ${srv.name}`);
      res.json({ ok: true, ...result });
    } catch (err) {
      safeError(err, req, res, { status: 500, clientMessage: 'Failed to reset leaderboard' });
    }
  });
};
