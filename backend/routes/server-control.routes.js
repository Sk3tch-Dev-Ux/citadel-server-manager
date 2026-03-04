/**
 * Server control routes (start, stop, restart, lock, unlock).
 */
const ctx = require('../lib/context');
const { detectRunningProcess, detectProcessByPid, killProcess, spawnDayZServer } = require('../lib/process-manager');
const { startSidecar, stopSidecar } = require('../lib/sidecar-manager');
const { addLog } = require('../lib/audit');
const { addAudit } = require('../lib/audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('../lib/notifications');
const { executeHooks } = require('../lib/lifecycle-hooks');
const { checkPortAvailability } = require('../lib/port-checker');
const { restartServer } = require('../lib/server-lifecycle');
const { triggerManualUpdate, getUpdateState, cancelUpdate } = require('../lib/auto-updater');
const { authForServer } = require('../middleware/auth');
const { ensureFirewallRules } = require('../lib/firewall-manager');

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
    const state = ctx.serverStates[srv.id];
    if (!state) return res.status(500).json({ error: 'State not initialized' });
    if (state.status === 'running') return res.status(400).json({ error: 'Already running' });

    const existingPid = await detectRunningProcess(srv.executable);
    if (existingPid) {
      state.pid = existingPid; state.status = 'running'; state.startedAt = new Date().toISOString();
      ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
      startSidecar(srv); // Ensure sidecar is running too
      return res.json({ message: `Already running (PID: ${existingPid})` });
    }

    addLog(srv.id, 'info', 'server', `Start initiated by ${req.user.username}`);

    // Check for port conflicts before starting
    try {
      const ports = [srv.gamePort, srv.queryPort, srv.rconPort].filter(Boolean).map(Number);
      const portCheck = await checkPortAvailability(ports, srv.id);
      if (!portCheck.available) {
        const details = portCheck.conflicts.map(c => `Port ${c.port} used by ${c.usedBy}`).join('; ');
        addLog(srv.id, 'error', 'server', `Port conflict detected: ${details}`);
        return res.status(409).json({ error: `Port conflict: ${details}`, conflicts: portCheck.conflicts });
      }
    } catch (err) {
      addLog(srv.id, 'warn', 'server', `Port check failed (proceeding anyway): ${err.message}`);
    }

    // Ensure firewall rules exist (non-blocking)
    ensureFirewallRules(srv.name, { gamePort: srv.gamePort, queryPort: srv.queryPort, rconPort: srv.rconPort })
      .catch(err => addLog(srv.id, 'warn', 'server', `Firewall rule setup failed: ${err.message}`));

    state.status = 'starting'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
    try {
      // Execute pre-start hooks — abort if any hook fails
      const preStartResult = await executeHooks(srv.id, 'pre-start');
      if (!preStartResult.success) {
        state.status = 'stopped'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'stopped' });
        addLog(srv.id, 'warn', 'server', `Start aborted by pre-start hook: ${preStartResult.hook}`);
        return res.status(400).json({ error: `Start aborted by pre-start hook: ${preStartResult.hook}` });
      }

      const { child, launchFailed } = spawnDayZServer(srv);
      state.process = child; state.pid = child.pid;

      if (!child.pid) {
        state.status = 'crashed'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
        addLog(srv.id, 'error', 'server', 'Spawn returned no PID — executable may be invalid');
        return res.status(500).json({ error: 'Failed to spawn process (no PID)' });
      }

      addLog(srv.id, 'info', 'server', `Process spawned with PID: ${child.pid}`);

      // Start the sidecar (live map + admin actions API)
      startSidecar(srv);

      // Monitor the launch asynchronously — launchFailed resolves to an error string
      // if the process exits/errors within 10s, or null if still alive
      launchFailed.then(async (failReason) => {
        if (failReason) {
          // Process died almost immediately
          addLog(srv.id, 'error', 'server', `Launch failed: ${failReason}`);
          if (state.status === 'starting' || state.status === 'running') {
            state.status = 'crashed'; state.pid = null; state.process = null;
            ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
            addNotification(srv.id, 'server.crashed', 'Start Failed', `${srv.name}: ${failReason}`, 'error');
          }
          return;
        }
        // Process survived 10s — now verify it's actually running via tasklist
        const alive = await detectProcessByPid(child.pid);
        if (alive) {
          state.pid = child.pid; state.status = 'running'; state.startedAt = new Date().toISOString();
          ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
          addLog(srv.id, 'info', 'server', `Server is now running (PID: ${child.pid})`);
          addNotification(srv.id, 'server.started', 'Server Started', `${srv.name} is now running`, 'success');
          fireWebhooks('server.started', { serverId: srv.id, serverName: srv.name });
          sendDiscordWebhook(`🟢 **${srv.name}** started`);
          // Fire started hooks (non-blocking, fire-and-forget)
          executeHooks(srv.id, 'started').catch(() => {});
        } else if (state.status === 'starting') {
          addLog(srv.id, 'error', 'server', `PID ${child.pid} not found in tasklist after grace period`);
          state.status = 'crashed'; state.pid = null; state.process = null;
          ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
          addNotification(srv.id, 'server.crashed', 'Start Failed', `${srv.name} process disappeared`, 'error');
        }
      });

      addAudit(req.user.id, req.user.username, 'server.start', `Started: ${srv.name}`);
      res.json({ message: 'Starting...' });
    } catch (err) {
      state.status = 'crashed'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
      addLog(srv.id, 'error', 'server', `Start failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/stop', authForServer('server.stop'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id];
    if (!state || state.status === 'stopped') return res.status(400).json({ error: 'Not running' });

    state.status = 'stopping'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'stopping' });
    addLog(srv.id, 'info', 'server', `Stop initiated by ${req.user.username}`);
    try {
      if (state.rcon?.loggedIn) { try { await state.rcon.shutdown(); await new Promise(r => setTimeout(r, 5000)); } catch {} }
      await killProcess(state.pid, srv.executable);
      stopSidecar(srv.id); // Stop the sidecar alongside the server
      state.status = 'stopped'; state.pid = null; state.process = null; state.players = []; state.startedAt = null;
      ctx.io.emit('serverStatus', { serverId: srv.id, status: 'stopped' });
      ctx.io.emit('players', { serverId: srv.id, players: [] });
      addAudit(req.user.id, req.user.username, 'server.stop', `Stopped: ${srv.name}`);
      addNotification(srv.id, 'server.stopped', 'Server Stopped', `${srv.name} has been stopped`, 'info');
      fireWebhooks('server.stopped', { serverId: srv.id, serverName: srv.name });
      sendDiscordWebhook(`🔴 **${srv.name}** stopped`);
      // Execute stopped hooks (blocking, sequential)
      executeHooks(srv.id, 'stopped').catch(() => {});
      res.json({ message: 'Stopped' });
    } catch {
      stopSidecar(srv.id);
      state.status = 'stopped'; state.pid = null;
      ctx.io.emit('serverStatus', { serverId: srv.id, status: 'stopped' });
      res.json({ message: 'Stopped (force)' });
    }
  });

  app.post('/api/servers/:id/restart', authForServer('server.restart'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id];
    if (!state) return res.status(500).json({ error: 'State not initialized' });

    addAudit(req.user.id, req.user.username, 'server.restart', `Restarting: ${srv.name}`);
    const result = await restartServer(srv.id, `Manual restart by ${req.user.username}`);
    addAudit(req.user.id, req.user.username, 'server.restart', `Restarted: ${srv.name} (success: ${result.success})`);

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

  app.post('/api/servers/:id/update', authForServer('server.restart'), async (req, res) => {
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
