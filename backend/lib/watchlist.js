/**
 * Watchlist helpers.
 *
 * Storage lives in `ctx.watchList` (loaded at boot from watchlist.json).
 * Routes at `backend/routes/watchlist.routes.js` handle CRUD.
 *
 * This module exposes a single check: `alertOnWatchlistHit(serverId, player)`
 * is called by citadel-socket.js whenever a new player appears in the roster
 * diff. If the player's steamId matches a watchlist entry, we:
 *   1. Bump the entry's hitCount and lastSeenAt
 *   2. Persist the updated watchlist
 *   3. Fire an in-app notification at `warning` severity
 *   4. Write an audit log entry
 *   5. Fire any registered webhooks (so Discord alerts trigger too)
 *
 * Matching rules:
 *   - Primary: exact steamId match (most reliable)
 *   - Fallback: case-insensitive name match (if no steamId on the entry —
 *     name-only entries are lower confidence but still useful for PVE-style
 *     "watch this griefer") — the notification labels match type accordingly
 */
const ctx = require('./context');
const logger = require('./logger');
const { saveJSON } = require('./data-store');

/**
 * Find watchlist entries matching a given player.
 * Returns an array (a player could match multiple entries — e.g. alt
 * tracking where admins add the same person under several aliases).
 *
 * @param {{ steamId?: string, name?: string }} player
 * @returns {Array<{ entry: object, matchType: 'steamid' | 'name' }>}
 */
function findMatches(player) {
  if (!Array.isArray(ctx.watchList) || ctx.watchList.length === 0) return [];
  const matches = [];
  const sid = (player?.steamId || '').trim();
  const name = (player?.name || '').trim().toLowerCase();

  for (const entry of ctx.watchList) {
    if (sid && entry.steamId && entry.steamId === sid) {
      matches.push({ entry, matchType: 'steamid' });
      continue;
    }
    if (!entry.steamId && name && (entry.name || '').toLowerCase() === name) {
      matches.push({ entry, matchType: 'name' });
    }
  }
  return matches;
}

/**
 * Called when a player joins a server. Fires notifications + webhooks for
 * any watchlist match. Safe to call for every roster-diff event — no-ops
 * quickly if the watchlist is empty.
 *
 * This must NEVER throw — it's called inside the socket event hot path and
 * a failure here should never take down the event stream.
 */
function alertOnWatchlistHit(serverId, player) {
  try {
    const matches = findMatches(player);
    if (matches.length === 0) return;

    const srv = ctx.servers.find((s) => s.id === serverId);
    const serverName = srv?.name || serverId;

    // Lazy require to avoid circular dep with notifications.js
    const { addNotification, fireWebhooks } = require('./notifications');
    const { addAudit } = require('./audit');

    for (const { entry, matchType } of matches) {
      // Bump the entry
      entry.hitCount = (entry.hitCount || 0) + 1;
      entry.lastSeenAt = new Date().toISOString();

      const title = `Watchlist hit — ${entry.name}`;
      const reason = entry.reason ? ` — ${entry.reason}` : '';
      const tag = matchType === 'steamid' ? 'SteamID match' : 'Name match';
      const message = `${entry.name} joined ${serverName} (${tag})${reason}`;

      addNotification(serverId, 'watchlist.hit', title, message, 'warning');

      fireWebhooks('watchlist.hit', {
        serverId,
        serverName,
        entry: {
          id: entry.id,
          name: entry.name,
          steamId: entry.steamId || null,
          reason: entry.reason || null,
          tags: entry.tags || [],
        },
        player: { name: player.name, steamId: player.steamId || null },
        matchType,
        hitCount: entry.hitCount,
      });

      addAudit(null, 'system', 'watchlist.hit',
        `Watchlist hit: ${entry.name} joined ${serverName} (${matchType})`);

      logger.info({
        serverId, watchId: entry.id, playerName: player.name, steamId: player.steamId, matchType,
      }, 'watchlist: hit');
    }

    // Persist the bumped counters. Debounce would be nicer but the
    // per-join rate is low enough that a synchronous write per hit is fine.
    saveJSON(ctx.CONFIG.dataDir, 'watchlist.json', ctx.watchList);
  } catch (err) {
    logger.warn({ err: err.message, serverId }, 'watchlist: hit handler failed');
  }
}

module.exports = {
  findMatches,
  alertOnWatchlistHit,
};
