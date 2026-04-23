const { safeError } = require('../lib/http-errors');
/**
 * Citadel Bridge REST API routes.
 *
 * Provides HTTP endpoints for the @CitadelAdmin mod integration
 * as a fallback when WebSocket isn't available.
 *
 * All routes are scoped to /api/servers/:id/citadel/*
 */
const ctx = require('../lib/context');
const { getBridge } = require('../lib/citadel-bridge');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');

module.exports = function (app) {
  /**
   * Helper: resolve bridge for a server, send 404 if not found.
   */
  function withBridge(req, res, fn) {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const bridge = getBridge(srv.id);
    if (!bridge) return res.status(500).json({ error: 'Could not initialize bridge' });

    return fn(bridge, srv);
  }

  // ─── Status ────────────────────────────────────────────
  app.get('/api/servers/:id/citadel/status', authForServer(), (req, res) => {
    withBridge(req, res, (bridge) => {
      res.json(bridge.getStatus());
    });
  });

  // ─── Players ───────────────────────────────────────────
  app.get('/api/servers/:id/citadel/players', authForServer('players.view'), (req, res) => {
    withBridge(req, res, (bridge) => {
      res.json({ players: bridge.getPlayers() });
    });
  });

  // ─── Metrics ───────────────────────────────────────────
  app.get('/api/servers/:id/citadel/metrics', authForServer('metrics.view'), (req, res) => {
    withBridge(req, res, (bridge) => {
      res.json({ metrics: bridge.getMetrics() });
    });
  });

  // ─── Vehicles ──────────────────────────────────────────
  app.get('/api/servers/:id/citadel/vehicles', authForServer(), (req, res) => {
    withBridge(req, res, (bridge) => {
      res.json({ vehicles: bridge.getVehicles() });
    });
  });

  // ─── Events ────────────────────────────────────────────
  app.get('/api/servers/:id/citadel/events', authForServer('logs.view'), (req, res) => {
    withBridge(req, res, (bridge) => {
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const type = req.query.type || null;
      res.json({ events: bridge.getRecentEvents(limit, type) });
    });
  });

  // ─── World Events ──────────────────────────────────────
  app.get('/api/servers/:id/citadel/world', authForServer(), (req, res) => {
    withBridge(req, res, (bridge) => {
      res.json({ events: bridge.getWorldEvents() });
    });
  });

  // ─── Send Command ──────────────────────────────────────
  app.post('/api/servers/:id/citadel/command', authForServer('server.rcon'), async (req, res) => {
    withBridge(req, res, async (bridge, srv) => {
      const { action, params } = req.body;
      if (!action) return res.status(400).json({ error: 'action is required' });

      addAudit(req.user.id, req.user.username, 'citadel.command', `${action} on ${srv.name}`);

      try {
        const response = await bridge.sendCommand(action, params || {});
        res.json({ success: response.ok, response });
      } catch (err) {
        safeError(err, req, res, { status: 504 });
      }
    });
  });

  // ─── Batch Commands ────────────────────────────────────
  app.post('/api/servers/:id/citadel/command/batch', authForServer('server.rcon'), async (req, res) => {
    withBridge(req, res, async (bridge, srv) => {
      const { commands } = req.body;
      if (!Array.isArray(commands) || commands.length === 0) {
        return res.status(400).json({ error: 'commands array is required' });
      }
      if (commands.length > 20) {
        return res.status(400).json({ error: 'Maximum 20 commands per batch' });
      }

      addAudit(req.user.id, req.user.username, 'citadel.batch', `${commands.length} commands on ${srv.name}`);

      try {
        const results = await bridge.sendBatch(commands);
        res.json({ results });
      } catch (err) {
        safeError(err, req, res, { status: 500 });
      }
    });
  });
};
