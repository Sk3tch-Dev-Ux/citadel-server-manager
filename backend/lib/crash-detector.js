/**
 * Server Crash Detection.
 *
 * Extracted from polling.js — handles:
 *   - Detecting when a server's PID disappears while status is 'running'
 *   - Transitioning server state to 'crashed'
 *   - Clearing players and PID from state
 *   - Emitting crash status and empty player list via Socket.IO
 *   - Firing crash notifications, webhooks, and Discord alerts
 *   - Executing 'crashed' lifecycle hooks
 *
 * Called from the 15-second polling tick when a previously-running
 * server's PID can no longer be detected.
 */
const ctx = require('./context');
const { addLog } = require('./audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('./notifications');
const { executeHooks } = require('./lifecycle-hooks');

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
  sendDiscordWebhook(`\ud83d\udca5 **${srv.name}** crashed`);

  // Execute crashed hooks (blocking, sequential)
  executeHooks(srv.id, 'crashed').catch(() => {});
}

module.exports = { handleCrash };
