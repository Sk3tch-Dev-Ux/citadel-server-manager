/**
 * Ban management — InHouse sidecar + RCON.
 * Dual-write: RCON ban for immediate BattlEye effect + sidecar for persistence.
 * No CFTools dependency.
 */
const logger = require('./logger');
const ctx = require('./context');

/**
 * Get the sidecar base URL for a server (if configured).
 */
function getSidecarUrl(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  return srv?.inHouseApiUrl || null;
}

/**
 * Build fetch headers for the sidecar API.
 */
function sidecarHeaders(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const headers = { 'Content-Type': 'application/json' };
  if (srv?.inHouseApiKey) headers['Authorization'] = `Bearer ${srv.inHouseApiKey}`;
  return headers;
}

/**
 * List bans for a server. Returns local state.banList,
 * optionally syncing from the sidecar on first call.
 */
async function listBans(serverId) {
  const state = ctx.serverStates[serverId];

  // Try to sync from sidecar if we haven't recently
  const baseUrl = getSidecarUrl(serverId);
  if (baseUrl && (!state._lastBanSync || Date.now() - state._lastBanSync > 30000)) {
    try {
      const res = await fetch(`${baseUrl}/bans`, { headers: sidecarHeaders(serverId) });
      if (res.ok) {
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) {
          state.banList = json.data;
          state._lastBanSync = Date.now();
        }
      }
    } catch (err) {
      logger.debug({ err: err.message, serverId }, 'Sidecar ban sync failed, using local cache');
    }
  }

  return state?.banList || [];
}

/**
 * Ban a player. Issues RCON ban (immediate) AND sidecar ban (persistent).
 */
async function banPlayer(serverId, playerId, reason, expiration) {
  const state = ctx.serverStates[serverId];

  // RCON ban for immediate BattlEye effect
  if (state?.rcon) {
    try {
      await state.rcon.ban(playerId, reason || 'Banned');
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'RCON ban failed');
    }
  }

  // Sidecar ban for persistence
  const baseUrl = getSidecarUrl(serverId);
  if (baseUrl) {
    try {
      const player = state?.players?.find(p => p.id === playerId || p.steamId === playerId);
      const res = await fetch(`${baseUrl}/bans`, {
        method: 'POST',
        headers: sidecarHeaders(serverId),
        body: JSON.stringify({
          steamId: playerId,
          name: player?.name || 'Unknown',
          reason: reason || 'Banned',
          expiration: expiration || null,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        logger.info({ serverId, playerId }, 'Sidecar ban created');
        // Use the sidecar's ban entry for local state
        if (json.ok && json.data && state) {
          state.banList.push(json.data);
          return;
        }
      }
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'Sidecar ban failed');
    }
  }

  // Update local state for immediate UI feedback (fallback if sidecar unavailable)
  if (state) {
    const player = state.players?.find(p => p.id === playerId || p.steamId === playerId);
    state.banList.push({
      id: playerId,
      name: player?.name || 'Unknown',
      reason: reason || 'Banned',
      bannedAt: new Date().toISOString(),
      expiresAt: expiration instanceof Date ? expiration.toISOString() : null,
      source: baseUrl ? 'inhouse' : 'rcon',
    });
  }
}

/**
 * Unban a player. Remove from local state and sidecar.
 */
async function unbanPlayer(serverId, banId) {
  const state = ctx.serverStates[serverId];
  const ban = state?.banList?.find(b => b.id === banId);

  // Remove from local state
  if (state) {
    state.banList = state.banList.filter(b => b.id !== banId);
  }

  // Remove from sidecar
  const baseUrl = getSidecarUrl(serverId);
  if (baseUrl && ban) {
    try {
      await fetch(`${baseUrl}/bans/${encodeURIComponent(ban.id || ban.steamId || banId)}`, {
        method: 'DELETE',
        headers: sidecarHeaders(serverId),
      });
      logger.info({ serverId, banId }, 'Sidecar ban removed');
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'Sidecar unban failed');
    }
  }
}

module.exports = { listBans, banPlayer, unbanPlayer };
