/**
 * Logging, audit trail, and metrics collection.
 */
const { v4: uuid } = require('uuid');
const ctx = require('./context');
const { saveJSON } = require('./data-store');
const { sanitizeString } = require('./helpers');
const metricsStore = require('./metrics-store');
const {
  MAX_LOG_ENTRIES,
  MAX_AUDIT_ENTRIES,
  MAX_AUDIT_PERSIST,
  METRICS_HISTORY_SIZE,
} = require('./constants');

/**
 * Add a log entry to a server's log buffer and emit via Socket.IO.
 */
function addLog(serverId, level, source, message) {
  const entry = { timestamp: new Date().toISOString(), level, source: sanitizeString(source), message: sanitizeString(message) };
  if (serverId && ctx.serverStates[serverId]) {
    ctx.serverStates[serverId].logs.unshift(entry);
    if (ctx.serverStates[serverId].logs.length > MAX_LOG_ENTRIES) ctx.serverStates[serverId].logs.pop();
  }
  if (ctx.io) ctx.emitServer('log', { serverId, ...entry });
  return entry;
}

/**
 * Add an audit trail entry for user actions.
 */
function addAudit(userId, username, action, details) {
  const entry = { id: uuid(), timestamp: new Date().toISOString(), userId, username, action, details };
  ctx.auditLog.unshift(entry);
  if (ctx.auditLog.length > MAX_AUDIT_ENTRIES) ctx.auditLog = ctx.auditLog.slice(0, MAX_AUDIT_ENTRIES);
  saveJSON(ctx.CONFIG.dataDir, 'audit.json', ctx.auditLog.slice(0, MAX_AUDIT_PERSIST));
  return entry;
}

/**
 * Push server metrics to history and emit via Socket.IO.
 * Keeps a rolling window of 360 entries (~90 minutes at 15s intervals).
 */
function pushMetrics(serverId, cpu, ram, playerCount, fps, inGame = null) {
  const state = ctx.serverStates[serverId];
  if (!state) return;
  const now = new Date().toISOString();
  const m = state.metricsHistory;
  m.cpu.push(cpu); m.ram.push(ram); m.players.push(playerCount); m.fps.push(fps); m.timestamps.push(now);
  Object.keys(m).forEach(k => { if (m[k].length > METRICS_HISTORY_SIZE) m[k] = m[k].slice(-METRICS_HISTORY_SIZE); });
  // Pull the in-game telemetry the mod already produces (tick time, entity/AI
  // counts). Safe when the sidecar isn't reporting — fields default to 0.
  const g = inGame || {};
  const ingameSample = {
    tick_avg: g.tick_avg, tick_low: g.tick_low, tick_high: g.tick_high,
    ai_count: g.ai_count, active_ai: g.active_ai, animal_count: g.animal_count,
    vehicle_count: g.vehicle_count, entity_count: g.entity_count,
  };
  // Persist to the durable store (no-op if persistence is disabled).
  metricsStore.record(serverId, { cpu, ram, players: playerCount, fps, ...ingameSample });
  if (ctx.io) ctx.emitServer('metrics', { serverId, cpu, ram, players: playerCount, fps, timestamp: now, ...ingameSample });
}

module.exports = { addLog, addAudit, pushMetrics };
