/**
 * Polling Orchestrator.
 *
 * Thin coordinator that starts all polling loops and delegates to focused modules:
 *   - metrics-collector.js  — CPU/RAM/FPS sampling, player polling, health monitoring
 *   - crash-detector.js     — process disappearance detection, crash hooks & notifications
 *
 * Keeps in this file (tightly coupled or simple):
 *   - PID detection & status transitions (starting → running)
 *   - Steam update polling (integrated with auto-updater)
 *   - RCON connection management
 *   - Mod detection (simple periodic scan)
 *   - Map data scraping (simple, called from metrics-collector)
 *   - Startup detection & auto-start
 *   - Graceful shutdown
 */
const logger = require('./logger');
const ctx = require('./context');
const {
  METRICS_POLL_INTERVAL_MS,
  STEAM_UPDATE_POLL_INTERVAL_MS,
  MOD_DETECT_INTERVAL_MS,
  RCON_STARTUP_DELAY_MS,
  SHUTDOWN_FORCE_TIMEOUT_MS,
} = require('./constants');
const { loadJSON, saveJSON, flushAll } = require('./data-store');
const { detectRunningProcess, detectProcessByPid, spawnDayZServer, applyProcessSettings } = require('./process-manager');
const { fetchPlayers } = require('./player-data');
const { autoDetectMods } = require('./mod-manager');
const { addLog } = require('./audit');
const { addNotification, fireWebhooks } = require('./notifications');
const { startBackupEngine, runStartupBackups } = require('./backup-engine');
const { startSidecar, stopSidecar } = require('./sidecar-manager');
const { triggerAutoUpdate } = require('./auto-updater');
const { collectMetrics } = require('./metrics-collector');
const { handleCrash } = require('./crash-detector');
const { startTailing, stopTailing } = require('./rpt-tailer');

// ─── Steam Update Polling (persisted to disk) ───────────
// Tracking data is loaded lazily on first access (after CONFIG is initialized)
const _trackingFile = 'update-tracking.json';
let _trackingLoaded = false;
let lastModVersions = {};
let lastGameBuild = null;
// pendingModUpdates: { [workshopId]: { name, detectedAt, remoteVersion } }
let pendingModUpdates = {};

function _ensureTrackingLoaded() {
  if (_trackingLoaded) return;
  _trackingLoaded = true;
  try {
    const data = loadJSON(ctx.CONFIG.dataDir, _trackingFile, { gameBuild: null, modVersions: {}, pendingModUpdates: {} });
    lastModVersions = data.modVersions || {};
    lastGameBuild = data.gameBuild || null;
    pendingModUpdates = data.pendingModUpdates || {};
    logger.info({ gameBuild: lastGameBuild, modCount: Object.keys(lastModVersions).length }, 'Loaded persisted update tracking data');
  } catch (err) {
    logger.debug({ err }, 'Could not load update tracking — starting fresh');
  }
}

function _persistTracking() {
  saveJSON(ctx.CONFIG.dataDir, _trackingFile, {
    gameBuild: lastGameBuild,
    modVersions: lastModVersions,
    pendingModUpdates,
  });
}

/** Get pending mod updates for a server (based on its modList) */
function getPendingModUpdates(serverId) {
  _ensureTrackingLoaded();
  const state = ctx.serverStates[serverId];
  if (!state?.modList) return {};
  const result = {};
  for (const mod of state.modList) {
    if (mod.workshopId && pendingModUpdates[mod.workshopId]) {
      result[mod.workshopId] = pendingModUpdates[mod.workshopId];
    }
  }
  return result;
}

/** Clear a pending mod update after it has been installed */
function clearPendingModUpdate(workshopId) {
  _ensureTrackingLoaded();
  delete pendingModUpdates[workshopId];
  _persistTracking();
}

/** Get the last known game build */
function getLastGameBuild() {
  return lastGameBuild;
}

async function getWorkshopModVersion(workshopId) {
  try {
    const resp = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `itemcount=1&publishedfileids[0]=${workshopId}`,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await resp.json();
    const file = data?.response?.publishedfiledetails?.[0];
    return file ? file.time_updated : null;
  } catch { return null; }
}

/**
 * Batch-fetch workshop mod versions in a single API call.
 * The Steam API supports up to ~100 items per request.
 * Falls back to individual calls if the batch request fails.
 *
 * @param {string[]} workshopIds - Array of workshop IDs to check
 * @returns {Promise<Map<string, number>>} Map of workshopId -> time_updated
 */
