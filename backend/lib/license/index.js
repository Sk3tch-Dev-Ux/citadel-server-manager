/**
 * Citadel license — high-level service used by the backend.
 *
 * Handles activation, verification with offline grace, and status reporting.
 * Everything else in the backend consumes this module's exports; it should
 * never reach into the sub-modules (client, storage, verifier) directly.
 */
const logger = require('../logger');
const client = require('./client');
const storage = require('./storage');
const { verifyToken, decodeToken } = require('./verifier');
const { getMachineId } = require('./machine-id');

const GRACE_DAYS = Number(process.env.CITADEL_LICENSE_GRACE_DAYS || 7);
const VERIFY_INTERVAL_MS = Number(process.env.CITADEL_LICENSE_VERIFY_INTERVAL_MS || 6 * 60 * 60 * 1000); // 6h

/** Current in-memory license state. Set by loadFromDisk() + refresh(). */
let _state = {
  status: 'uninitialized',      // uninitialized | active | grace | expired | lapsed | error
  token: null,
  claims: null,
  subscription: null,            // { status, renewsAt, cancelAt }
  lastVerifiedAt: null,
  lastError: null,
};

function getState() {
  return { ..._state };
}

function machineId() {
  return getMachineId();
}

/** Hydrate _state from the on-disk cache. Called at boot. */
function loadFromDisk() {
  const cached = storage.read();
  if (!cached?.token) {
    _state.status = 'unactivated';
    return;
  }
  try {
    const claims = verifyToken(cached.token);
    _state.token = cached.token;
    _state.claims = claims;
    _state.subscription = cached.subscription || null;
    _state.lastVerifiedAt = cached.lastVerifiedAt || null;
    _state.status = evaluateStatus(claims, cached.lastVerifiedAt);
  } catch (err) {
    logger.warn({ err: err.message }, 'Cached license token is invalid — clearing');
    storage.clear();
    _state.status = 'unactivated';
    _state.lastError = err.message;
  }
}

/**
 * Decide current status based on token expiry + last successful verify.
 *  - active   : token not expired AND verified within the last VERIFY_INTERVAL
 *  - grace    : token not expired but last verify was > interval ago; still usable for up to GRACE_DAYS
 *  - expired  : grace window exceeded — user must re-verify before any gated action
 *  - lapsed   : token claims say subscription is canceled/inactive
 */
function evaluateStatus(claims, lastVerifiedAt) {
  if (!claims) return 'unactivated';
  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < nowSec) {
    const gracePassed = lastVerifiedAt && (Date.now() - new Date(lastVerifiedAt).getTime()) > GRACE_DAYS * 86400000;
    return gracePassed ? 'expired' : 'grace';
  }
  const subStatus = claims.subscriptionStatus;
  if (subStatus === 'canceled' || subStatus === 'lapsed') return 'lapsed';
  return 'active';
}

/**
 * POST /license/activate on citadels.cc with the user's creds + this box's MachineGuid.
 * Persists the returned token to disk on success.
 */
async function activate({ email, password, name }) {
  try {
    const res = await client.activate({
      email,
      password,
      machineId: machineId(),
      name,
    });
    const claims = verifyToken(res.token); // must be verifiable with our embedded pub key
    const record = {
      token: res.token,
      subscription: res.subscription,
      lastVerifiedAt: new Date().toISOString(),
    };
    storage.write(record);
    _state.token = res.token;
    _state.claims = claims;
    _state.subscription = res.subscription;
    _state.lastVerifiedAt = record.lastVerifiedAt;
    _state.status = evaluateStatus(claims, record.lastVerifiedAt);
    _state.lastError = null;
    logger.info({ deviceId: claims.deviceId, status: _state.status }, 'Citadel license activated');
    return { ok: true, state: getState() };
  } catch (err) {
    _state.lastError = err.message;
    logger.warn({ err: err.message, status: err.status }, 'License activation failed');
    throw err;
  }
}

/**
 * Call /license/verify to refresh the token and pick up subscription changes.
 * Safe to call frequently — server handles rate limiting.
 */
async function refresh() {
  if (!_state.token) return { ok: false, reason: 'not-activated' };
  try {
    const res = await client.verify(_state.token);
    const claims = verifyToken(res.token);
    const record = {
      token: res.token,
      subscription: res.subscription,
      lastVerifiedAt: new Date().toISOString(),
    };
    storage.write(record);
    _state.token = res.token;
    _state.claims = claims;
    _state.subscription = res.subscription;
    _state.lastVerifiedAt = record.lastVerifiedAt;
    _state.status = evaluateStatus(claims, record.lastVerifiedAt);
    _state.lastError = null;
    return { ok: true, state: getState() };
  } catch (err) {
    // Network failure — stay in whatever status we were in (grace will handle it)
    _state.lastError = err.message;
    if (err.status === 401 || err.status === 403) {
      // Token rejected server-side — clear local state
      storage.clear();
      _state.token = null;
      _state.claims = null;
      _state.status = 'unactivated';
      logger.warn('License verify rejected by server — deactivated locally');
    } else {
      logger.debug({ err: err.message }, 'License verify failed (network?)');
    }
    return { ok: false, reason: err.message };
  }
}

async function deactivate() {
  if (!_state.token) {
    storage.clear();
    _state.status = 'unactivated';
    return { ok: true };
  }
  try {
    await client.deactivate(_state.token);
  } catch (err) {
    logger.warn({ err: err.message }, 'License deactivate call failed — clearing local state anyway');
  }
  storage.clear();
  _state.token = null;
  _state.claims = null;
  _state.subscription = null;
  _state.lastVerifiedAt = null;
  _state.status = 'unactivated';
  return { ok: true };
}

/** Periodic background verify so status stays fresh. Call once at boot. */
function startBackgroundRefresh() {
  loadFromDisk();
  // Kick off an initial refresh but don't block startup on it
  refresh().catch(() => {});
  setInterval(() => {
    refresh().catch(() => {});
  }, VERIFY_INTERVAL_MS).unref();
}

/** Convenience for middleware — is the app currently licensed? */
function isUsable() {
  return _state.status === 'active' || _state.status === 'grace';
}

module.exports = {
  getState,
  machineId,
  activate,
  refresh,
  deactivate,
  startBackgroundRefresh,
  isUsable,
  loadFromDisk,
};
