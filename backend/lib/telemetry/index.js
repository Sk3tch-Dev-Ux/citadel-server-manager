/**
 * Citadel telemetry — diagnostic events posted to api.citadel-hub.com.
 *
 * Why this exists:
 *   On 2026-04-27 we shipped an auto-update that broke relaunch on Windows.
 *   We had no telemetry, so we only learned about it from one customer ping.
 *   This module exists so the next failure of that shape surfaces within
 *   minutes from the first install that hits it, not days.
 *
 * What it sends:
 *   A small allowlisted set of event names with at most a small JSON
 *   payload. No PII. The machine-id is hashed (sha256) before transmission;
 *   the user's email is never included even if a license is active.
 *
 *   Allowed events (see EVENT_SCHEMA below):
 *     update.prompt-shown        — user saw "restart to install" banner
 *     update.install-clicked     — user clicked the banner button
 *     update.completed           — new version started successfully
 *     update.failed              — new version did not start in time
 *     license.activate.success   — successful sign-in to Citadel Cloud
 *     license.activate.failure   — sign-in attempt failed (status code only)
 *     license.refresh.failure    — background refresh failed
 *
 * Privacy posture (D-telemetry decision, opt-out with disclosure):
 *   - On by default for new and existing installs.
 *   - One-line disclosure shown in the setup wizard (P2.3c) and in
 *     Settings.
 *   - Toggle to disable via POST /api/citadel-license/telemetry-toggle
 *     persists to data/telemetry.json.
 *   - No event ever contains email, password, IP, raw machine-id, license
 *     token, server names, mod lists, player names, or any DayZ data.
 *
 * Buffering:
 *   - Events are buffered locally in data/telemetry-queue.json and flushed
 *     on a 30s timer plus opportunistically on each report() call.
 *   - Buffer is capped at 200 events; oldest are dropped when full.
 *   - On flush failure (network, 5xx), events stay buffered and we retry
 *     on the next tick. Dropped on 4xx (the server has rejected them so
 *     retrying won't help).
 *   - Disabled state drops events without buffering.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const logger = require('../logger');
const { ROOT } = require('../paths');
const { getMachineId } = require('../license/machine-id');

// ─── Configuration ─────────────────────────────────────────────
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'telemetry.json');
const QUEUE_FILE = path.join(DATA_DIR, 'telemetry-queue.json');
// P3.11 — file the desktop process appends to (it can't directly call into
// this module since it's in a different process). The flush loop drains
// this file's contents into our own queue on every tick.
const DESKTOP_EVENTS_FILE = path.join(DATA_DIR, 'telemetry-desktop-events.json');
// P3.11 — written by the desktop before quitAndInstall. We check it on
// boot to emit update.completed (versions match) or update.failed (mismatch
// + 5min elapsed). Deleted after the check either way.
const UPDATE_MARKER_FILE = path.join(DATA_DIR, 'update-in-progress.json');
const UPDATE_FAILURE_TIMEOUT_MS = 5 * 60 * 1000;
const BUFFER_CAP = 200;
const FLUSH_INTERVAL_MS = 30 * 1000;
const HTTP_TIMEOUT_MS = 10 * 1000;
const DEFAULT_ENABLED = true; // D-telemetry: opt-out

function apiBase() {
  // Default to the api. host — the Fastify API serves /api/v1/telemetry/events
  // there. The apex citadel-hub.com is the marketing Next.js site with no /api
  // routes, so defaulting to it makes every POST 404 (and 4xx batches are
  // dropped permanently). Matches the license/cloud-bans/update-checker base.
  return (process.env.CITADEL_TELEMETRY_API
       || process.env.CITADEL_LICENSE_API
       || 'https://api.citadel-hub.com').replace(/\/$/, '');
}

// ─── Allowed events + payload shapes ───────────────────────────
// Keys not in this allowlist are stripped from payloads before sending.
// This is the privacy contract: even a future careless `report()` call
// can't accidentally exfiltrate fields we didn't pre-approve.
const EVENT_SCHEMA = {
  'update.prompt-shown':       ['fromVersion', 'toVersion'],
  'update.install-clicked':    ['fromVersion', 'toVersion'],
  'update.completed':          ['fromVersion', 'toVersion', 'durationMs'],
  'update.failed':             ['fromVersion', 'toVersion', 'reason', 'phase'],
  'license.activate.success':  [],
  'license.activate.failure':  ['statusCode', 'errorCode'],
  'license.refresh.failure':   ['statusCode', 'errorCode'],
  // Phase 3 — Cloud Bans
  'cloud-bans.submit':         [],
  'cloud-bans.unenroll':       [],
  'cloud-bans.sync.success':   [],
  'cloud-bans.sync.failure':   ['statusCode', 'errorCode'],
};

// ─── Persistent state (toggle + machine-id-hash) ───────────────
let _state = null;

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'telemetry: failed to write state');
    return false;
  }
}

/**
 * Initialise on first call. Persists the hashed machine-id so it stays
 * stable for de-duping events server-side even across reinstalls of
 * Citadel (it's derived from the Windows MachineGuid which is stable).
 */
