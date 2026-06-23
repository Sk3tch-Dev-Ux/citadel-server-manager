/**
 * Citadel Sidecar — Game Data Store
 *
 * Reads supplementary game data written by the DayZ mod:
 *   - metrics.json    (server performance: FPS, tick times, entity counts)
 *   - vehicles.json   (vehicle positions and health)
 *   - events_world.json (dynamic world events like heli crashes)
 *
 * Each data set is refreshed on an interval and served from an in-memory cache.
 */
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');

// In-memory caches
let metrics = null;
let vehicles = [];
let worldEvents = [];

/**
 * Read server performance metrics from the mod-written file.
 * The mod multiplies FPS by 100 for precision — divide it back here.
 */
function refreshMetrics() {
  try {
    if (!fs.existsSync(config.metricsFile)) return null;
    const raw = fs.readFileSync(config.metricsFile, 'utf-8');
    const data = JSON.parse(raw);

    // The mod already measures real server FPS (it counts doSim ticks/sec) and
    // ships it as fps = real_fps * 100 for integer precision — divide it back.
    // Prefer that authoritative value; only fall back to tick_avg when the mod
    // hasn't supplied fps yet (e.g. before mission load). tick_avg is the delta
    // between *uncapped* OnUpdate() calls (sub-millisecond on an idle dedicated
    // server), so 1000/tick_avg over-reports into the thousands — using it as
    // the primary source pinned the dashboard at the 300 clamp below.
    if (data.fps != null && data.fps > 0) {
      data.fps = +(data.fps / 100).toFixed(2);
    } else if (data.tick_avg > 0) {
      data.fps = +(1000 / data.tick_avg).toFixed(2);
    }
    // Idle dedicated servers spin the sim loop uncapped (sub-ms tick_avg →
    // four-digit "FPS"), and the cloud stores fps×100 in a smallint (max
    // ~327). Clamp to 300: pinned-at-cap means healthy/idle; the value
    // becomes meaningful exactly when load pushes it below the cap.
    if (data.fps != null && data.fps > 300) data.fps = 300;
    // fps_min/fps_max are raw 1s FPS samples over the collection window
    // (not ×100) — clamp them for the same idle-server reason as fps.
    if (data.fps_min != null && data.fps_min > 300) data.fps_min = 300;
    if (data.fps_max != null && data.fps_max > 300) data.fps_max = 300;

    metrics = data;
    return metrics;
  } catch (err) {
    logger.debug({ err: err.message }, 'Failed to read metrics data');
    return metrics;
  }
}

/**
 * Read vehicle positions from the mod-written file.
 */
function refreshVehicles() {
  try {
    if (!fs.existsSync(config.vehiclesFile)) return [];
    const raw = fs.readFileSync(config.vehiclesFile, 'utf-8');
    vehicles = JSON.parse(raw);
    return vehicles;
  } catch (err) {
    logger.debug({ err: err.message }, 'Failed to read vehicles data');
    return vehicles;
  }
}

/**
 * Read dynamic world events from the mod-written file.
 */
function refreshWorldEvents() {
  try {
    if (!fs.existsSync(config.worldEventsFile)) return [];
    const raw = fs.readFileSync(config.worldEventsFile, 'utf-8');
    worldEvents = JSON.parse(raw);
    return worldEvents;
  } catch (err) {
    logger.debug({ err: err.message }, 'Failed to read world events data');
    return worldEvents;
  }
}

/**
 * Get cached server metrics.
 */
function getMetrics() {
  return metrics;
}

/**
 * Get cached vehicle list.
 */
function getVehicles() {
  return vehicles;
}

/**
 * Get cached world events.
 */
function getWorldEvents() {
  return worldEvents;
}

module.exports = {
  refreshMetrics,
  refreshVehicles,
  refreshWorldEvents,
  getMetrics,
  getVehicles,
  getWorldEvents,
};
