/**
 * Cloud Bans — public API consumed by the rest of the backend.
 *
 * Lifecycle:
 *   - At boot, server.js calls `startBackgroundSync()` which kicks off
 *     an initial pull from citadels.cc, reconciles the cache against
 *     each server's ban.txt, and schedules periodic syncs.
 *   - Whenever a customer bans a player via the existing /api/bans/* flow,
 *     a hook in bans.routes.js calls `submitFromLocalBan()` which forwards
 *     the ban to citadels.cc on a fire-and-forget basis (paying customers
 *     only; trial users opt-in).
 *   - Whenever a customer removes a ban locally, `unenrollFromLocalBan()`
 *     is called to revoke their submission.
 *
 * This module only operates when the customer has the Citadel Cloud
 * add-on entitlement. It checks license.hasFeature('cloud') before any
 * network call. Customers on the base Citadel plan (no Cloud add-on) and
 * customers whose Cloud subscription has lapsed see no cloud-bans behavior.
 */
const logger = require('../logger');
const license = require('../license');
const telemetry = require('../telemetry');
const client = require('./client');
const cacheModule = require('./cache');
const enforcer = require('./enforcer');

// ─── Configuration ──────────────────────────────────────────────
const SYNC_INTERVAL_MS = Number(process.env.CITADEL_CLOUD_BANS_SYNC_INTERVAL_MS || 60 * 60 * 1000); // 1h
const INITIAL_SYNC_DELAY_MS = 15 * 1000; // wait 15s after boot for license to settle

// ─── In-memory state ────────────────────────────────────────────
let _cache = cacheModule.load();
let _syncTimer = null;
let _initialTimer = null;
let _syncing = false;
let _lastError = null;

// ─── Public: status + queries ──────────────────────────────────

function getCacheStats() {
  return cacheModule.stats(_cache);
}

function isCommunityBanned(steamId) {
  return cacheModule.isBanned(_cache, steamId);
}

function listCachedBans() {
  return Object.values(_cache.bans);
}

function getEnforcerStatus() {
  return {
    ownedBySever: enforcer.getOwnedCounts(),
    cacheStats: getCacheStats(),
    lastError: _lastError,
    syncing: _syncing,
  };
}

// ─── Public: sync ──────────────────────────────────────────────

async function pullSync() {
  if (!license.hasFeature('cloud')) {
    logger.debug('cloud-bans: license not usable, skipping sync');
    return { ok: false, reason: 'no-license' };
  }
  if (_syncing) return { ok: false, reason: 'in-progress' };
  _syncing = true;

  try {
    let cursor = _cache.cursor || undefined;
    let totalAdded = 0;
    let totalRemoved = 0;
    // Page through deltas. Stops when hasMore=false.
    for (let i = 0; i < 100; i++) { // safety cap — never spin
      const response = await client.sync({ since: cursor, limit: 500 });
      const { added, removed, nextCursor } = cacheModule.applyDelta(_cache, response);
      cacheModule.save(_cache);
      enforcer.applyDeltaToServers(added, removed);
      totalAdded += added.size;
      totalRemoved += removed.size;
      cursor = nextCursor;
      if (!response.hasMore) break;
    }
    _lastError = null;
    telemetry.report('cloud-bans.sync.success', undefined);
    logger.info(
      { totalAdded, totalRemoved, totalCached: Object.keys(_cache.bans).length },
      'cloud-bans: sync complete',
    );
    return { ok: true, totalAdded, totalRemoved };
  } catch (err) {
    _lastError = err.message;
    logger.warn({ err: err.message, status: err.status }, 'cloud-bans: sync failed');
    telemetry.report('cloud-bans.sync.failure', {
      statusCode: err.status,
      errorCode: err.code,
    });
    return { ok: false, reason: err.message };
  } finally {
    _syncing = false;
  }
}

/**
 * Start the periodic sync loop. Idempotent.
 */
function startBackgroundSync() {
  if (_syncTimer) return;
  // Initial pull once the license module has loaded.
  _initialTimer = setTimeout(() => {
    pullSync().catch(() => {});
    // After the first sync, do a full reconcile so any server that booted
    // before us gets its bans.txt patched up.
    enforcer.reconcileAll(cacheModule.steamIdSet(_cache));
  }, INITIAL_SYNC_DELAY_MS);

  _syncTimer = setInterval(() => {
    pullSync().catch(() => {});
  }, SYNC_INTERVAL_MS);
  if (typeof _syncTimer.unref === 'function') _syncTimer.unref();
}

function stopBackgroundSync() {
  if (_initialTimer) clearTimeout(_initialTimer);
  if (_syncTimer) clearInterval(_syncTimer);
  _initialTimer = null;
  _syncTimer = null;
}

// ─── Public: write paths ───────────────────────────────────────

/**
 * Forward a local ban to the community DB. Called from bans.routes.js
 * after a successful local ban. Best-effort — failures don't roll back
 * the local ban (the customer's server is still protected by their own
 * ban; the community submission is a separate concern).
 *
 * @param {object} args
 * @param {string} args.steamId
 * @param {string} args.reasonCategory
 * @param {string} [args.notesLocal]
 * @returns {Promise<{ ok: boolean, ban?, submission?, reason? }>}
 */
async function submitFromLocalBan({ steamId, reasonCategory, notesLocal }) {
  if (!license.hasFeature('cloud')) return { ok: false, reason: 'no-cloud-entitlement' };
  try {
    const result = await client.submit({ steamId, reasonCategory, notesLocal });
    telemetry.report('cloud-bans.submit', undefined);
    logger.info({ steamId, reasonCategory }, 'cloud-bans: submitted to community DB');
    return { ok: true, ...result };
  } catch (err) {
    logger.warn(
      { err: err.message, status: err.status, code: err.code },
      'cloud-bans: submit failed',
    );
    return {
      ok: false,
      reason: err.message,
      status: err.status,
      code: err.code,
      retryAfter: err.retryAfter,
    };
  }
}

async function unenrollFromLocalBan({ steamId }) {
  if (!license.hasFeature('cloud')) return { ok: false, reason: 'no-cloud-entitlement' };
  try {
    const result = await client.unenroll({ steamId });
    telemetry.report('cloud-bans.unenroll', undefined);
    logger.info({ steamId }, 'cloud-bans: unenrolled from community DB');
    return { ok: true, ...result };
  } catch (err) {
    logger.warn(
      { err: err.message, status: err.status },
      'cloud-bans: unenroll failed',
    );
    return { ok: false, reason: err.message, status: err.status };
  }
}

/**
 * Called when the customer deactivates Citadel Cloud (deactivate device).
 * Wipes local enforcement of community bans. Their local bans are kept;
 * future cloud reactivation re-pulls.
 */
function onLicenseDeactivated() {
  enforcer.clearAllCommunityBans();
  cacheModule.clear();
  _cache = cacheModule.load();
  logger.info('cloud-bans: cleared all community ban enforcement on license deactivation');
}

// ─── Manual ops ────────────────────────────────────────────────

/**
 * Trigger an immediate sync, e.g. when the customer clicks "Sync now"
 * on the /global-bans dashboard page.
 */
async function manualSync() {
  return pullSync();
}

module.exports = {
  // Lifecycle
  startBackgroundSync,
  stopBackgroundSync,
  onLicenseDeactivated,

  // Read API
  getCacheStats,
  getEnforcerStatus,
  isCommunityBanned,
  listCachedBans,

  // Write API (called from bans.routes.js)
  submitFromLocalBan,
  unenrollFromLocalBan,

  // Manual
  manualSync,
};
