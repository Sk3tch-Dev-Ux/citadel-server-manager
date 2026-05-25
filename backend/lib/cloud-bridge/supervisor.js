/**
 * Cloud-bridge supervisor — owns one CloudWsClient per linked DayZ server,
 * watching ctx.servers[] + serverStates[] + storage links so the WS lifecycle
 * tracks what's actually true.
 *
 * Reconcile rules (per local server):
 *   linked && running  →  client started, expected status 'connected'
 *   linked && !running →  client stopped (no point burning a WS slot when
 *                         the server has no telemetry to push); status
 *                         persists as 'disconnected'
 *   !linked            →  client stopped + cleared
 *
 * A 5-second tick is the safety net; routes also call `reconcileOne(id)`
 * directly on link/unlink/server-start so changes are picked up instantly
 * in the common path.
 *
 * Status writes-through to storage.updateStatus so the UI can read live
 * state from a single source.
 */
const ctx = require('../context');
const storage = require('./storage');
const { CloudWsClient } = require('./ws-client');
const { Forwarder } = require('./forwarders');
const logger = require('../logger');

// Reconcile cadence. 5s keeps changes snappy without being chatty —
// reconcileOne() does no I/O when nothing's changed.
const TICK_MS = 5_000;

// One client per local server id. Map<localServerId, CloudWsClient>.
const _clients = new Map();

// One forwarder per local server id, attached only while the client is
// authenticated. We keep the instance across reconnects so the session-start
// cache (used to compute disconnect durations) survives a flap.
const _forwarders = new Map();

// Process-wide tick timer.
let _tickTimer = null;

// Set true after start() so reconcileOne is safe to call from routes that
// race the boot sequence (rare but harmless).
let _started = false;

function _agentVersion() {
  // Best-effort. ../../../package.json relative to this file lives in
  // the project root in source layout; in the bundled build it lives next
  // to citadel-server.js. Try both, fall back to a placeholder so the
  // cloud's plugin_version column always has something useful.
  try { return require('../../../package.json').version || 'unknown'; } catch { /* fall through */ }
  try { return require('../../package.json').version || 'unknown'; } catch { /* fall through */ }
  return 'unknown';
}

function _cloudUrl() {
  // Same env var as the license client uses, so a dev pointed at a local
  // citadel-cloud instance picks both up consistently.
  // CITADEL_LICENSE_API is the REST base ('https://api.citadels.cc'); the
  // WS path is the same host, so we reuse it.
  return process.env.CITADEL_LICENSE_API || 'https://api.citadels.cc';
}

function _isRunning(localServerId) {
  const state = ctx.serverStates?.[localServerId];
  return state && state.status === 'running';
}

/** Reconcile one local server. Idempotent — safe to call repeatedly. */
function reconcileOne(localServerId) {
  if (!_started) return;
  const srv = ctx.servers.find((s) => s.id === localServerId);
  if (!srv) {
    _stopClient(localServerId);
    return;
  }
  const link = storage.getPublic(localServerId);
  const running = _isRunning(localServerId);

  // Stop when not linked or not running.
  if (!link || !running) {
    if (_clients.has(localServerId)) {
      _stopClient(localServerId);
      if (link && !running) {
        // Keep last status sensible — "disconnected" reflects reality.
        storage.updateStatus(localServerId, 'disconnected', null);
      }
    }
    return;
  }

  // Already running; nothing to do.
  if (_clients.has(localServerId)) return;

  _startClient(localServerId, srv);
}

