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
const { createMutex } = require('../async-mutex');

// Serializes the state-mutating license ops (activate/refresh/deactivate) so a
// background refresh can't clobber a concurrent user deactivate (and vice
// versa) — they all write the shared in-memory _state across network awaits.
const _licenseLock = createMutex();

// Lazy-loaded to avoid circular requires (telemetry/index.js requires
// machine-id from this directory).
let _telemetry = null;
function telemetry() {
  if (_telemetry) return _telemetry;
  try {
    _telemetry = require('../telemetry');
  } catch {
    _telemetry = { report: () => {} }; // No-op fallback if module fails to load.
  }
  return _telemetry;
}

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
async function _activateImpl({ email, password, name }) {
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
    telemetry().report('license.activate.success');
    return { ok: true, state: getState() };
  } catch (err) {
    _state.lastError = err.message;
    logger.warn({ err: err.message, status: err.status }, 'License activation failed');
    telemetry().report('license.activate.failure', {
      statusCode: err.status,
      errorCode: err.code,
    });
    throw err;
  }
}

/**
 * Call /license/verify to refresh the token and pick up subscription changes.
 * Safe to call frequently — server handles rate limiting.
 */
async function _refreshImpl() {
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
    telemetry().report('license.refresh.failure', {
      statusCode: err.status,
      errorCode: err.code,
    });
    return { ok: false, reason: err.message };
  }
}

async function _deactivateImpl() {
  if (!_state.token) {
    storage.clear();
    _state.status = 'unactivated';
    notifyDeactivated();
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
  notifyDeactivated();
  return { ok: true };
}

/**
 * Tell other modules (cloud-bans, future paid features) that the customer
 * has deactivated. They should wipe any cloud-only state from this machine.
 * Best-effort — failures don't block the local deactivate flow.
 */
function notifyDeactivated() {
  try {
    require('../cloud-bans').onLicenseDeactivated();
  } catch {
    // cloud-bans not loaded yet, or failed to import — fine.
  }
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

/** Convenience for middleware — is the app currently licensed (Citadel sub)? */
function isUsable() {
  return _state.status === 'active' || _state.status === 'grace';
}

/**
 * Read entitlements from the verified JWT claims. Always includes 'citadel'
 * when the customer has an active Citadel sub (which is required for
 * activation in the first place). Includes 'cloud' iff their Citadel Cloud
 * add-on subscription is active.
 *
 * Returns an empty array if no token is loaded — callers should treat that
 * as "no entitlements" (i.e. show the LicenseGate / require-license 402).
 */
function getEntitlements() {
  if (!_state.claims) return [];
  return Array.isArray(_state.claims.entitlements) ? _state.claims.entitlements : [];
}

/**
 * Does the current customer have access to a specific paid feature?
 *
 *   hasFeature('cloud') → true if Citadel Cloud is active on this account
 *
 * Always combined with isUsable() — a lapsed Citadel sub means we can't
 * trust the cached entitlements either; the customer needs to re-activate
 * before any feature gate counts.
 */
function hasFeature(feature) {
  if (!isUsable()) return false;
  return getEntitlements().includes(feature);
}

/** Backwards-compat shorthand for the most-checked feature. */
function hasCloud() {
  return hasFeature('cloud');
}

// ─── Serialized public entry points ──────────────────────
// All three mutate _state across network awaits; the mutex guarantees they
// run one-at-a-time, so e.g. a deactivate cannot be undone by an in-flight
// refresh that resolves afterward.
function activate(args) { return _licenseLock(() => _activateImpl(args)); }
function refresh() { return _licenseLock(() => _refreshImpl()); }
function deactivate() { return _licenseLock(() => _deactivateImpl()); }

module.exports = {
  getState,
  machineId,
  activate,
  refresh,
  deactivate,
  startBackgroundRefresh,
  isUsable,
  hasFeature,
  hasCloud,
  getEntitlements,
  loadFromDisk,
};
