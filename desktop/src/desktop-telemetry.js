/**
 * Desktop-side telemetry — push events to the backend's telemetry buffer
 * from the Electron process.
 *
 * The desktop is a separate process from the backend. Writing directly to
 * the backend's local queue file lets the desktop fire events even when
 * the backend is stopped (which happens deliberately during the auto-update
 * flow). The backend's flush loop picks these up on its next tick.
 *
 * On-disk format: $INSTDIR/data/telemetry-desktop-events.json — a JSON
 * array of `{ event, payload, occurredAt }` objects matching the backend's
 * EVENT_SCHEMA shape. The backend's lib/telemetry drains this file at
 * flush time, validates events against EVENT_SCHEMA, and merges them into
 * its main queue.
 *
 * "Best-effort" everywhere — telemetry must not crash or slow the desktop.
 *
 * Update marker file: $INSTDIR/data/update-in-progress.json — written
 * before quitAndInstall, read by the backend on next boot to emit either
 * `update.completed` (new version started successfully) or `update.failed`
 * (timeout / version mismatch). Marker is deleted by the backend after
 * checking.
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./install-paths');

const DESKTOP_QUEUE_NAME = 'telemetry-desktop-events.json';
const UPDATE_MARKER_NAME = 'update-in-progress.json';
const QUEUE_CAP = 200;

function _queuePath() {
  const dir = getDataDir();
  return dir ? path.join(dir, DESKTOP_QUEUE_NAME) : null;
}

function _markerPath() {
  const dir = getDataDir();
  return dir ? path.join(dir, UPDATE_MARKER_NAME) : null;
}

function _ensureDir(p) {
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function _readJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

function _writeJSON(p, data) {
  try {
    if (!_ensureDir(p)) return false;
    // Atomic-ish: write to tmp, then rename.
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Append a telemetry event to the desktop queue file. The backend will
 * pick it up on its next flush. Returns true on success, false if the
 * data dir couldn't be located or the write failed.
 *
 * Event names must match backend/lib/telemetry/index.js#EVENT_SCHEMA.
 *
 * @param {string} event
 * @param {object} [payload]
 */
function reportEvent(event, payload = {}) {
  const p = _queuePath();
  if (!p) return false;

  const queue = _readJSON(p, []);
  if (!Array.isArray(queue)) return false;

  queue.push({
    event,
    payload: payload || {},
    occurredAt: new Date().toISOString(),
  });

  const trimmed = queue.length > QUEUE_CAP ? queue.slice(-QUEUE_CAP) : queue;
  return _writeJSON(p, trimmed);
}

/**
 * Write the update-in-progress marker so the post-install backend boot
 * can determine completion vs failure. Called from auto-updater's
 * installNow() right before quitAndInstall.
 *
 * @param {object} info
 * @param {string} info.fromVersion
 * @param {string} info.toVersion
 */
function writeUpdateMarker({ fromVersion, toVersion }) {
  const p = _markerPath();
  if (!p) return false;
  return _writeJSON(p, {
    fromVersion,
    toVersion,
    startedAt: new Date().toISOString(),
  });
}

module.exports = {
  reportEvent,
  writeUpdateMarker,
  // Exposed for testing.
  _internal: { _queuePath, _markerPath },
};
