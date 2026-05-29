/**
 * Server control routes (start, stop, restart, lock, unlock).
 */
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { startServer, stopServer, restartServer } = require('../lib/server-lifecycle');
const { triggerManualUpdate, getUpdateState, cancelUpdate } = require('../lib/auto-updater');
const { authForServer } = require('../middleware/auth');
const { validate } = require('../lib/request-validator');

module.exports = function(app) {
  app.get('/api/servers/:id/status', authForServer(), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id] || {};
    res.json({
      status: state.status || 'stopped',
      players: state.players || [], playerCount: state.players?.length || 0,
      maxPlayers: state.config?.maxPlayers || srv.maxPlayers || 60,
      serverName: state.config?.hostname || srv.name,
      map: state.config?.template || srv.map || 'chernarusplus',
      gameVersion: state.config?.gameVersion || '',
      uptime: state.startedAt ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000) : 0,
      ports: { game: srv.gamePort, query: srv.queryPort, rcon: srv.rconPort },
      ip: srv.ip || '127.0.0.1',
      cpu: state.metricsHistory?.cpu?.slice(-1)[0] || 0,
      ram: state.metricsHistory?.ram?.slice(-1)[0] || 0,
      fps: state.metricsHistory?.fps?.slice(-1)[0] || 0,
    });
  });

  app.post('/api/servers/:id/start', authForServer('server.start'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    addAudit(req.user.id, req.user.username, 'server.start', `Starting: ${srv.name}`);
    const result = await startServer(srv.id, `Started by ${req.user.username}`);

    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(result.error?.includes('Port conflict') ? 409 : 500).json({ error: result.error });
    }
  });

  app.post('/api/servers/:id/stop', authForServer('server.stop'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    addAudit(req.user.id, req.user.username, 'server.stop', `Stopping: ${srv.name}`);
    const result = await stopServer(srv.id, `Stopped by ${req.user.username}`);

    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(500).json({ error: result.error });
    }
  });

  app.post('/api/servers/:id/restart', authForServer('server.restart'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    addAudit(req.user.id, req.user.username, 'server.restart', `Restarting: ${srv.name}`);
    const result = await restartServer(srv.id, `Manual restart by ${req.user.username}`);

    if (result.success) {
      res.json({ message: 'Restarting...' });
    } else {
      res.status(500).json({ error: result.error || 'Failed to restart after 3 attempts' });
    }
  });

  app.post('/api/servers/:id/lock', authForServer('server.rcon'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (state?.rcon) { await state.rcon.lock(); res.json({ message: 'Locked' }); }
    else res.status(400).json({ error: 'RCON not available' });
  });

  app.post('/api/servers/:id/unlock', authForServer('server.rcon'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (state?.rcon) { await state.rcon.unlock(); res.json({ message: 'Unlocked' }); }
    else res.status(400).json({ error: 'RCON not available' });
  });

  // ─── Auto-Update Endpoints ────────────────────────────────

  app.post('/api/servers/:id/update',
    authForServer('server.restart'),
    validate({
      updateType: { type: 'string', enum: ['game', 'mod'] },
      modId: { type: 'string', maxLength: 64 },
      modName: { type: 'string', maxLength: 200 },
    }),
    async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { updateType, modId, modName } = req.body || {};
    const type = updateType || 'game';
    const info = type === 'mod' ? { modId, modName } : {};

    addAudit(req.user.id, req.user.username, 'server.update', `Manual update triggered: ${srv.name} (${type})`);
    const result = triggerManualUpdate(srv.id, type, info);

    if (result.success) {
      res.json({ message: 'Update started' });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  app.get('/api/servers/:id/update/status', authForServer(), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    res.json(getUpdateState(srv.id));
  });

  app.post('/api/servers/:id/update/cancel', authForServer('server.restart'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    addAudit(req.user.id, req.user.username, 'server.update', `Update cancelled: ${srv.name}`);
    const result = cancelUpdate(srv.id);

    if (result.success) {
      res.json({ message: 'Update cancelled' });
    } else {
      res.status(400).json({ error: result.error });
    }
  });
};
