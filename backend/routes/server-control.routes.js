/**
 * Server control routes (start, stop, restart, lock, unlock).
 */
const ctx = require('../lib/context');
const { detectRunningProcess, detectRunningProcessByPath, killProcess, spawnDayZServer } = require('../lib/process-manager');
const { addLog } = require('../lib/audit');
const { addAudit } = require('../lib/audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('../lib/notifications');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/servers/:id/status', auth(), (req, res) => {
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
      cpu: state.metricsHistory?.cpu?.slice(-1)[0] || 0,
      ram: state.metricsHistory?.ram?.slice(-1)[0] || 0,
    });
  });

  app.post('/api/servers/:id/start', auth('server.start'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id];
    if (!state) return res.status(500).json({ error: 'State not initialized' });
    if (state.status === 'running') return res.status(400).json({ error: 'Already running' });

    const existingPid = await detectRunningProcess(srv.executable);
    if (existingPid) {
      state.pid = existingPid; state.status = 'running'; state.startedAt = new Date().toISOString();
      ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
      return res.json({ message: `Already running (PID: ${existingPid})` });
    }

    state.status = 'starting'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
    addLog(srv.id, 'info', 'server', `Start initiated by ${req.user.username}`);
    try {
      state.process = spawnDayZServer(srv); state.pid = state.process.pid;
      setTimeout(async () => {
        const pid = await detectRunningProcess(srv.executable);
        if (pid) {
          state.pid = pid; state.status = 'running'; state.startedAt = new Date().toISOString();
          ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
          addLog(srv.id, 'info', 'server', 'Server is now running');
          addNotification(srv.id, 'server.started', 'Server Started', `${srv.name} is now running`, 'success');
          fireWebhooks('server.started', { serverId: srv.id, serverName: srv.name });
          sendDiscordWebhook(`🟢 **${srv.name}** started`);
        } else if (state.status === 'starting') {
          state.status = 'crashed'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
        }
      }, 8000);
      addAudit(req.user.id, req.user.username, 'server.start', `Started: ${srv.name}`);
      res.json({ message: 'Starting...' });
    } catch (err) {
      state.status = 'crashed'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/stop', auth('server.stop'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id];
    if (!state || state.status === 'stopped') return res.status(400).json({ error: 'Not running' });

    state.status = 'stopping'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'stopping' });
    addLog(srv.id, 'info', 'server', `Stop initiated by ${req.user.username}`);
    try {
      if (state.rcon?.loggedIn) { try { await state.rcon.shutdown(); await new Promise(r => setTimeout(r, 5000)); } catch {} }
      await killProcess(state.pid, srv.executable);
      state.status = 'stopped'; state.pid = null; state.process = null; state.players = []; state.startedAt = null;
      ctx.io.emit('serverStatus', { serverId: srv.id, status: 'stopped' });
      ctx.io.emit('players', { serverId: srv.id, players: [] });
      addAudit(req.user.id, req.user.username, 'server.stop', `Stopped: ${srv.name}`);
      addNotification(srv.id, 'server.stopped', 'Server Stopped', `${srv.name} has been stopped`, 'info');
      fireWebhooks('server.stopped', { serverId: srv.id, serverName: srv.name });
      sendDiscordWebhook(`🔴 **${srv.name}** stopped`);
      res.json({ message: 'Stopped' });
    } catch {
      state.status = 'stopped'; state.pid = null;
      ctx.io.emit('serverStatus', { serverId: srv.id, status: 'stopped' });
      res.json({ message: 'Stopped (force)' });
    }
  });

  app.post('/api/servers/:id/restart', auth('server.restart'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id];
    if (!state) return res.status(500).json({ error: 'State not initialized' });

    addLog(srv.id, 'info', 'server', `Restart initiated by ${req.user.username}`);
    state.status = 'stopping'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'stopping' });
    let restartSuccess = false;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (state.pid) await killProcess(state.pid, srv.executable);
        state.pid = null; state.process = null; state.players = [];
        await new Promise(r => setTimeout(r, 3000));
        state.status = 'starting'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
        state.process = spawnDayZServer(srv); state.pid = state.process.pid;
        await new Promise(r => setTimeout(r, 8000));
        const pid = await detectRunningProcess(srv.executable);
        if (pid) {
          state.pid = pid; state.status = 'running'; state.startedAt = new Date().toISOString();
          ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
          addNotification(srv.id, 'server.restarted', 'Server Restarted', `${srv.name} has been restarted`, 'info');
          fireWebhooks('server.restarted', { serverId: srv.id, serverName: srv.name });
          sendDiscordWebhook(`🔄 **${srv.name}** restarted`);
          addLog(srv.id, 'info', 'server', `Restart succeeded on attempt ${attempt}`);
          restartSuccess = true;
          break;
        } else {
          lastError = `Process not detected after restart attempt ${attempt}`;
          addLog(srv.id, 'error', 'server', lastError);
        }
      } catch (err) {
        lastError = `Restart attempt ${attempt} failed: ${err.message}`;
        addLog(srv.id, 'error', 'server', lastError);
      }
    }
    addAudit(req.user.id, req.user.username, 'server.restart', `Restarted: ${srv.name} (success: ${restartSuccess})`);
    if (restartSuccess) {
      res.json({ message: 'Restarting...' });
    } else {
      state.status = 'crashed'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
      addNotification(srv.id, 'server.crashed', 'Restart Failed', `${srv.name} failed to restart after 3 attempts`, 'error');
      fireWebhooks('server.crashed', { serverId: srv.id, serverName: srv.name });
      sendDiscordWebhook(`💥 **${srv.name}** failed to restart after 3 attempts`);
      res.status(500).json({ error: lastError || 'Failed to restart after 3 attempts' });
    }
  });

  app.post('/api/servers/:id/lock', auth('server.rcon'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (state?.rcon) { await state.rcon.lock(); res.json({ message: 'Locked' }); }
    else res.status(400).json({ error: 'RCON not available' });
  });

  app.post('/api/servers/:id/unlock', auth('server.rcon'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (state?.rcon) { await state.rcon.unlock(); res.json({ message: 'Unlocked' }); }
    else res.status(400).json({ error: 'RCON not available' });
  });
};