function getState() {
  if (_state) return _state;
  const persisted = readState();
  if (persisted && typeof persisted.enabled === 'boolean') {
    _state = persisted;
    return _state;
  }
  // First boot — write the default opt-out toggle and a hashed id.
  const machineIdHash = sha256(getMachineId() || '');
  _state = {
    enabled: DEFAULT_ENABLED,
    machineIdHash,
    createdAt: new Date().toISOString(),
  };
  writeState(_state);
  return _state;
}

function isEnabled() {
  return Boolean(getState().enabled);
}

function setEnabled(enabled) {
  const next = { ...getState(), enabled: Boolean(enabled), updatedAt: new Date().toISOString() };
  _state = next;
  writeState(next);
  if (!enabled) {
    // User opted out — drop any buffered events that would otherwise
    // be sent on the next flush.
    writeQueue([]);
  }
  return next;
}

// ─── Event buffer ──────────────────────────────────────────────
function readQueue() {
  try {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(events) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(events, null, 2), 'utf-8');
  } catch (err) {
    logger.warn({ err: err.message }, 'telemetry: failed to write queue');
  }
}

// ─── report() — public entry point ─────────────────────────────

/**
 * Record a telemetry event. Returns immediately; flush happens async.
 *
 * @param {string} event - one of EVENT_SCHEMA's keys
 * @param {object} [payload] - additional fields (filtered against schema)
 */
function report(event, payload = {}) {
  if (!isEnabled()) return;
  if (!Object.prototype.hasOwnProperty.call(EVENT_SCHEMA, event)) {
    logger.warn({ event }, 'telemetry: rejected unknown event');
    return;
  }

  const allowedKeys = EVENT_SCHEMA[event];
  const filtered = {};
  for (const k of allowedKeys) {
    if (payload[k] !== undefined && payload[k] !== null) filtered[k] = payload[k];
  }

  const queued = readQueue();
  queued.push({
    event,
    payload: filtered,
    occurredAt: new Date().toISOString(),
  });

  // Cap the buffer — drop oldest first. 200 events at ~200 bytes each
  // is ~40 KB worst-case, which is fine in data/.
  const trimmed = queued.length > BUFFER_CAP ? queued.slice(-BUFFER_CAP) : queued;
  writeQueue(trimmed);

  // Try to flush right away. Don't block report().
  flush().catch(() => {});
}

// ─── flush() — POST buffered events to api.citadel-hub.com ─────────────

let _flushInProgress = false;
let _backgroundTimer = null;

/**
 * Drain any events the desktop process has dropped into the shared file.
 * Validates each against EVENT_SCHEMA (same allowlist applied to local
 * report() calls) and merges into the main queue. Removes the file on
 * success.
 *
 * Called at the top of every flush() so desktop events get buffered
 * before we send the batch to api.citadel-hub.com.
 */
