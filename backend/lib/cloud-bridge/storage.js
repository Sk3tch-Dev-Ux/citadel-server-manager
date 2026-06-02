/**
 * Per-server Citadel Cloud link credentials, persisted to disk so we survive
 * restarts without re-pairing.
 *
 * Schema (data/plugin-servers.json):
 *   {
 *     links: {
 *       [localServerId]: {
 *         cloudServerId: "uuid from /api/v1/plugin-servers",
 *         apiKey: "ENC:<base64>",            // encrypted via credential-encryption
 *         name: "Operator label",
 *         linkedAt: "ISO-8601",
 *         lastStatus: "connected" | "disconnected" | "auth-failed" | "unknown",
 *         lastStatusAt: "ISO-8601",
 *         lastError: "string | null"
 *       }
 *     }
 *   }
 *
 * Keyed by localServerId (the ctx.servers[] id) — not by cloudServerId —
 * because the local DayZ install is the source of truth here and that's how
 * the supervisor looks links up at server-lifecycle moments.
 *
 * The raw API key NEVER lives in memory longer than the WS handshake. We
 * decrypt-on-read inside the supervisor right before opening the socket,
 * pass it to the WS auth message, and drop the reference.
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../paths');
const { encrypt, decrypt } = require('../credential-encryption');
const logger = require('../logger');

const FILE = path.join(ROOT, 'data', 'plugin-servers.json');

function _readRaw() {
  try {
    if (!fs.existsSync(FILE)) return { links: {} };
    const raw = fs.readFileSync(FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.links ? parsed : { links: {} };
  } catch (err) {
    logger.warn({ err: err.message, file: FILE }, 'cloud-bridge.storage: read failed, returning empty');
    return { links: {} };
  }
}

function _writeRaw(state) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch (err) {
    logger.error({ err: err.message, file: FILE }, 'cloud-bridge.storage: write failed');
    return false;
  }
}

/**
 * Return the public-safe shape for a link — the raw API key is NEVER
 * included so this is safe to expose over `GET /api/cloud-bridge/status`.
 *
 * @param {string} localServerId
 * @returns {object|null}
 */
function getPublic(localServerId) {
  const state = _readRaw();
  const link = state.links[localServerId];
  if (!link) return null;
  return {
    cloudServerId: link.cloudServerId,
    name: link.name,
    linkedAt: link.linkedAt,
    lastStatus: link.lastStatus,
    lastStatusAt: link.lastStatusAt,
    lastError: link.lastError || null,
  };
}

/**
 * Return ALL link entries in public-safe shape, keyed by localServerId.
 */
function listPublic() {
  const state = _readRaw();
  const out = {};
  for (const id of Object.keys(state.links)) {
    out[id] = getPublic(id);
  }
  return out;
}

/**
 * Internal — supervisor only. Decrypts the API key on read so callers can
 * feed it straight into the WS auth message. Throws if the link is missing
 * so the caller doesn't silently send an empty auth.
 *
 * @param {string} localServerId
 * @returns {{ cloudServerId: string, apiKey: string, name: string }}
 */
function getSecret(localServerId) {
  const state = _readRaw();
  const link = state.links[localServerId];
  if (!link) throw new Error(`No cloud link for server ${localServerId}`);
  return {
    cloudServerId: link.cloudServerId,
    apiKey: decrypt(link.apiKey),
    name: link.name,
  };
}

/**
 * Persist a fresh link. Encrypts the API key at rest.
 *
 * @param {string} localServerId
 * @param {{ cloudServerId: string, apiKey: string, name?: string }} link
 */
function setLink(localServerId, { cloudServerId, apiKey, name }) {
  const state = _readRaw();
  const now = new Date().toISOString();
  state.links[localServerId] = {
    cloudServerId,
    apiKey: encrypt(apiKey),
    name: name || '',
    linkedAt: state.links[localServerId]?.linkedAt || now,
    lastStatus: 'unknown',
    lastStatusAt: now,
    lastError: null,
  };
  _writeRaw(state);
}

/**
 * Remove a link entirely — used by the unlink endpoint. Returns true if a
 * link was actually deleted, false if there was nothing to remove (caller
 * can decide whether that's a 404 or a 200-no-op).
 */
function removeLink(localServerId) {
  const state = _readRaw();
  if (!state.links[localServerId]) return false;
  delete state.links[localServerId];
  _pendingOffsets.delete(localServerId);
  _writeRaw(state);
  return true;
}

/**
 * Update only the runtime status fields. Called by the WS supervisor on
 * connect / disconnect / auth-failed so the UI can show live state.
 *
 * @param {string} localServerId
 * @param {'connected'|'disconnected'|'auth-failed'|'unknown'} status
 * @param {string|null} [error]
 */
function updateStatus(localServerId, status, error) {
  const state = _readRaw();
  const link = state.links[localServerId];
  if (!link) return;
  link.lastStatus = status;
  link.lastStatusAt = new Date().toISOString();
  link.lastError = error || null;
  _writeRaw(state);
}

// ─── Durable telemetry cursor (G1) ───────────────────────────────────────
//
// events.jsonl byte offset through which telemetry has been forwarded to the
// cloud, per local server. Persisted so a backend restart or cloud outage
// resumes forwarding from where it left off instead of silently losing the
// gap. Writes are DEBOUNCED because _writeRaw rewrites the whole file
// synchronously and the forwarder advances the offset ~every second.

const _pendingOffsets = new Map(); // localServerId -> latest offset not yet flushed
let _offsetFlushTimer = null;

/**
 * Record the latest cloud-forwarded byte offset for a server. Coalesced and
 * flushed to disk after a short delay (or explicitly via flushAckedOffsets).
 */
function setAckedOffset(localServerId, offset) {
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) return;
  _pendingOffsets.set(localServerId, offset);
  if (!_offsetFlushTimer) {
    _offsetFlushTimer = setTimeout(flushAckedOffsets, 2000);
    _offsetFlushTimer.unref?.();
  }
}

/**
 * Read the persisted (or pending) cloud-forwarded offset for a server.
 * Returns null when there is none — caller treats that as "brand-new link,
 * start at the current tail" rather than replaying all history.
 */
function getAckedOffset(localServerId) {
  if (_pendingOffsets.has(localServerId)) return _pendingOffsets.get(localServerId);
  const link = _readRaw().links[localServerId];
  return link && typeof link.cloudAckedOffset === 'number' ? link.cloudAckedOffset : null;
}

/** Flush any pending offsets to disk now. Safe to call with nothing pending. */
function flushAckedOffsets() {
  if (_offsetFlushTimer) { clearTimeout(_offsetFlushTimer); _offsetFlushTimer = null; }
  if (_pendingOffsets.size === 0) return;
  const state = _readRaw();
  for (const [id, off] of _pendingOffsets) {
    if (state.links[id]) state.links[id].cloudAckedOffset = off;
  }
  _pendingOffsets.clear();
  _writeRaw(state);
}

module.exports = {
  getPublic,
  listPublic,
  getSecret,
  setLink,
  removeLink,
  updateStatus,
  setAckedOffset,
  getAckedOffset,
  flushAckedOffsets,
  FILE,
};
