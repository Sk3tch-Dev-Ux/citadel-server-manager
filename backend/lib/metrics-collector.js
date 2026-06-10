/**
 * Server Metrics Collection & Health Monitoring.
 *
 * Extracted from polling.js — handles:
 *   - CPU/RAM/FPS/player metrics sampling (every 15s tick)
 *   - Rolling 90-minute history (360 data points via pushMetrics)
 *   - Socket.IO metrics + player emission
 *   - RPT event scraping + map data emission
 *   - Health threshold checking (FPS < min, RAM > max)
 *   - Auto-restart trigger on health violation
 *
 * Each running server gets its own polling tick via the shared interval
 * managed by the orchestrator (polling.js).
 */
const logger = require('./logger');
const ctx = require('./context');
const { getProcessMetrics } = require('./process-manager');
const { scrapeRPTForFPS } = require('./rpt-scraper');
const { fetchPlayers, fetchModMetrics, fetchModVehicles } = require('./player-data');
const { addLog } = require('./audit');
const { pushMetrics } = require('./audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('./notifications');
const { restartServer } = require('./server-lifecycle');
const { HEALTH_ALERT_COOLDOWN_MS } = require('./constants');

/**
 * Collect metrics for a single running server.
 *
 * Called once per 15-second tick for each server whose PID is confirmed alive.
 * The caller (polling.js orchestrator) is responsible for PID verification
 * and status transitions — this module only handles metrics + health.
 *
 * @param {object} srv - Server configuration object
 * @param {object} state - Server runtime state from ctx.serverStates
 * @param {number} pid - Verified alive PID for this server
 */
async function collectMetrics(srv, state, pid) {
  // ─── CPU / RAM sampling (single PowerShell call) ───────
  // getProcessMetrics now returns { cpu, ram, ramMB } in one PS call
  // (previously was two separate PS spawns per tick — halved overhead)
  const metrics = await getProcessMetrics(pid);

  // ─── Parallel I/O: fetch FPS, players, and vehicles concurrently ──
  // These are independent network calls to the sidecar / RCON — no reason
  // to await them sequentially. On a server with 60+ players this saves
  // hundreds of milliseconds per tick.
  const [modMetrics, players, vehicles] = await Promise.all([
    fetchModMetrics(srv.id).catch(() => null),
    fetchPlayers(srv.id).catch((err) => {
      logger.debug({ err, serverId: srv.id }, 'Player poll failed');
      return null;
    }),
    fetchModVehicles(srv.id).catch((err) => {
      logger.debug({ err, serverId: srv.id }, 'Vehicle poll failed');
      return [];
    }),
  ]);

  // ─── FPS: prefer sidecar /metrics, fallback to RPT/RCON ──
  let fps = 0;
  if (modMetrics && typeof modMetrics.fps === 'number') {
    fps = modMetrics.fps;
    state.modMetrics = modMetrics;
  } else {
    fps = scrapeRPTForFPS(srv);
    if (!fps && state.rcon) {
      try {
        if (!state.rcon.monitorEnabled && state.rcon.loggedIn) await state.rcon.enableMonitor();
        fps = state.rcon.getFPS() || 0;
      } catch { /* RCON not available */ }
    }
  }

  // modMetrics carries the mod's in-game telemetry (tick time, entity/AI/vehicle
  // counts) when the sidecar is reporting; pushMetrics persists + emits it.
  if (metrics) pushMetrics(srv.id, metrics.cpu, metrics.ram, state.players.length, fps, modMetrics);

  // ─── Player list ───────────────────────────────────────
  if (players !== null) {
    state.players = players;
  }
  // Always emit — positions change even when count doesn't (needed for live map)
  ctx.emitServer('players', { serverId: srv.id, players: state.players });

  // ─── Vehicle data ─────────────────────────────────────
  if (vehicles.length > 0) state.vehicles = vehicles;

  // ─── Health monitoring ─────────────────────────────────
  checkHealthThresholds(srv, state, metrics, fps);
}

/**
 * Check health thresholds and trigger alerts/restarts if needed.
 *
 * Enforces a 5-minute cooldown between alerts per server.
 *
 * @param {object} srv - Server configuration object
 * @param {object} state - Server runtime state
 * @param {object|null} metrics - Current metrics (cpu, ram, ramMB)
 * @param {number} fps - Current FPS reading
 */
function checkHealthThresholds(srv, state, metrics, fps) {
  if (!srv.healthMonitoring || !metrics) return;

  const minFPS = srv.healthMinFPS || 5;
  const maxRAM = srv.healthMaxRAM || 90;
  const action = srv.healthAction || 'log';

  let triggered = false;
  let reason = '';

  if (fps > 0 && fps < minFPS) {
    triggered = true;
    reason = `FPS (${fps.toFixed(1)}) below threshold (${minFPS})`;
  }
  if (metrics.ram > maxRAM) {
    triggered = true;
    reason += (reason ? ' & ' : '') + `RAM (${metrics.ram.toFixed(1)}%) above threshold (${maxRAM}%)`;
  }

  const now = Date.now();

  if (triggered && (!state.lastHealthAlert || now - state.lastHealthAlert > HEALTH_ALERT_COOLDOWN_MS)) {
    state.lastHealthAlert = now;
    addLog(srv.id, 'warn', 'health', 'Health alert: ' + reason);
    addNotification(srv.id, 'server.health', 'Health Alert', `${srv.name}: ${reason}`, 'warning');

    if (action === 'webhook') {
      fireWebhooks('server.health', { serverId: srv.id, serverName: srv.name, reason });
      sendDiscordWebhook(`\u26a0\ufe0f **${srv.name}** health alert: ${reason}`);
    } else if (action === 'restart') {
      addLog(srv.id, 'warn', 'health', 'Auto-restarting due to health threshold');
      // Use shared restart logic (includes lifecycle hooks)
      restartServer(srv.id, `Health threshold: ${reason}`).catch((err) => {
        logger.error({ err, serverId: srv.id }, 'Health auto-restart failed');
      });
    }
  }
}

module.exports = { collectMetrics };
