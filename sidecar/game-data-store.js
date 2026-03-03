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

    // Mod sends FPS * 100 for integer precision; convert to real FPS
    if (data.fps != null) {
      data.fps = +(data.fps / 100).toFixed(2);
    }

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
