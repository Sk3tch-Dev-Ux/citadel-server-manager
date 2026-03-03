/**
 * Shared server lifecycle operations.
 *
 * Centralizes the restart sequence so it can be reused by:
 *   - Manual restart (server-control.routes.js)
 *   - Health monitoring auto-restart (polling.js)
 *   - Future: auto-updater restart (auto-updater.js)
 *   - Future: scheduled restart (scheduler-engine.js)
 *
 * Includes lifecycle hooks at each stage.
 */
const logger = require('./logger');
const ctx = require('./context');
const { detectProcessByPid, killProcess, spawnDayZServer } = require('./process-manager');
const { startSidecar, stopSidecar } = require('./sidecar-manager');
const { addLog } = require('./audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('./notifications');
const { executeHooks } = require('./lifecycle-hooks');
const { MAX_RESTART_ATTEMPTS, RESTART_DELAY_MS } = require('./constants');

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

  addLog(serverId, 'info', 'server', `Restart initiated: ${reason}`);
  state.status = 'stopping';
  ctx.io.emit('serverStatus', { serverId, status: 'stopping' });
  stopSidecar(serverId);

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

      await new Promise(r => setTimeout(r, RESTART_DELAY_MS));

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

  return { success: restartSuccess, error: lastError };
}

module.exports = { restartServer };