async function getWorkshopModVersionsBatch(workshopIds) {
  if (!workshopIds.length) return new Map();

  // Steam API supports batch queries — encode all IDs in one request
  const BATCH_SIZE = 100;
  const results = new Map();

  for (let i = 0; i < workshopIds.length; i += BATCH_SIZE) {
    const batch = workshopIds.slice(i, i + BATCH_SIZE);
    try {
      const bodyParts = [`itemcount=${batch.length}`];
      batch.forEach((id, idx) => bodyParts.push(`publishedfileids[${idx}]=${id}`));

      const resp = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParts.join('&'),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await resp.json();
      const details = data?.response?.publishedfiledetails || [];
      for (const file of details) {
        if (file.publishedfileid && file.time_updated) {
          results.set(file.publishedfileid, file.time_updated);
        }
      }
    } catch (err) {
      logger.debug({ err: err.message, batchSize: batch.length }, 'Batch workshop version check failed, falling back to individual');
      // Fallback to individual calls for this batch
      for (const id of batch) {
        const ver = await getWorkshopModVersion(id);
        if (ver) results.set(id, ver);
      }
    }
  }

  return results;
}

/**
 * Get the latest DayZ dedicated server build ID via SteamCMD app_info_print.
 * Falls back to reading the local appmanifest file if SteamCMD is unavailable.
 *
 * @param {string} [serverAppId='223350'] - The Steam app ID (223350 stable, 1042420 experimental)
 * @returns {Promise<string|null>} Build ID string or null
 */
async function getDayZBuildVersion(serverAppId) {
  const appId = serverAppId || ctx.CONFIG.steam.serverAppId || '223350';
  const { spawn } = require('child_process');

  try {
    // Try SteamCMD app_info_print for the remote build ID
    const cmdPath = ctx.steamCmdPath;
    if (!cmdPath) return null;

    const result = await new Promise((resolve) => {
      const proc = spawn(cmdPath, [
        '+login', 'anonymous',
        '+app_info_update', '1',
        '+app_info_print', appId,
        '+quit',
      ], { cwd: require('path').dirname(cmdPath), windowsHide: true });

      let output = '';
      const handleData = (data) => { output += data.toString(); };
      proc.stdout?.on('data', handleData);
      proc.stderr?.on('data', handleData);

      const timeout = setTimeout(() => {
        try { proc.kill(); } catch { /* ok */ }
        resolve(null);
      }, 30_000);

      proc.on('exit', () => {
        clearTimeout(timeout);
        // Parse buildid from app_info_print output
        // Format: "buildid"		"XXXXXXX"
        const match = output.match(/"buildid"\s+"(\d+)"/);
        resolve(match ? match[1] : null);
      });
      proc.on('error', () => { clearTimeout(timeout); resolve(null); });
    });

    return result;
  } catch {
    return null;
  }
}

// ─── Metrics & Status Polling (every 15s) ────────────────
let _metricsPollingRunning = false;

function startMetricsPolling() {
  return setInterval(async () => {
    // Prevent overlapping polling cycles
    if (_metricsPollingRunning) return;
    _metricsPollingRunning = true;
    try {
    for (const srv of ctx.servers) {
      const state = ctx.serverStates[srv.id];
      if (!state || (state.status !== 'running' && state.status !== 'starting')) continue;

      // Per-server try/catch: one server's error must not skip or crash all others
      try {
        // Skip if this server is in the middle of a state transition (restart/stop)
        if (state._stateTransitioning) continue;

        // If we have a known PID, verify that specific PID is still alive
        // rather than searching by executable name (which could match a different instance)
        let pid;
        if (state.pid) {
          const alive = await detectProcessByPid(state.pid);
          pid = alive ? state.pid : null;
        } else {
          pid = await detectRunningProcess(srv.executable);
        }
        if (pid) {
          state.pid = pid;
          if (state.status !== 'running') {
            state.status = 'running'; state.startedAt = state.startedAt || new Date().toISOString();
            ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
            startTailing(srv.id);
          }
          // Self-heal: if the sidecar or DZSA endpoint died while the game server
          // kept running, re-establish them. Both starts are idempotent (no-op
          // when already alive), so this is a cheap per-tick reconcile.
          try { startSidecar(srv); } catch { /* best effort */ }
          try { require('./dzsa-publisher').start(srv); } catch { /* best effort */ }
          // Delegate metrics collection + health monitoring to focused module
          await collectMetrics(srv, state, pid);
        } else if (state.status === 'running') {
          stopTailing(srv.id);
          // Delegate crash handling to focused module
          await handleCrash(srv, state);
        }
      } catch (err) {
        logger.error({ err, serverId: srv.id, serverName: srv.name }, 'Metrics polling error for server (continuing to next)');
      }
    }
    } finally { _metricsPollingRunning = false; }
  }, METRICS_POLL_INTERVAL_MS);
}

