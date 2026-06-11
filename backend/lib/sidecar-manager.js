/**
 * Sidecar lifecycle manager.
 * Spawns / stops one sidecar process per DayZ server.
 *
 * The sidecar (sidecar/server.js) is a lightweight Express app that bridges
 * the Citadel backend to the @CitadelAdmin DayZ mod via file-based IPC.
 *
 * Each server gets its own sidecar on a unique port derived from gamePort:
 *   sidecarPort = 9100 + (gamePort - 2302)
 */
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const ctx = require('./context');

const { ROOT: PROJECT_ROOT, SIDECAR_ENTRY } = require('./paths');

/**
 * Derive sidecar port from server's game port.
 * Default game port 2302 → sidecar 9100.
 */
function getSidecarPort(srv) {
  const gamePort = parseInt(srv.gamePort) || 2302;
  return 9100 + (gamePort - 2302);
}

/**
 * Start the sidecar process for a server.
 * No-op if already running.
 */
function startSidecar(srv) {
  const state = ctx.serverStates[srv.id];
  if (!state) return;

  // Prevent concurrent start attempts
  if (state._sidecarStarting) {
    logger.debug({ serverId: srv.id }, 'Sidecar start already in progress, skipping');
    return;
  }

  // Already running? Verify PID is still alive
  if (state.sidecarPid) {
    try {
      process.kill(state.sidecarPid, 0); // Signal 0 = existence check
      logger.debug({ serverId: srv.id }, 'Sidecar already running, skipping start');
      return;
    } catch {
      // Process is gone — clean up stale references
      logger.debug({ serverId: srv.id, stalePid: state.sidecarPid }, 'Sidecar PID stale, cleaning up');
      state.sidecarPid = null;
      state.sidecarProcess = null;
    }
  }

  state._sidecarStarting = true;

  const sidecarPort = getSidecarPort(srv);
  const profileDir = path.join(srv.installDir, srv.profileDir || 'profiles');

  const env = {
    ...process.env,
    // Default the sidecar to production logging — its pino-pretty transport
    // is a devDependency and doesn't exist on installed builds.
    NODE_ENV: process.env.NODE_ENV || 'production',
    DAYZ_INSTALL_DIR: srv.installDir,
    DAYZ_PROFILE_DIR: profileDir,
    SIDECAR_PORT: String(sidecarPort),
  };

  // Pass API key if configured
  if (srv.inHouseApiKey) {
    env.SIDECAR_API_KEY = srv.inHouseApiKey;
  }

  logger.info({ server: srv.name, port: sidecarPort, installDir: srv.installDir }, 'Starting sidecar');

  try {
    const child = spawn(process.execPath, [SIDECAR_ENTRY], {
      env,
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    if (child.pid) {
      state.sidecarProcess = child;
      state.sidecarPid = child.pid;
      state._sidecarStarting = false;
      logger.info({ server: srv.name, sidecarPid: child.pid, port: sidecarPort }, 'Sidecar started');
    } else {
      state._sidecarStarting = false;
      logger.error({ server: srv.name }, 'Sidecar spawn returned no PID');
    }

    child.on('error', (err) => {
      logger.error({ server: srv.name, err: err.message }, 'Sidecar process error');
      state.sidecarPid = null;
      state.sidecarProcess = null;
    });

    child.on('exit', (code) => {
      logger.info({ server: srv.name, code }, 'Sidecar process exited');
      state.sidecarPid = null;
      state.sidecarProcess = null;
    });
  } catch (err) {
    state._sidecarStarting = false;
    logger.error({ err, server: srv.name }, 'Failed to start sidecar');
  }
}

/**
 * Stop the sidecar process for a server.
 */
function stopSidecar(serverId) {
  const state = ctx.serverStates[serverId];
  if (!state) return;

  const pid = state.sidecarPid;
  if (!pid) return;

  logger.info({ serverId, sidecarPid: pid }, 'Stopping sidecar');
  try {
    process.kill(pid);
  } catch (err) {
    // ESRCH = process already gone
    if (err.code !== 'ESRCH') {
      logger.warn({ err, serverId, pid }, 'Failed to kill sidecar');
    }
  }
  state.sidecarPid = null;
  state.sidecarProcess = null;
}

/**
 * Check if the sidecar is running for a server.
 */
function isSidecarRunning(serverId) {
  const state = ctx.serverStates[serverId];
  if (!state?.sidecarPid) return false;
  try {
    process.kill(state.sidecarPid, 0); // Signal 0 = existence check
    return true;
  } catch {
    state.sidecarPid = null;
    state.sidecarProcess = null;
    return false;
  }
}

module.exports = { startSidecar, stopSidecar, isSidecarRunning, getSidecarPort };
