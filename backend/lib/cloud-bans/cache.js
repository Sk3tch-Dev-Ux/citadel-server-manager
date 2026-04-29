/**
 * Local cache of the community ban list.
 *
 * Persisted to data/cloud-bans-cache.json so a temporary network outage
 * doesn't unprotect a customer's server. Survives backend restarts.
 *
 * Shape:
 *   {
 *     cursor: "ISO8601 string — passed as `since` on next /sync",
 *     updatedAt: "ISO8601 — last successful sync",
 *     bans: {
 *       "<steamId>": {
 *         steamId, reasonCategory, vouchCount, status, activatedAt
 *       },
 *       ...
 *     }
 *   }
 *
 * `bans` is a map keyed by steamId for O(1) lookups during enforcement.
 * Status='overturned' or 'expired' bans are removed from the map on sync
 * (the server tells us about them via /sync so we know to take them off
 * our local enforcement list).
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../paths');

const CACHE_FILE = path.join(ROOT, 'data', 'cloud-bans-cache.json');

function load() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return defaultCache();
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // Validate shape — corrupt cache shouldn't crash the backend.
    if (!parsed || typeof parsed !== 'object' || !parsed.bans) return defaultCache();
    return parsed;
  } catch {
    return defaultCache();
  }
}

function save(cache) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function defaultCache() {
  return {
    cursor: null,
    updatedAt: null,
    bans: {},
  };
}

/**
 * Apply a /sync delta to the cache. Returns the set of SteamIDs that
 * changed (added, removed, or status-changed) so the enforcer can do
 * a surgical update of bans.txt instead of regenerating from scratch.
 *
 * @returns {{
 *   added: Set<string>,
 *   removed: Set<string>,
 *   nextCursor: string,
 * }}
 */
function applyDelta(cache, response) {
  const added = new Set();
  const removed = new Set();

  for (const ban of response.bans || []) {
    const existing = cache.bans[ban.steamId];

    if (ban.status === 'active') {
      // Add or update.
      if (!existing) {
        added.add(ban.steamId);
      }
      cache.bans[ban.steamId] = {
        steamId: ban.steamId,
        reasonCategory: ban.reasonCategory,
        vouchCount: ban.vouchCount,
        status: ban.status,
        activatedAt: ban.activatedAt,
      };
    } else if (ban.status === 'overturned' || ban.status === 'expired') {
      // Drop from the cache. The server signals these so the client knows
      // to stop enforcing them.
      if (existing) {
        removed.add(ban.steamId);
        delete cache.bans[ban.steamId];
      }
    }
    // Other statuses (e.g. 'pending') are not propagated to /sync; we
    // never see them here.
  }

  cache.cursor = response.cursor || cache.cursor;
  cache.updatedAt = new Date().toISOString();

  return { added, removed, nextCursor: cache.cursor };
}

/**
 * Whole-cache stats useful for the dashboard.
 */
function stats(cache) {
  const total = Object.keys(cache.bans).length;
  let cheating = 0, griefing = 0, exploiting = 0, other = 0;
  for (const b of Object.values(cache.bans)) {
    if (b.reasonCategory === 'cheating') cheating++;
    else if (b.reasonCategory === 'griefing') griefing++;
    else if (b.reasonCategory === 'exploiting') exploiting++;
    else other++;
  }
  return {
    total,
    byCategory: { cheating, griefing, exploiting, other },
    lastSyncAt: cache.updatedAt,
  };
}

function steamIdSet(cache) {
  return new Set(Object.keys(cache.bans));
}

function isBanned(cache, steamId) {
  return Boolean(cache.bans[steamId]);
}

function clear() {
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  load,
  save,
  applyDelta,
  stats,
  steamIdSet,
  isBanned,
  clear,
  CACHE_FILE,
};