function drainDesktopEvents() {
  let raw;
  try {
    if (!fs.existsSync(DESKTOP_EVENTS_FILE)) return 0;
    raw = fs.readFileSync(DESKTOP_EVENTS_FILE, 'utf-8');
  } catch {
    return 0;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt — drop it so we don't keep choking on the same bad file.
    try { fs.unlinkSync(DESKTOP_EVENTS_FILE); } catch {}
    return 0;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    try { fs.unlinkSync(DESKTOP_EVENTS_FILE); } catch {}
    return 0;
  }

  const queued = readQueue();
  let accepted = 0;
  for (const evt of parsed) {
    if (!evt || typeof evt.event !== 'string') continue;
    if (!Object.prototype.hasOwnProperty.call(EVENT_SCHEMA, evt.event)) continue;
    const allowedKeys = EVENT_SCHEMA[evt.event];
    const filtered = {};
    if (evt.payload && typeof evt.payload === 'object') {
      for (const k of allowedKeys) {
        if (evt.payload[k] !== undefined && evt.payload[k] !== null) {
          filtered[k] = evt.payload[k];
        }
      }
    }
    queued.push({
      event: evt.event,
      payload: filtered,
      occurredAt: typeof evt.occurredAt === 'string' ? evt.occurredAt : new Date().toISOString(),
    });
    accepted++;
  }

  const trimmed = queued.length > BUFFER_CAP ? queued.slice(-BUFFER_CAP) : queued;
  writeQueue(trimmed);
  try { fs.unlinkSync(DESKTOP_EVENTS_FILE); } catch {}
  if (accepted > 0) {
    logger.debug({ accepted }, 'telemetry: drained desktop events');
  }
  return accepted;
}

/**
 * P3.11 — check the update-in-progress marker on boot. If it exists, the
 * desktop initiated an update before we started. Compare the marker's
 * `toVersion` with our actual current version:
 *   - match → emit update.completed { durationMs }
 *   - mismatch + > UPDATE_FAILURE_TIMEOUT_MS elapsed → emit update.failed
 *   - mismatch + recent → leave marker; another (older) backend already
 *     restarted, this is the actual restart we expected.
 *
 * Always deletes the marker on successful classification.
 */
function checkUpdateMarker() {
  let raw;
  try {
    if (!fs.existsSync(UPDATE_MARKER_FILE)) return;
    raw = fs.readFileSync(UPDATE_MARKER_FILE, 'utf-8');
  } catch {
    return;
  }
  let marker;
  try {
    marker = JSON.parse(raw);
  } catch {
    try { fs.unlinkSync(UPDATE_MARKER_FILE); } catch {}
    return;
  }

  const fromVersion = marker.fromVersion || 'unknown';
  const toVersion = marker.toVersion || 'unknown';
  const startedAtMs = marker.startedAt ? Date.parse(marker.startedAt) : 0;
  const elapsedMs = startedAtMs ? Date.now() - startedAtMs : 0;

  let currentVersion = 'unknown';
  try {
    const pkg = require(path.join(ROOT, 'package.json'));
    currentVersion = pkg.version || 'unknown';
  } catch {}

  if (currentVersion === toVersion) {
    report('update.completed', {
      fromVersion,
      toVersion,
      durationMs: elapsedMs,
    });
    logger.info({ fromVersion, toVersion, durationMs: elapsedMs }, 'telemetry: update completed');
    try { fs.unlinkSync(UPDATE_MARKER_FILE); } catch {}
    return;
  }

  if (elapsedMs > UPDATE_FAILURE_TIMEOUT_MS) {
    report('update.failed', {
      fromVersion,
      toVersion,
      reason: `version-mismatch (running ${currentVersion}, expected ${toVersion})`,
      phase: 'post-install-boot',
    });
    logger.warn(
      { fromVersion, toVersion, currentVersion, elapsedMs },
      'telemetry: update failed (version mismatch after timeout)',
    );
    try { fs.unlinkSync(UPDATE_MARKER_FILE); } catch {}
    return;
  }

  // Recent enough that the right post-install backend hasn't booted yet.
  // Leave the marker; the correct version will pick it up.
  logger.debug(
    { fromVersion, toVersion, currentVersion, elapsedMs },
    'telemetry: update marker present but version not yet matched, leaving for next boot',
  );
}

