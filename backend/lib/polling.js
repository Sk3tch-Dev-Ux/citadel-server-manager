/**
 * All polling loops (metrics, mod detection, leaderboard, steam updates, RCON connect)
 * and graceful shutdown handler.
 */
const logger = require('./logger');
const ctx = require('./context');
const { flushAll } = require('./data-store');
const { detectRunningProcess, detectProcessByPid, getProcessMetrics, getProcessCPU, spawnDayZServer, applyProcessSettings } = require('./process-manager');
const { scrapeRPTForFPS } = require('./rpt-scraper');
const { updateLeaderboard } = require('./cftools-leaderboard');
const { fetchPlayers } = require('./cftools-players');
const { autoDetectMods } = require('./mod-manager');
const { addLog } = require('./audit');
const { pushMetrics } = require('./audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('./notifications');
const { startSchedulerEngine } = require('./scheduler-engine');
const { startBackupEngine, runStartupBackups } = require('./backup-engine');
const { scrapeRPTForEvents, getMapData } = require('./map-data');
const { startSidecar, stopSidecar } = require('./sidecar-manager');
const { executeHooks } = require('./lifecycle-hooks');
const { restartServer } = require('./server-lifecycle');
const { triggerAutoUpdate } = require('./auto-updater');

// ─── Steam Update Polling ────────────────────────────────
let lastModVersions = {};
let lastGameBuild = null;

async function getWorkshopModVersion(workshopId) {
  try {
    const fetch = (await import('node-fetch')).default;
    const resp = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `itemcount=1&publishedfileids[0]=${workshopId}`,
    });
    const data = await resp.json();
    const file = data?.response?.publishedfiledetails?.[0];
    return file ? file.time_updated : null;
  } catch { return null; }
}