// ─── Startup detection + auto-start ──────────────────────
async function runStartupDetection() {
  // Track PIDs already claimed so two servers with the same executable
  // don't both attach to a single process
  const claimedPids = new Set();
  for (const srv of ctx.servers) {
    const state = ctx.serverStates[srv.id];
    if (state) {
      if (!state.logs) state.logs = [];
      addLog(srv.id, 'info', 'server', `Server state initialized for ${srv.name}`);
    }
    const pid = await detectRunningProcess(srv.executable);
    if (pid && !claimedPids.has(pid)) {
      claimedPids.add(pid);
      state.pid = pid; state.status = 'running'; state.startedAt = new Date().toISOString();
      ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
      addLog(srv.id, 'info', 'server', `Detected running process for ${srv.name} (PID: ${pid})`);
      applyProcessSettings(pid, srv);
      startSidecar(srv); // Ensure sidecar is running for live map
      try { require('./dzsa-publisher').start(srv); } catch { /* best effort */ }
      startTailing(srv.id); // Stream RPT output to console
    } else if (pid && claimedPids.has(pid)) {
      addLog(srv.id, 'info', 'server', `PID ${pid} already claimed by another server instance — skipping`);
    }
  }
  // Auto-start servers that have autoStart enabled and aren't already running
  for (const srv of ctx.servers) {
    const state = ctx.serverStates[srv.id];
    if (srv.autoStart && state?.status !== 'running') {
      logger.info({ server: srv.name }, 'Auto-starting server');
      try {
        state.status = 'starting'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
        const { child, launchFailed } = spawnDayZServer(srv);
        state.process = child; state.pid = child.pid;
        startSidecar(srv); // Start sidecar alongside auto-started server
        try { require('./dzsa-publisher').start(srv); } catch { /* best effort */ }
        addLog(srv.id, 'info', 'server', `Auto-start initiated (PID: ${child.pid || 'none'})`);
        launchFailed.then(async (failReason) => {
          if (failReason) {
            addLog(srv.id, 'error', 'server', `Auto-start failed: ${failReason}`);
            state.status = 'crashed'; state.pid = null; state.process = null;
            ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
            return;
          }
          const alive = await detectProcessByPid(child.pid);
          if (alive) {
            state.pid = child.pid; state.status = 'running'; state.startedAt = new Date().toISOString();
            ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
            startTailing(srv.id);
            addLog(srv.id, 'info', 'server', 'Auto-start: server is now running');
          } else {
            addLog(srv.id, 'error', 'server', 'Auto-start: process disappeared after grace period');
            state.status = 'crashed'; state.pid = null; state.process = null;
            ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
          }
        });
      } catch (err) {
        logger.error({ err, server: srv.name }, 'Auto-start failed');
        addLog(srv.id, 'error', 'server', 'Auto-start failed: ' + err.message);
      }
    }
  }
}

