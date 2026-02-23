/**
 * All polling loops (metrics, mod detection, leaderboard, steam updates, RCON connect)
 * and graceful shutdown handler.
 */
const logger = require('./logger');
const ctx = require('./context');
const { flushAll } = require('./data-store');
const { detectRunningProcess, getProcessMetrics, killProcess, spawnDayZServer, applyProcessSettings } = require('./process-manager');
const { scrapeRPTForFPS } = require('./rpt-scraper');
const { updateLeaderboard } = require('./rpt-scraper');
const { autoDetectMods } = require('./mod-manager');
const { addLog } = require('./audit');
const { pushMetrics } = require('./audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('./notifications');

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
function startMetricsPolling() {
  return setInterval(async () => {
    for (const srv of ctx.servers) {
      const state = ctx.serverStates[srv.id];
      if (!state || (state.status !== 'running' && state.status !== 'starting')) continue;
      const pid = await detectRunningProcess(srv.executable);
      if (pid) {
        state.pid = pid;
        if (state.status !== 'running') {
          state.status = 'running'; state.startedAt = state.startedAt || new Date().toISOString();
          ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
        }
        const metrics = await getProcessMetrics(pid, srv.executable);
        let fps = scrapeRPTForFPS(srv);
        if (!fps && state.rcon) {
          try {
            if (!state.rcon.monitorEnabled && state.rcon.loggedIn) await state.rcon.enableMonitor();
            fps = state.rcon.getFPS() || 0;
          } catch { /* RCON not available */ }
        }
        if (metrics) pushMetrics(srv.id, metrics.cpu, metrics.ram, state.players.length, fps);
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
              try { await killProcess(state.pid, srv.executable); } catch (err) { logger.debug({ err }, 'Kill during health restart'); }
              state.pid = null; state.process = null; state.players = [];
              state.status = 'starting'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
              await new Promise(r => setTimeout(r, 3000));
              state.process = spawnDayZServer(srv); state.pid = state.process.pid;
              setTimeout(async () => {
                const newPid = await detectRunningProcess(srv.executable);
                if (newPid) { state.pid = newPid; state.status = 'running'; state.startedAt = new Date().toISOString(); ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' }); }
              }, srv.startGracePeriod ? srv.startGracePeriod * 1000 : 8000);
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
      }
    }
  }, 15000);
}

// ─── Startup detection + auto-start ──────────────────────
async function runStartupDetection() {
  for (const srv of ctx.servers) {
    const state = ctx.serverStates[srv.id];
    if (state) {
      if (!state.logs) state.logs = [];
      addLog(srv.id, 'info', 'server', `Server state initialized for ${srv.name}`);
    }
    const pid = await detectRunningProcess(srv.executable);
    if (pid) {
      state.pid = pid; state.status = 'running'; state.startedAt = new Date().toISOString();
      ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
      addLog(srv.id, 'info', 'server', `Detected running process for ${srv.name} (PID: ${pid})`);
      applyProcessSettings(pid, srv);
    }
  }
  // Auto-start servers that have autoStart enabled and aren't already running
  for (const srv of ctx.servers) {
    const state = ctx.serverStates[srv.id];
    if (srv.autoStart && state?.status !== 'running') {
      logger.info({ server: srv.name }, 'Auto-starting server');
      try {
        state.status = 'starting'; ctx.io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
        state.process = spawnDayZServer(srv); state.pid = state.process.pid;
        addLog(srv.id, 'info', 'server', 'Auto-start initiated');
        setTimeout(async () => {
          const detectedPid = await detectRunningProcess(srv.executable);
          if (detectedPid) {
            state.pid = detectedPid; state.status = 'running'; state.startedAt = new Date().toISOString();
            ctx.io.emit('serverStatus', { serverId: srv.id, status: 'running' });
            addLog(srv.id, 'info', 'server', 'Auto-start: server is now running');
          }
        }, srv.startGracePeriod ? srv.startGracePeriod * 1000 : 8000);
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
            addNotification(srv.id, 'mod.update', 'Mod Update Detected', `Workshop mod ${mod.name} updated. Restarting in ${srv.restartCountdown || 60} seconds.`, 'warning');
            ctx.io.emit('modUpdate', { serverId: srv.id, mod: mod.name, countdown: srv.restartCountdown || 60 });
            setTimeout(() => {
              ctx.io.emit('serverStatus', { serverId: srv.id, status: 'restarting' });
            }, (srv.restartCountdown || 60) * 1000);
          }
          lastModVersions[mod.workshopId] = remoteVersion;
        }
      }
      // Game build update polling
      const remoteBuild = await getDayZBuildVersion();
      if (remoteBuild && lastGameBuild && remoteBuild !== lastGameBuild) {
        addNotification(srv.id, 'game.update', 'Game Update Detected', `DayZ game build updated. Restarting in ${srv.restartCountdown || 60} seconds.`, 'warning');
        ctx.io.emit('gameUpdate', { serverId: srv.id, build: remoteBuild, countdown: srv.restartCountdown || 60 });
        setTimeout(() => {
          ctx.io.emit('serverStatus', { serverId: srv.id, status: 'restarting' });
        }, (srv.restartCountdown || 60) * 1000);
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

  // Initial mod detection + leaderboard build
  ctx.servers.forEach(s => autoDetectMods(s.id));
  ctx.servers.forEach(s => updateLeaderboard(s.id));

  // Periodic intervals
  intervals.push(startMetricsPolling());
  intervals.push(setInterval(() => ctx.servers.forEach(s => autoDetectMods(s.id)), 5 * 60 * 1000));
  intervals.push(setInterval(() => ctx.servers.forEach(s => updateLeaderboard(s.id)), 5 * 60 * 1000));
  intervals.push(startSteamUpdatePolling());

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
  // Disconnect all RCON clients
  for (const srv of ctx.servers) {
    const state = ctx.serverStates[srv.id];
    if (state?.rcon) {
      try { state.rcon.disconnect(); } catch (err) { logger.debug({ err }, 'RCON disconnect during shutdown'); }
    }
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