async function getDayZBuildVersion() {
  try {
    const fetch = (await import('node-fetch')).default;
    const appId = ctx.CONFIG.steam.appId;
    const resp = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
    const data = await resp.json();
    return data?.[appId]?.data?.build_number || null;
  } catch { return null; }
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
        }
        const metrics = await getProcessMetrics(pid);
        // Get CPU from delta-based sampling (wmic, no PowerShell windows)
        const cpu = await getProcessCPU(pid);
        if (metrics) metrics.cpu = cpu;
        let fps = scrapeRPTForFPS(srv);
        if (!fps && state.rcon) {
          try {
            if (!state.rcon.monitorEnabled && state.rcon.loggedIn) await state.rcon.enableMonitor();
            fps = state.rcon.getFPS() || 0;
          } catch { /* RCON not available */ }
        }
        if (metrics) pushMetrics(srv.id, metrics.cpu, metrics.ram, state.players.length, fps);
        // Player list polling (InHouse sidecar or RCON)
        try {
          const players = await fetchPlayers(srv.id);
          state.players = players;
          // Always emit — positions change even when player count doesn't (needed for live map)
          ctx.io.emit('players', { serverId: srv.id, players: state.players });
        } catch (err) { logger.debug({ err, serverId: srv.id }, 'Player poll failed'); }
        // Scrape RPT for dynamic events (helicrashes, airdrops, etc.)
        try { scrapeRPTForEvents(srv); } catch { /* ignore */ }
        // Emit combined map data for live map page
        try {
          const mapData = getMapData(srv.id);
          if (mapData.players.length > 0 || mapData.vehicles.length > 0 || mapData.events.length > 0) {
            ctx.io.emit('mapData', { serverId: srv.id, ...mapData });
          }
        } catch { /* ignore */ }
        // Health monitoring checks (5-minute cooldown between alerts)
        if (srv.healthMonitoring && metrics) {
          const minFPS = srv.healthMinFPS || 5;
          const maxRAM = srv.healthMaxRAM || 90;
          const action = srv.healthAction || 'log';
          let triggered = false;
          let reason = '';
          if (fps > 0 && fps < minFPS) { triggered = true; reason = `FPS (${fps.toFixed(1)}) below threshold (${minFPS})`; }
          if (metrics.ram > maxRAM) { triggered = true; reason += (reason ? ' & ' : '') + `RAM (${metrics.ram.toFixed(1)}%) above threshold (${maxRAM}%)`; }
          const now = Date.now();
          const cooldown = 5 * 60 * 1000;
          if (triggered && (!state.lastHealthAlert || now - state.lastHealthAlert > cooldown)) {
            state.lastHealthAlert = now;
            addLog(srv.id, 'warn', 'health', 'Health alert: ' + reason);
            addNotification(srv.id, 'server.health', 'Health Alert', `${srv.name}: ${reason}`, 'warning');
            if (action === 'webhook') {
              fireWebhooks('server.health', { serverId: srv.id, serverName: srv.name, reason });
              sendDiscordWebhook(`⚠️ **${srv.name}** health alert: ${reason}`);
            } else if (action === 'restart') {
              addLog(srv.id, 'warn', 'health', 'Auto-restarting due to health threshold');
              // Use shared restart logic (includes lifecycle hooks)
              restartServer(srv.id, `Health threshold: ${reason}`).catch((err) => {
                logger.error({ err, serverId: srv.id }, 'Health auto-restart failed');
              });
            }
          }
        }
      } else if (state.status === 'running') {
        addLog(srv.id, 'error', 'server', 'Process no longer running');
        state.status = 'crashed'; state.players = []; state.pid = null; state.process = null;
        ctx.io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
        ctx.io.emit('players', { serverId: srv.id, players: [] });
        addNotification(srv.id, 'server.crashed', 'Server Crashed', `${srv.name} is no longer running`, 'error');
        fireWebhooks('server.crashed', { serverId: srv.id, serverName: srv.name });
        sendDiscordWebhook(`💥 **${srv.name}** crashed`);
        // Execute crashed hooks (blocking, sequential)
        executeHooks(srv.id, 'crashed').catch(() => {});
      }
    }
    } finally { _metricsPollingRunning = false; }
  }, 15000);
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
function startSteamUpdatePolling() {
  return setInterval(async () => {
    for (const srv of ctx.servers) {
      const state = ctx.serverStates[srv.id];
      if (!state) continue;
      // Mod update polling
      if (!srv.ignoreModUpdates && Array.isArray(state.modList)) {
        for (const mod of state.modList) {
          if (!mod.workshopId) continue;
          const remoteVersion = await getWorkshopModVersion(mod.workshopId);
          if (remoteVersion && lastModVersions[mod.workshopId] && remoteVersion > lastModVersions[mod.workshopId]) {
            addLog(srv.id, 'info', 'updates', `Workshop mod ${mod.name} update detected (${lastModVersions[mod.workshopId]} -> ${remoteVersion})`);
            addNotification(srv.id, 'mod.update', 'Mod Update Available', `Workshop mod ${mod.name} has a new version available.`, 'warning');
            fireWebhooks('mod.updated', { serverId: srv.id, serverName: srv.name, modName: mod.name });
            ctx.io.emit('modUpdate', { serverId: srv.id, mod: mod.name });
            // Auto-updater integration: trigger update pipeline when enabled
            if (srv.autoUpdateEnabled) {
              triggerAutoUpdate(srv.id, 'mod', { modId: mod.workshopId, modName: mod.name });
            }
          }
          lastModVersions[mod.workshopId] = remoteVersion;
        }
      }
      // Game build update polling
      const remoteBuild = await getDayZBuildVersion();
      if (remoteBuild && lastGameBuild && remoteBuild !== lastGameBuild) {
        addLog(srv.id, 'info', 'updates', `DayZ game build updated (${lastGameBuild} -> ${remoteBuild})`);
        addNotification(srv.id, 'game.update', 'Game Update Available', `DayZ game build ${remoteBuild} is available.`, 'warning');
        fireWebhooks('title.updated', { serverId: srv.id, serverName: srv.name, build: remoteBuild });
        ctx.io.emit('gameUpdate', { serverId: srv.id, build: remoteBuild });
        // Auto-updater integration: trigger update pipeline when enabled
        if (srv.autoUpdateEnabled) {
          triggerAutoUpdate(srv.id, 'game', { build: remoteBuild });
        }
      }
      lastGameBuild = remoteBuild;
    }
  }, 15 * 60 * 1000);
}

// ─── Start all polling loops ─────────────────────────────
const intervals = [];

async function startAllPolling() {
  // Detect already-running processes and auto-start
  await runStartupDetection();

  // Run startup backups for servers with backupAtStartup enabled
  await runStartupBackups();

  // Initial mod detection + leaderboard build + player fetch
  ctx.servers.forEach(s => autoDetectMods(s.id));
  ctx.servers.forEach(s => updateLeaderboard(s.id));
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
  intervals.push(setInterval(() => ctx.servers.forEach(s => autoDetectMods(s.id)), 5 * 60 * 1000));
  intervals.push(setInterval(() => ctx.servers.forEach(s => updateLeaderboard(s.id)), 5 * 60 * 1000));
  intervals.push(startSteamUpdatePolling());
  intervals.push(startSchedulerEngine());
  intervals.push(startBackupEngine());

  // Delayed RCON connect (5s after startup)
  setTimeout(() => {
    for (const srv of ctx.servers) {
      const state = ctx.serverStates[srv.id];
      if (state?.rcon && srv.rconPassword) state.rcon.connect().catch(() => {});
    }
  }, 5000);
}

// ─── Graceful Shutdown ───────────────────────────────────
function gracefulShutdown(httpServer, signal) {
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
  }
  // Close WebSocket server
  if (ctx.io) ctx.io.close(() => logger.info('WebSocket server closed'));
  // Flush pending data writes
  flushAll();
  // Force exit after 5s
  setTimeout(() => {
    logger.warn('Forcing shutdown after timeout');
    process.exit(0);
  }, 5000);
}

module.exports = { startAllPolling, gracefulShutdown };