// ─── Steam update polling (every 15 minutes) ─────────────
let _steamPollRunning = false;
function startSteamUpdatePolling() {
  _ensureTrackingLoaded();
  return setInterval(async () => {
    // Re-entrancy guard: a slow SteamCMD/network poll must not overlap with the
    // next interval (which would spawn concurrent SteamCMD processes and race
    // the shared lastModVersions/pendingModUpdates state).
    if (_steamPollRunning) return;
    _steamPollRunning = true;
    try {
    // ─── Batch mod version check across ALL servers ───────────
    // Collect all unique workshopIds from all servers, then make ONE batched
    // Steam API call instead of N sequential calls. A typical server with
    // 40+ mods previously made 40+ HTTP requests; now it's 1.
    const modsByWorkshopId = new Map(); // workshopId -> { name, serverIds[] }
    for (const srv of ctx.servers) {
      const state = ctx.serverStates[srv.id];
      if (!state) continue;
      const ignoreModUpdates = srv.ignoreModUpdates ?? srv.ignoreServerModUpdates ?? false;
      if (ignoreModUpdates || !Array.isArray(state.modList)) continue;
      for (const mod of state.modList) {
        if (!mod.workshopId) continue;
        if (!modsByWorkshopId.has(mod.workshopId)) {
          modsByWorkshopId.set(mod.workshopId, { name: mod.name, serverIds: [] });
        }
        modsByWorkshopId.get(mod.workshopId).serverIds.push(srv.id);
      }
    }

    if (modsByWorkshopId.size > 0) {
      const batchResults = await getWorkshopModVersionsBatch([...modsByWorkshopId.keys()]);

      for (const [workshopId, remoteVersion] of batchResults) {
        const modInfo = modsByWorkshopId.get(workshopId);
        if (!modInfo) continue;

        if (remoteVersion && lastModVersions[workshopId] && remoteVersion > lastModVersions[workshopId]) {
          // Notify each server that uses this mod
          for (const serverId of modInfo.serverIds) {
            const srv = ctx.servers.find(s => s.id === serverId);
            if (!srv) continue;
            addLog(serverId, 'info', 'updates', `Workshop mod ${modInfo.name} update detected (${lastModVersions[workshopId]} -> ${remoteVersion})`);
            addNotification(serverId, 'mod.update', 'Mod Update Available', `Workshop mod ${modInfo.name} has a new version available.`, 'warning');
            fireWebhooks('mod.updated', { serverId, serverName: srv.name, modName: modInfo.name });
            ctx.io.emit('modUpdate', { serverId, mod: modInfo.name, workshopId });
            if (srv.autoUpdateEnabled && srv.shutdownForModUpdates !== false) {
              triggerAutoUpdate(serverId, 'mod', { modId: workshopId, modName: modInfo.name });
            }
          }
          pendingModUpdates[workshopId] = { name: modInfo.name, detectedAt: new Date().toISOString(), remoteVersion };
        }
        if (remoteVersion) lastModVersions[workshopId] = remoteVersion;
      }
    }

    // ─── Game build update polling (once, not per-server) ────
    // Only need to check each app ID once, not once per server
    const checkedAppIds = new Set();
    for (const srv of ctx.servers) {
      const state = ctx.serverStates[srv.id];
      if (!state) continue;
      const srvAppId = srv.gameTitle === 'DayZ, PC (Experimental)' ? '1042420' : '223350';
      if (checkedAppIds.has(srvAppId)) continue;
      checkedAppIds.add(srvAppId);

      const remoteBuild = await getDayZBuildVersion(srvAppId);
      if (remoteBuild && lastGameBuild && remoteBuild !== lastGameBuild) {
        // Notify all servers using this app ID
        for (const s of ctx.servers) {
          const appId = s.gameTitle === 'DayZ, PC (Experimental)' ? '1042420' : '223350';
          if (appId !== srvAppId) continue;
          addLog(s.id, 'info', 'updates', `DayZ game build updated (${lastGameBuild} -> ${remoteBuild})`);
          addNotification(s.id, 'game.update', 'Game Update Available', `DayZ game build ${remoteBuild} is available.`, 'warning');
          fireWebhooks('title.updated', { serverId: s.id, serverName: s.name, build: remoteBuild });
          ctx.io.emit('gameUpdate', { serverId: s.id, build: remoteBuild });
          if (s.autoUpdateEnabled && s.shutdownForTitleUpdates !== false) {
            triggerAutoUpdate(s.id, 'game', { build: remoteBuild });
          }
        }
      }
      if (remoteBuild) lastGameBuild = remoteBuild;
    }

    _persistTracking();
    } finally { _steamPollRunning = false; }
  }, STEAM_UPDATE_POLL_INTERVAL_MS);
}

/**
 * Manually check for mod updates on a specific server (bypass polling interval).
 * Same logic as the periodic poll but triggered on-demand for a single server.
 *
 * @param {string} serverId - Server ID to check
 * @returns {Promise<{ checked: number, updatesFound: number }>}
 */
