/**
 * Server Crash Detection & Auto-Restart.
 *
 * Extracted from polling.js — handles:
 *   - Detecting when a server's PID disappears while status is 'running'
 *   - Transitioning server state to 'crashed'
 *   - Auto-restarting with exponential backoff (if enabled)
 *   - Clearing players and PID from state
 *   - Emitting crash status and empty player list via Socket.IO
 *   - Firing crash notifications, webhooks, and Discord alerts
 *   - Executing 'crashed' lifecycle hooks
 *   - Circuit breaker: max 10 restarts per hour
 *
 * Called from the 15-second polling tick when a previously-running
 * server's PID can no longer be detected.
 */
const ctx = require('./context');
const { addLog } = require('./audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('./notifications');
const { executeHooks } = require('./lifecycle-hooks');
const { restartServer } = require('./server-lifecycle');
const { getNextBackoffDelay } = require('./backoff');
const {
  CRASH_BACKOFF_DELAYS_MS,
  CRASH_COOLDOWN_WINDOW_MS,
  MAX_CRASH_RESTARTS_PER_HOUR,
} = require('./constants');

/** Hour in milliseconds */
const HOUR_MS = 60 * 60 * 1000;

/** Track restart history for circuit breaker (serverId -> [timestamps]) */
const _crashRestartHistory = new Map();

/** Track backoff state per server */
const _crashBackoffState = new Map();

/**
 * Check if we can attempt another auto-restart (circuit breaker).
 * Returns true if we have restart attempts remaining in this hour.
 */
function canAttemptCrashRestart(serverId) {
  if (!_crashRestartHistory.has(serverId)) {
    _crashRestartHistory.set(serverId, []);
  }

  const history = _crashRestartHistory.get(serverId);
  const now = Date.now();
  const oneHourAgo = now - HOUR_MS;

  // Prune old restart attempts outside the rolling hour window
  const recentAttempts = history.filter(ts => ts > oneHourAgo);
  _crashRestartHistory.set(serverId, recentAttempts);

  const remaining = MAX_CRASH_RESTARTS_PER_HOUR - recentAttempts.length;
  return remaining > 0;
}

/**
 * Record a crash restart attempt for circuit breaker.
 */
function recordCrashRestart(serverId) {
  if (!_crashRestartHistory.has(serverId)) {
    _crashRestartHistory.set(serverId, []);
  }
  _crashRestartHistory.get(serverId).push(Date.now());
}

/** Crash/circuit-breaker stats for a server (for /health/deep). */
function getCrashStats(serverId) {
  const history = _crashRestartHistory.get(serverId) || [];
  const recent = history.filter((ts) => ts > Date.now() - HOUR_MS);
  return {
    restartsLastHour: recent.length,
    breakerTripped: recent.length >= MAX_CRASH_RESTARTS_PER_HOUR,
    lastRestartAt: history.length ? new Date(Math.max(...history)).toISOString() : null,
  };
}

/** Clear per-server crash state (called when a server is deleted). */
function forget(serverId) {
  _crashRestartHistory.delete(serverId);
  _crashBackoffState.delete(serverId);
}

/**
 * Handle crash detection for a server whose PID has disappeared.
 *
 * Only call this when the server's status was 'running' and the PID
 * check returned false (process no longer exists).
 *
 * @param {object} srv - Server configuration object
 * @param {object} state - Server runtime state from ctx.serverStates
 */
async function handleCrash(srv, state) {
  addLog(srv.id, 'error', 'server', 'Process no longer running');

  // Transition to crashed state
  state.status = 'crashed';
  state.players = [];
  state.pid = null;
  state.process = null;

  // Emit status updates
  ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
  ctx.io.emit('players', { serverId: srv.id, players: [] });

  // Notifications and webhooks
  addNotification(srv.id, 'server.crashed', 'Server Crashed', `${srv.name} is no longer running`, 'error');
  fireWebhooks('server.crashed', { serverId: srv.id, serverName: srv.name });
  sendDiscordWebhook(`💥 **${srv.name}** crashed`);

  // Execute crashed hooks (blocking, sequential)
  executeHooks(srv.id, 'crashed').catch(() => {});

  // Auto-restart if enabled
  if (srv.autoRestart !== false) { // default enabled
    if (!canAttemptCrashRestart(srv.id)) {
      addLog(srv.id, 'error', 'server', 'Auto-restart disabled: circuit breaker limit reached (10 restarts/hour)');
      addNotification(srv.id, 'server.crashed', 'Auto-Restart Blocked', `${srv.name}: Circuit breaker triggered (max 10 restarts/hour)`, 'error');
      sendDiscordWebhook(`⚠️ **${srv.name}**: Auto-restart circuit breaker activated`);
      return;
    }

    recordCrashRestart(srv.id);
    const delayMs = getNextBackoffDelay(_crashBackoffState, srv.id, CRASH_BACKOFF_DELAYS_MS, CRASH_COOLDOWN_WINDOW_MS);
    const delaySec = Math.round(delayMs / 1000);

    addLog(srv.id, 'info', 'server', `Scheduling auto-restart in ${delaySec}s (exponential backoff)`);
    addNotification(srv.id, 'server.crashed', 'Auto-Restart Scheduled', `${srv.name} will restart in ${delaySec}s`, 'warn');
    sendDiscordWebhook(`🔄 **${srv.name}** will auto-restart in ${delaySec}s`);

    setTimeout(() => {
      if (state.status === 'crashed') { // Verify still crashed (not manually started)
        addLog(srv.id, 'info', 'server', 'Executing auto-restart after crash');
        restartServer(srv.id, `auto-restart after crash (backoff delay: ${delaySec}s)`)
          .then(result => {
            if (!result.success) {
              addLog(srv.id, 'error', 'server', `Auto-restart failed: ${result.error}`);
            }
          })
          .catch(err => addLog(srv.id, 'error', 'server', `Auto-restart exception: ${err.message}`));
      }
    }, delayMs);
  }
}

module.exports = { handleCrash, canAttemptCrashRestart, recordCrashRestart, getCrashStats, forget };