async function flush() {
  if (_flushInProgress) return;
  if (!isEnabled()) return;

  // Drain any desktop-queued events first so they ship in this batch.
  drainDesktopEvents();

  const events = readQueue();
  if (events.length === 0) return;

  _flushInProgress = true;
  try {
    const state = getState();
    const body = {
      machineIdHash: state.machineIdHash,
      product: 'citadel',
      productVersion: readPackageVersion(),
      events,
    };

    // Attach the license token as Bearer if we have one. Lets the server
    // associate a paying customer's events with their account if they
    // chose to. For unactivated installs the server gets anonymous events
    // keyed by the hashed machine-id only.
    const headers = {};
    try {
      const license = require('../license');
      const lstate = license.getState ? license.getState() : null;
      if (lstate && lstate.token) headers.Authorization = `Bearer ${lstate.token}`;
    } catch {
      // license module not loaded yet during boot — fine, anonymous send.
    }

    const { status } = await httpRequest({
      method: 'POST',
      url: `${apiBase()}/api/v1/telemetry/events`,
      headers,
      body,
    });

    if (status >= 200 && status < 300) {
      // Success — drop these events from the queue. Read fresh in case
      // new events were appended while we were sending; only drop the
      // ones we actually flushed.
      const fresh = readQueue();
      const remaining = fresh.slice(events.length);
      writeQueue(remaining);
      logger.debug({ flushed: events.length, remaining: remaining.length }, 'telemetry: flush ok');
      const next = { ...state, lastFlushAt: new Date().toISOString() };
      _state = next;
      writeState(next);
    } else if (status >= 400 && status < 500) {
      // Server rejected the events — retrying won't help. Drop them.
      logger.warn({ status, dropped: events.length }, 'telemetry: 4xx, dropping events');
      const fresh = readQueue();
      writeQueue(fresh.slice(events.length));
    } else {
      // 5xx or transport — keep in queue, retry next tick.
      logger.debug({ status, kept: events.length }, 'telemetry: transient flush failure, retrying later');
    }
  } catch (err) {
    // Network error / DNS failure / timeout — keep in queue.
    logger.debug({ err: err.message }, 'telemetry: flush exception');
  } finally {
    _flushInProgress = false;
  }
}

/** Start the periodic flush loop. Idempotent — safe to call once at boot. */
function startBackgroundFlush() {
  if (_backgroundTimer) return;
  // Check the update marker on boot so we emit update.completed/failed
  // before the first flush.
  try {
    checkUpdateMarker();
  } catch (err) {
    logger.warn({ err: err.message }, 'telemetry: checkUpdateMarker threw');
  }
  _backgroundTimer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  if (typeof _backgroundTimer.unref === 'function') _backgroundTimer.unref();
}

function stopBackgroundFlush() {
  if (_backgroundTimer) {
    clearInterval(_backgroundTimer);
    _backgroundTimer = null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────
function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function readPackageVersion() {
  try {
    const pkg = require(path.join(ROOT, 'package.json'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Minimal HTTPS POST. We avoid pulling in axios/got for one endpoint. */
function httpRequest({ method, url, headers, body, timeoutMs = HTTP_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (err) { return reject(new Error(`Invalid URL: ${url}`)); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        method,
        host: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': `Citadel/${readPackageVersion()}`,
          Accept: 'application/json',
          ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          ...(headers || {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode }));
      }
    );
    req.on('timeout', () => { req.destroy(new Error('Telemetry request timed out')); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Public API ────────────────────────────────────────────────
module.exports = {
  report,
  flush,
  startBackgroundFlush,
  stopBackgroundFlush,
  isEnabled,
  setEnabled,
  getState: () => ({ ...getState() }),
  // Exposed for boot-time hooks + tests.
  checkUpdateMarker,
  drainDesktopEvents,
  _internal: { EVENT_SCHEMA, BUFFER_CAP, readQueue, writeQueue },
};
