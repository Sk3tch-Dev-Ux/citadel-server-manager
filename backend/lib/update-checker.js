/**
 * Citadel Self-Update Checker
 *
 * Polls the Citadel Cloud API (api.citadels.cc) for the latest release version,
 * compares against the local package.json version, and notifies connected
 * clients via Socket.IO when an update is available.
 *
 * Architecture:
 *   - Uses the existing /downloads/latest endpoint on citadel-cloud
 *   - Polls on a configurable interval (default: 1 hour)
 *   - Caches the result to avoid hammering the API
 *   - Emits 'citadelUpdate' via Socket.IO when state changes
 *   - Exposes getState() for the REST API route
 *
 * No auto-download or auto-install — this is a notification-only system.
 * The user downloads the new installer from the dashboard or citadels.cc.
 */
const logger = require('./logger');
const ctx = require('./context');
const path = require('path');
const fs = require('fs');

// ── Configuration ────────────────────────────────────────────
const CHECK_INTERVAL_MS = Number(process.env.CITADEL_UPDATE_CHECK_INTERVAL_MS || 60 * 60 * 1000); // 1 hour
const API_TIMEOUT_MS = 15_000;

// Citadel Cloud API base (same as license client)
const DEFAULT_API_BASE = 'https://api.citadels.cc';
function apiBase() {
  return (process.env.CITADEL_LICENSE_API || DEFAULT_API_BASE).replace(/\/$/, '');
}

// ── Local version ────────────────────────────────────────────
let _localVersion = null;

function getLocalVersion() {
  if (_localVersion) return _localVersion;
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    _localVersion = pkg.version;
    return _localVersion;
  } catch (err) {
    logger.warn({ err }, 'Failed to read local package.json version');
    return '0.0.0';
  }
}

// ── State ────────────────────────────────────────────────────
let _state = {
  status: 'unknown',           // unknown | current | update_available | error
  currentVersion: null,        // Local installed version
  latestVersion: null,         // Latest version from cloud
  releaseNotes: null,          // Changelog / release body
  downloadUrl: null,           // Where to download the update
  publishedAt: null,           // When the latest release was published
  size: null,                  // Installer size in bytes
  prerelease: false,           // Whether the latest is a prerelease
  lastCheckedAt: null,         // ISO timestamp of last successful check
  lastError: null,             // Last error message (if status === 'error')
  dismissed: false,            // Whether the user dismissed the banner this session
};

let _checkTimer = null;

function getState() {
  return { ..._state, currentVersion: getLocalVersion() };
}

/**
 * Compare two semver version strings.
 * Returns: 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareSemver(a, b) {
  const partsA = (a || '0.0.0').replace(/^v/, '').split('.').map(Number);
  const partsB = (b || '0.0.0').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = partsA[i] || 0;
    const vb = partsB[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/**
 * Check for updates by calling the Citadel Cloud API.
 */
async function checkForUpdate() {
  const currentVersion = getLocalVersion();
  _state.currentVersion = currentVersion;

  try {
    const url = `${apiBase()}/downloads/latest`;
    logger.debug({ url }, 'Checking for Citadel update');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': `Citadel/${currentVersion}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.version) {
      throw new Error('No version field in API response');
    }

    const latestVersion = data.version.replace(/^v/, '');
    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
    const previousStatus = _state.status;

    _state.status = hasUpdate ? 'update_available' : 'current';
    _state.latestVersion = latestVersion;
    _state.releaseNotes = data.releaseNotes || null;
    _state.downloadUrl = data.downloadUrl || `${apiBase()}/downloads/installer`;
    _state.publishedAt = data.publishedAt || null;
    _state.size = data.size || null;
    _state.prerelease = data.prerelease || false;
    _state.lastCheckedAt = new Date().toISOString();
    _state.lastError = null;

    // Reset dismissed flag when a NEW version appears
    if (hasUpdate && _state.latestVersion !== latestVersion) {
      _state.dismissed = false;
    }

    // Emit via Socket.IO when status changes or update is available
    if (ctx.io && (previousStatus !== _state.status || hasUpdate)) {
      ctx.io.emit('citadelUpdate', getState());
    }

    if (hasUpdate) {
      logger.info(
        { currentVersion, latestVersion, publishedAt: data.publishedAt },
        'Citadel update available'
      );
    } else {
      logger.debug({ currentVersion, latestVersion }, 'Citadel is up to date');
    }

    return getState();
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Update check timed out' : err.message;
    logger.debug({ err: msg }, 'Update check failed (non-fatal)');
    _state.status = _state.latestVersion ? _state.status : 'error'; // Keep previous status if we had data
    _state.lastError = msg;
    _state.lastCheckedAt = new Date().toISOString();
    return getState();
  }
}

/**
 * Mark the current update notification as dismissed for this session.
 * The banner won't show again until a newer version appears.
 */
function dismiss() {
  _state.dismissed = true;
  if (ctx.io) {
    ctx.io.emit('citadelUpdate', getState());
  }
}

/**
 * Start the background update checker. Call once at boot.
 */
function startUpdateChecker() {
  // Initial check after a short delay (don't slow down startup)
  setTimeout(() => {
    checkForUpdate().catch(() => {});
  }, 30_000); // 30 seconds after boot

  // Periodic checks
  _checkTimer = setInterval(() => {
    checkForUpdate().catch(() => {});
  }, CHECK_INTERVAL_MS);

  logger.info(
    { intervalMinutes: Math.round(CHECK_INTERVAL_MS / 60000) },
    'Citadel update checker started'
  );
}

/**
 * Stop the background checker (for graceful shutdown).
 */
function stopUpdateChecker() {
  if (_checkTimer) {
    clearInterval(_checkTimer);
    _checkTimer = null;
  }
}

module.exports = {
  getState,
  checkForUpdate,
  dismiss,
  startUpdateChecker,
  stopUpdateChecker,
  getLocalVersion,
};