function _startClient(localServerId, srv) {
  let secret;
  try {
    secret = storage.getSecret(localServerId);
  } catch (err) {
    logger.warn({ err: err.message, localServerId }, 'cloud-bridge: missing secret for linked server, skipping');
    return;
  }

  const client = new CloudWsClient({
    cloudUrl: _cloudUrl(),
    apiKey: secret.apiKey,
    pluginVersion: _agentVersion(),
    gameVersion: srv.gameTitle === 'DayZ, PC (Experimental)' ? 'experimental' : 'stable',
    serverName: srv.name || 'DayZ Server',
    map: srv.map || 'chernarusplus',
    maxPlayers: Number.isFinite(srv.maxPlayers) ? srv.maxPlayers : 60,
  });

  client.on('authenticated', (cloudServerId) => {
    storage.updateStatus(localServerId, 'connected', null);
    logger.info({ localServerId, cloudServerId }, 'cloud-bridge: link is live');
    // Attach the telemetry forwarders now that the cloud has accepted us.
    // Phase 3 ships metrics / player_position / player_connect+disconnect.
    // The forwarder is idempotent so reconnect→reauth is safe to repeat.
    _attachForwarder(localServerId, client);
  });
  client.on('auth-failed', (reason) => {
    storage.updateStatus(localServerId, 'auth-failed', String(reason || 'auth refused'));
    logger.warn({ localServerId, reason }, 'cloud-bridge: auth refused — operator must update the link');
  });
  client.on('disconnected', ({ code, reason }) => {
    // Detach forwarders so we don't queue sends into a dead socket. The
    // forwarder instance stays alive in _forwarders to preserve the
    // session-start cache across the reconnect.
    _detachForwarder(localServerId);
    // The auth-failed path also fires disconnected — preserve the more
    // useful auth-failed status by not overwriting it here.
    const cur = storage.getPublic(localServerId);
    if (cur && cur.lastStatus === 'auth-failed') return;
    storage.updateStatus(localServerId, 'disconnected', reason ? `closed ${code}: ${reason}` : `closed ${code}`);
  });
  client.on('message', (msg) => {
    // Inbound cloud→agent messages — commands + config-sync. Not wired to
    // local action executors yet; this is the Phase 5 / Phase 6 work in
    // the sync plan. Log so we know payloads are coming through.
    logger.debug({ localServerId, type: msg?.type }, 'cloud-bridge: inbound message');
  });

  _clients.set(localServerId, client);
  client.start();
}

function _stopClient(localServerId) {
  const client = _clients.get(localServerId);
  if (!client) return;
  // Detach forwarders FIRST so any in-flight bridge events don't try to
  // send into a closing socket. Then drop the forwarder instance entirely
  // (unlike the disconnect path, which keeps it warm for reconnect).
  _detachForwarder(localServerId);
  _forwarders.delete(localServerId);
  try { client.stop(); } catch (err) {
    logger.debug({ err: err.message, localServerId }, 'cloud-bridge: stop threw, ignoring');
  }
  _clients.delete(localServerId);
}

function _attachForwarder(localServerId, client) {
  let fwd = _forwarders.get(localServerId);
  if (!fwd) {
    fwd = new Forwarder(localServerId);
    _forwarders.set(localServerId, fwd);
  }
  try { fwd.attach(client); } catch (err) {
    logger.warn({ err: err.message, localServerId }, 'cloud-bridge: forwarder.attach threw');
  }
}

function _detachForwarder(localServerId) {
  const fwd = _forwarders.get(localServerId);
  if (!fwd) return;
  try { fwd.detach(); } catch (err) {
    logger.debug({ err: err.message, localServerId }, 'cloud-bridge: forwarder.detach threw');
  }
}

/** Walk every server and reconcile. Used by the boot path and the tick. */
function reconcileAll() {
  if (!_started) return;
  const seen = new Set();
  for (const srv of ctx.servers || []) {
    seen.add(srv.id);
    reconcileOne(srv.id);
  }
  // Clean up clients for servers that were deleted from ctx.servers.
  for (const id of Array.from(_clients.keys())) {
    if (!seen.has(id)) _stopClient(id);
  }
}

/**
 * Boot the supervisor. Call once from server.js after ctx is populated.
 */
function start() {
  if (_started) return;
  _started = true;
  logger.info('cloud-bridge: supervisor starting');
  reconcileAll();
  _tickTimer = setInterval(reconcileAll, TICK_MS);
}

/**
 * Stop everything. Called on graceful shutdown so we close sockets cleanly
 * instead of letting the cloud's idle timer reap them.
 */
function shutdownAll() {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  for (const id of Array.from(_clients.keys())) _stopClient(id);
  _started = false;
}

module.exports = {
  start,
  shutdownAll,
  reconcileOne,
  reconcileAll,
};
