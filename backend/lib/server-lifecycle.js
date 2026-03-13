/**
 * Shared server lifecycle operations.
 *
 * Centralizes start/stop/restart so they can be reused by:
 *   - Manual control (server-control.routes.js)
 *   - Discord bot (discord.routes.js)
 *   - Health monitoring auto-restart (polling.js)
 *   - Auto-updater restart (auto-updater.js)
 *   - Scheduled restart (scheduler-engine.js)
 *
 * Includes lifecycle hooks, sidecar/tailer management, audit, notifications.
 */
const logger = require('./logger');
const ctx = require('./context');
const { detectRunningProcess, detectProcessByPid, killProcess, spawnDayZServer } = require('./process-manager');
const { startSidecar, stopSidecar } = require('./sidecar-manager');
const { addLog } = require('./audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('./notifications');
const { executeHooks } = require('./lifecycle-hooks');
const { checkPortAvailability } = require('./port-checker');
const { ensureFirewallRules } = require('./firewall-manager');
const { MAX_RESTART_ATTEMPTS, RESTART_BACKOFF_DELAYS_MS, RESTART_BACKOFF_COOLDOWN_MS } = require('./constants');
const { stopTailing, startTailing } = require('./rpt-tailer');
const { getNextBackoffDelay } = require('./backoff');

/** Sync bans and priority queue to a server's local files */
function _syncServerData(serverId) {
  require('./ban-engine').syncAllBansToServer(serverId);
  require('./priority-engine').syncToServer(serverId);
}

/** Guard: prevent concurrent restart operations on the same server */
const _pendingRestarts = new Set();

/** Track restart backoff state per server */
const _restartBackoffState = new Map();

/**
 * Start a server through the full lifecycle: port check -> firewall -> hooks -> spawn -> verify.
 *
 * @param {string} serverId - The server ID to start
 * @param {string} reason - Human-readable reason (for logging)
 * @returns {Promise<{success: boolean, message: string|null, error: string|null}>}
 */
async function startServer(serverId, reason) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return { success: false, error: 'Server not found' };

  const state = ctx.serverStates[serverId];
  if (!state) return { success: false, error: 'Server state not initialized' };

  if (state.status === 'running' || state.status === 'starting') {
    return { success: true, message: `Server is already ${state.status}` };
  }

  // Check if process is already running externally
  const existingPid = await detectRunningProcess(srv.executable);
  if (existingPid) {
    state.pid = existingPid;
    state.status = 'running';
    state.startedAt = new Date().toISOString();
    ctx.io.emit('serverStatus', { serverId, status: 'running' });
    startSidecar(srv);
    _syncServerData(serverId);
    return { success: true, message: `Already running (PID: ${existingPid})` };
  }

  addLog(serverId, 'info', 'server', `Start initiated: ${reason}`);

  // Check for port conflicts
  try {
    const ports = [srv.gamePort, srv.queryPort, srv.rconPort].filter(Boolean).map(Number);
    const portCheck = await checkPortAvailability(ports, serverId);
    if (!portCheck.available) {
      const details = portCheck.conflicts.map(c => `Port ${c.port} used by ${c.usedBy}`).join('; ');
      addLog(serverId, 'error', 'server', `Port conflict detected: ${details}`);
      return { success: false, error: `Port conflict: ${details}` };
    }
  } catch (err) {
    addLog(serverId, 'warn', 'server', `Port check failed (proceeding anyway): ${err.message}`);
  }

  // Ensure firewall rules (non-blocking)
  ensureFirewallRules(srv.name, { gamePort: srv.gamePort, queryPort: srv.queryPort, rconPort: srv.rconPort })
    .catch(err => addLog(serverId, 'warn', 'server', `Firewall rule setup failed: ${err.message}`));

  state.status = 'starting';
  ctx.io.emit('serverStatus', { serverId, status: 'starting' });

  try {
    // Execute pre-start hooks — abort if any fails
    const preStartResult = await executeHooks(serverId, 'pre-start');
    if (!preStartResult.success) {
      state.status = 'stopped';
      ctx.io.emit('serverStatus', { serverId, status: 'stopped' });
      addLog(serverId, 'warn', 'server', `Start aborted by pre-start hook: ${preStartResult.hook}`);
      return { success: false, error: `Start aborted by pre-start hook: ${preStartResult.hook}` };
    }

    const { child, launchFailed } = spawnDayZServer(srv);
    state.process = child;
    state.pid = child.pid;

    if (!child.pid) {
      state.status = 'crashed';
      ctx.io.emit('serverStatus', { serverId, status: 'crashed' });
      addLog(serverId, 'error', 'server', 'Spawn returned no PID');
      return { success: false, error: 'Failed to spawn process (no PID)' };
    }

    addLog(serverId, 'info', 'server', `Process spawned with PID: ${child.pid}`);
    startSidecar(srv);
    _syncServerData(serverId);

    // Monitor launch asynchronously
    launchFailed.then(async (failReason) => {
      if (failReason) {
        addLog(serverId, 'error', 'server', `Launch failed: ${failReason}`);
        if (state.status === 'starting' || state.status === 'running') {
          state.status = 'crashed'; state.pid = null; state.process = null;
          ctx.io.emit('serverStatus', { serverId, status: 'crashed' });
          addNotification(serverId, 'server.crashed', 'Start Failed', `${srv.name}: ${failReason}`, 'error');
        }
        return;
      }
      const alive = await detectProcessByPid(child.pid);
      if (alive) {
        state.pid = child.pid; state.status = 'running'; state.startedAt = new Date().toISOString();
        ctx.io.emit('serverStatus', { serverId, status: 'running' });
        addLog(serverId, 'info', 'server', `Server is now running (PID: ${child.pid})`);
        addNotification(serverId, 'server.started', 'Server Started', `${srv.name} is now running`, 'success');
        fireWebhooks('server.started', { serverId, serverName: srv.name });
        sendDiscordWebhook(`🟢 **${srv.name}** started`);
        executeHooks(serverId, 'started').catch(() => {});
      } else if (state.status === 'starting') {
        addLog(serverId, 'error', 'server', `PID ${child.pid} not found after grace period`);
        state.status = 'crashed'; state.pid = null; state.process = null;
        ctx.io.emit('serverStatus', { serverId, status: 'crashed' });
        addNotification(serverId, 'server.crashed', 'Start Failed', `${srv.name} process disappeared`, 'error');
      }
    });

    return { success: true, message: 'Starting...' };
  } catch (err) {
    state.status = 'crashed';
    ctx.io.emit('serverStatus', { serverId, status: 'crashed' });
    addLog(serverId, 'error', 'server', `Start failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Stop a server through the full lifecycle: RCON shutdown -> kill -> sidecar/tailer stop -> hooks.
 *
 * @param {string} serverId - The server ID to stop
 * @param {string} reason - Human-readable reason (for logging)
 * @returns {Promise<{success: boolean, message: string|null, error: string|null}>}
 */
async function stopServer(serverId, reason) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return { success: false, error: 'Server not found' };

  const state = ctx.serverStates[serverId];
  if (!state || state.status === 'stopped') return { success: true, message: 'Not running' };

  state.status = 'stopping';
  ctx.io.emit('serverStatus', { serverId, status: 'stopping' });
  addLog(serverId, 'info', 'server', `Stop initiated: ${reason}`);

  try {
    // Graceful RCON shutdown first if available
    if (state.rcon?.loggedIn) {
      try { await state.rcon.shutdown(); await new Promise(r => setTimeout(r, 5000)); } catch {}
    }
    await killProcess(state.pid, srv.executable);
    stopSidecar(serverId);
    stopTailing(serverId);
    state.status = 'stopped'; state.pid = null; state.process = null; state.players = []; state.startedAt = null;
    ctx.io.emit('serverStatus', { serverId, status: 'stopped' });
    ctx.io.emit('players', { serverId, players: [] });
    addNotification(serverId, 'server.stopped', 'Server Stopped', `${srv.name} has been stopped`, 'info');
    fireWebhooks('server.stopped', { serverId, serverName: srv.name });
    sendDiscordWebhook(`🔴 **${srv.name}** stopped`);
    executeHooks(serverId, 'stopped').catch(() => {});
    return { success: true, message: 'Stopped' };
  } catch {
    stopSidecar(serverId);
    stopTailing(serverId);
    state.status = 'stopped'; state.pid = null;
    ctx.io.emit('serverStatus', { serverId, status: 'stopped' });
    return { success: true, message: 'Stopped (force)' };
  }
}

/**
 * Restart a server through the full lifecycle: kill -> wait -> hooks -> spawn -> verify.
 *
 * Includes lifecycle hooks:
 *   - stopped hooks after initial kill (first attempt only)
 *   - pre-start hooks before each spawn attempt (abort if hook fails)
 *   - started hooks after successful spawn verification
 *
 * @param {string} serverId - The server ID to restart
 * @param {string} reason - Human-readable reason for the restart (for logging)
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function restartServer(serverId, reason) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return { success: false, error: 'Server not found' };

  const state = ctx.serverStates[serverId];
  if (!state) return { success: false, error: 'Server state not initialized' };

  if (_pendingRestarts.has(serverId)) {
    addLog(serverId, 'warn', 'server', `Restart already in progress, skipping: ${reason}`);
    return { success: false, error: 'Restart already in progress' };
  }
  _pendingRestarts.add(serverId);

  addLog(serverId, 'info', 'server', `Restart initiated: ${reason}`);
  state.status = 'stopping';
  ctx.io.emit('serverStatus', { serverId, status: 'stopping' });
  stopSidecar(serverId);
  stopTailing(serverId);

  let restartSuccess = false;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RESTART_ATTEMPTS; attempt++) {
    try {
      // Kill the current process
      if (state.pid) {
        await killProcess(state.pid, srv.executable);
      }
      state.pid = null;
      state.process = null;
      state.players = [];

      // Execute stopped hooks on first attempt (server was just killed)
      if (attempt === 1) {
        await executeHooks(serverId, 'stopped').catch(() => {});
      }

      // Calculate exponential backoff delay for this attempt
      const delayMs = getNextBackoffDelay(_restartBackoffState, serverId, RESTART_BACKOFF_DELAYS_MS, RESTART_BACKOFF_COOLDOWN_MS);
      addLog(serverId, 'info', 'server', `Waiting ${Math.round(delayMs / 1000)}s before attempt ${attempt}`);
      await new Promise(r => setTimeout(r, delayMs));

      // Execute pre-start hooks before each spawn attempt
      const preStartResult = await executeHooks(serverId, 'pre-start');
      if (!preStartResult.success) {
        lastError = `Pre-start hook aborted restart: ${preStartResult.hook}`;
        addLog(serverId, 'warn', 'server', lastError);
        break; // Don't retry if a hook explicitly blocks start
      }

      state.status = 'starting';
      ctx.io.emit('serverStatus', { serverId, status: 'starting' });

      const { child, launchFailed } = spawnDayZServer(srv);
      state.process = child;
      state.pid = child.pid;

      // Wait for the launch monitor (10s) to see if it fails early
      const failReason = await launchFailed;
      if (failReason) {
        lastError = `Restart attempt ${attempt}: ${failReason}`;
        addLog(serverId, 'error', 'server', lastError);
        continue;
      }

      const alive = await detectProcessByPid(child.pid);
      if (alive) {
        state.pid = child.pid;
        state.status = 'running';
        state.startedAt = new Date().toISOString();
        ctx.io.emit('serverStatus', { serverId, status: 'running' });
        addNotification(serverId, 'server.restarted', 'Server Restarted', `${srv.name} restarted (${reason})`, 'info');
        fireWebhooks('server.restarted', { serverId, serverName: srv.name, reason });
        sendDiscordWebhook(`🔄 **${srv.name}** restarted (${reason})`);
        addLog(serverId, 'info', 'server', `Restart succeeded on attempt ${attempt}`);
        startSidecar(srv);
        startTailing(serverId);
        // Sync global bans to this server's ban.txt
        require('./ban-engine').syncAllBansToServer(serverId);
        // Sync priority queue to this server's priority.txt
        require('./priority-engine').syncToServer(serverId);
        // Fire started hooks (non-blocking)
        executeHooks(serverId, 'started').catch(() => {});
        restartSuccess = true;
        break;
      } else {
        lastError = `Process not detected after restart attempt ${attempt}`;
        addLog(serverId, 'error', 'server', lastError);
      }
    } catch (err) {
      lastError = `Restart attempt ${attempt} failed: ${err.message}`;
      addLog(serverId, 'error', 'server', lastError);
    }
  }

  if (!restartSuccess) {
    state.status = 'crashed';
    ctx.io.emit('serverStatus', { serverId, status: 'crashed' });
    addNotification(serverId, 'server.crashed', 'Restart Failed', `${srv.name} failed to restart after ${MAX_RESTART_ATTEMPTS} attempts`, 'error');
    fireWebhooks('server.crashed', { serverId, serverName: srv.name, reason });
    sendDiscordWebhook(`💥 **${srv.name}** failed to restart after ${MAX_RESTART_ATTEMPTS} attempts`);
  }

  _pendingRestarts.delete(serverId);
  return { success: restartSuccess, error: lastError };
}

module.exports = { startServer, stopServer, restartServer };
