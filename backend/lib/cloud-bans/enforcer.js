/**
 * Cloud bans enforcer — propagates the community ban list into the actual
 * BattlEye `ban.txt` files for each managed server.
 *
 * Design:
 *   - Each server's ban.txt contains the union of (local bans from
 *     ban-engine) ∪ (community bans from this module's cache).
 *   - On a sync delta, we surgically add new SteamIDs and remove ones
 *     that the server said are now overturned/expired.
 *   - We never delete entries that came from local bans — the local
 *     ban-engine remains the source of truth for those.
 *
 * Because BattlEye's ban.txt is a flat file with no metadata distinguishing
 * "where did this entry come from", we maintain a side map (in memory) of
 * "SteamIDs we added because of community sync". When community sync says
 * to remove one, we only remove it if our side-map says we put it there
 * (i.e. don't remove a SteamID the customer banned locally).
 */
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const ctx = require('../context');

// In-memory tracking of which SteamIDs we've written to which server's
// ban.txt because of community sync. Keys: serverId. Values: Set of steamIds.
const _addedByUs = new Map();

function _getServerBanPath(srv) {
  if (!srv?.installDir) return null;
  return path.join(srv.installDir, 'ban.txt');
}

function _readBanFileLines(banPath) {
  try {
    if (!fs.existsSync(banPath)) return [];
    return fs.readFileSync(banPath, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function _writeBanFileLines(banPath, lines) {
  try {
    fs.writeFileSync(banPath, lines.join('\n') + (lines.length ? '\n' : ''));
    return true;
  } catch (err) {
    logger.warn({ err: err.message, banPath }, 'cloud-bans: failed to write ban.txt');
    return false;
  }
}

/**
 * Apply a delta to all managed servers. Idempotent — adding an already-banned
 * SteamID is a no-op; removing one not in our side-map is a no-op.
 *
 * @param {Set<string>} added SteamIDs newly active in the community DB
 * @param {Set<string>} removed SteamIDs newly overturned/expired
 */
function applyDeltaToServers(added, removed) {
  if (!ctx.servers || ctx.servers.length === 0) return;

  for (const srv of ctx.servers) {
    const banPath = _getServerBanPath(srv);
    if (!banPath) continue;

    const ours = _addedByUs.get(srv.id) || new Set();
    const lines = _readBanFileLines(banPath);
    const present = new Set(lines);

    let mutated = false;

    // Add new community SteamIDs that aren't already present.
    for (const sid of added) {
      if (!present.has(sid)) {
        lines.push(sid);
        present.add(sid);
        mutated = true;
      }
      // Track that we added this — but only if the local ban-engine doesn't
      // already cover it. If the customer also has a local ban for this
      // SteamID, we don't want to claim ownership (or we'd remove it on
      // overturn, kicking back the customer's local ban).
      const localBanForSteamId = ctx.banDatabase?.find?.((b) => b.steamId === sid);
      if (!localBanForSteamId) ours.add(sid);
    }

    // Remove community SteamIDs we own that the server says are gone.
    for (const sid of removed) {
      if (ours.has(sid)) {
        const idx = lines.indexOf(sid);
        if (idx !== -1) {
          lines.splice(idx, 1);
          mutated = true;
        }
        ours.delete(sid);
      }
      // If `ours` doesn't have it, the customer either never had this banned
      // OR their local ban-engine has it (covered by `ban-engine.removeBan`).
      // Either way, leave it alone.
    }

    if (mutated) {
      _writeBanFileLines(banPath, lines);
      logger.info(
        { serverId: srv.id, addedCount: added.size, removedCount: removed.size },
        'cloud-bans: ban.txt updated',
      );
    }
    _addedByUs.set(srv.id, ours);
  }
}

/**
 * Full reconciliation — used at boot and after a server is added. Ensures
 * every community-banned SteamID is present in every server's ban.txt.
 *
 * @param {Set<string>} communitySteamIds Current cache.steamIdSet()
 */
function reconcileAll(communitySteamIds) {
  if (!ctx.servers || ctx.servers.length === 0) return;

  for (const srv of ctx.servers) {
    const banPath = _getServerBanPath(srv);
    if (!banPath) continue;

    const lines = _readBanFileLines(banPath);
    const present = new Set(lines);
    const ours = _addedByUs.get(srv.id) || new Set();

    let mutated = false;

    for (const sid of communitySteamIds) {
      if (!present.has(sid)) {
        lines.push(sid);
        present.add(sid);
        mutated = true;
      }
      const localBan = ctx.banDatabase?.find?.((b) => b.steamId === sid);
      if (!localBan) ours.add(sid);
    }

    if (mutated) {
      _writeBanFileLines(banPath, lines);
      logger.info(
        { serverId: srv.id, total: communitySteamIds.size },
        'cloud-bans: full reconciliation wrote ban.txt',
      );
    }
    _addedByUs.set(srv.id, ours);
  }
}

/**
 * Called when the customer deactivates Citadel Cloud — remove every
 * community-banned SteamID we added so the customer is back to their
 * pre-cloud state. Their local bans are untouched.
 */
function clearAllCommunityBans() {
  if (!ctx.servers || ctx.servers.length === 0) return;

  for (const srv of ctx.servers) {
    const banPath = _getServerBanPath(srv);
    if (!banPath) continue;

    const ours = _addedByUs.get(srv.id);
    if (!ours || ours.size === 0) continue;

    const lines = _readBanFileLines(banPath).filter((l) => !ours.has(l));
    _writeBanFileLines(banPath, lines);
    _addedByUs.set(srv.id, new Set());
    logger.info({ serverId: srv.id, removed: ours.size }, 'cloud-bans: cleared on Cloud deactivation');
  }
}

/**
 * Stats for the dashboard / status page.
 */
function getOwnedCounts() {
  const out = {};
  for (const [serverId, set] of _addedByUs.entries()) {
    out[serverId] = set.size;
  }
  return out;
}

module.exports = {
  applyDeltaToServers,
  reconcileAll,
  clearAllCommunityBans,
  getOwnedCounts,
};