async function checkModUpdatesNow(serverId) {
  _ensureTrackingLoaded();
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return { checked: 0, updatesFound: 0 };

  const state = ctx.serverStates[srv.id];
  if (!state?.modList?.length) return { checked: 0, updatesFound: 0 };

  let checked = 0;
  let updatesFound = 0;

  for (const mod of state.modList) {
    if (!mod.workshopId) continue;
    checked++;
    const remoteVersion = await getWorkshopModVersion(mod.workshopId);
    if (!remoteVersion) continue;

    if (lastModVersions[mod.workshopId] && remoteVersion > lastModVersions[mod.workshopId]) {
      // New update detected — only notify if not already pending
      if (!pendingModUpdates[mod.workshopId]) {
        addLog(srv.id, 'info', 'updates', `Workshop mod ${mod.name} update detected (${lastModVersions[mod.workshopId]} -> ${remoteVersion})`);
        addNotification(srv.id, 'mod.update', 'Mod Update Available', `Workshop mod ${mod.name} has a new version available.`, 'warning');
        ctx.io?.emit('modUpdate', { serverId: srv.id, mod: mod.name, workshopId: mod.workshopId });
        pendingModUpdates[mod.workshopId] = { name: mod.name, detectedAt: new Date().toISOString(), remoteVersion };
      }
      updatesFound++;
    }
    lastModVersions[mod.workshopId] = remoteVersion;
  }

  _persistTracking();
  return { checked, updatesFound };
}

// ─── Start all polling loops ─────────────────────────────
const intervals = [];

async function startAllPolling() {
  // Detect already-running processes and auto-start
  await runStartupDetection();

  // Run startup backups for servers with backupAtStartup enabled
  await runStartupBackups();

  // Initial mod detection + player fetch
  ctx.servers.forEach(s => autoDetectMods(s.id));
  for (const srv of ctx.servers) {
    const state = ctx.serverStates[srv.id];
    if (state?.status === 'running') {
      fetchPlayers(srv.id).then(players => {
        state.players = players;
        ctx.io.emit('players', { serverId: srv.id, players });
      }).catch(() => {});
    }
  }

  // Periodic intervals
  intervals.push(startMetricsPolling());
  intervals.push(setInterval(() => ctx.servers.forEach(s => autoDetectMods(s.id)), MOD_DETECT_INTERVAL_MS));
  intervals.push(startSteamUpdatePolling());
  intervals.push(startBackupEngine());

  // Delayed RCON connect after startup
  setTimeout(() => {
    for (const srv of ctx.servers) {
      const state = ctx.serverStates[srv.id];
      if (state?.rcon && srv.rconPassword) state.rcon.connect().catch(() => {});
    }
  }, RCON_STARTUP_DELAY_MS);
}

// ─── Graceful Shutdown ───────────────────────────────────
function gracefulShutdown(httpServer, signal) {
  // Hard deadline: force exit if cleanup hangs, before any async work
  setTimeout(() => {
    logger.warn('Forcing shutdown after 10s hard deadline');
    process.exit(1);
  }, 10000).unref();

  logger.info({ signal }, 'Shutting down gracefully');
  // Stop all intervals
  intervals.forEach(id => clearInterval(id));
  // Close HTTP server
  httpServer.close(() => logger.info('HTTP server closed'));
  // Disconnect all RCON clients and stop sidecars
  for (const srv of ctx.servers) {
    const state = ctx.serverStates[srv.id];
    if (state?.rcon) {
      try { state.rcon.disconnect(); } catch (err) { logger.debug({ err }, 'RCON disconnect during shutdown'); }
    }
    stopSidecar(srv.id);
    stopTailing(srv.id);
  }
  // Stop Discord bot
  try {
    const botManager = require('./bot-manager');
    botManager.stopBot();
  } catch { /* bot-manager not loaded */ }
  // Stop restart scheduler timers
  try { require('./restart-scheduler').shutdown(); } catch { /* not loaded */ }
  // Stop Citadel bridge file polling
  try { require('./citadel-bridge').shutdownAll(); } catch { /* not loaded */ }
  // Close any open cloud-bridge WebSockets so we exit clean instead of
  // letting the cloud's idle timer reap us 60s later.
  try { require('./cloud-bridge/supervisor').shutdownAll(); } catch { /* not loaded */ }
  // Stop DZSA mod-list endpoints
  try { ctx.servers.forEach((s) => require('./dzsa-publisher').stop(s.id)); } catch { /* not loaded */ }
  // Close WebSocket server
  if (ctx.io) ctx.io.close(() => logger.info('WebSocket server closed'));
  // Checkpoint + close the metrics DB so the WAL is flushed cleanly.
  try { require('./metrics-store').close(); } catch { /* not loaded */ }
  // Flush pending data writes
  flushAll();
  // Soft exit after normal timeout
  setTimeout(() => {
    logger.warn('Forcing shutdown after timeout');
    process.exit(0);
  }, SHUTDOWN_FORCE_TIMEOUT_MS);
}

module.exports = { startAllPolling, gracefulShutdown, getPendingModUpdates, clearPendingModUpdate, getLastGameBuild, checkModUpdatesNow };
