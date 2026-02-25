/**
 * Ban management — CFTools or RCON fallback.
 * Dual-write: RCON ban for immediate effect + CFTools ban for persistence.
 */
const logger = require('./logger');
const ctx = require('./context');
const { getClient, isConfiguredForServer, getSdkTypes } = require('./cftools-client');

/**
 * List bans for a server. Returns local state.banList (which may include
 * CFTools-sourced bans synced during polling).
 */
async function listBans(serverId) {
  const state = ctx.serverStates[serverId];
  return state?.banList || [];
}

/**
 * Ban a player. Issues RCON ban (immediate) AND CFTools ban (persistent) when available.
 */
async function banPlayer(serverId, playerId, reason, expiration) {
  const state = ctx.serverStates[serverId];
  const srv = ctx.servers.find(s => s.id === serverId);

  // RCON ban for immediate in-game effect
  if (state?.rcon) {
    try {
      await state.rcon.ban(playerId, reason || 'Banned');
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'RCON ban failed');
    }
  }

  // CFTools ban for persistence
  if (isConfiguredForServer(serverId) && srv?.cftoolsBanlistId) {
    try {
      const client = getClient(serverId);
      const sdk = getSdkTypes();
      if (client && sdk) {
        await client.putBan({
          playerId: sdk.SteamId64.of(playerId),
          list: sdk.Banlist.of(srv.cftoolsBanlistId),
          reason: reason || 'Banned',
          expiration: expiration || 'Permanent',
        });
        logger.info({ serverId, playerId }, 'CFTools ban created');
      }
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'CFTools putBan failed');
    }
  }

  // Update local state for immediate UI feedback
  if (state) {
    const player = state.players?.find(p => p.id === playerId || p.steamId === playerId);
    state.banList.push({
      id: playerId,
      name: player?.name || 'Unknown',
      reason: reason || 'Banned',
      bannedAt: new Date().toISOString(),
      expiresAt: expiration instanceof Date ? expiration.toISOString() : null,
      source: isConfiguredForServer(serverId) ? 'cftools' : 'rcon',
    });
  }
}

/**
 * Unban a player. Remove from local state and CFTools if configured.
 */
async function unbanPlayer(serverId, banId) {
  const state = ctx.serverStates[serverId];
  const srv = ctx.servers.find(s => s.id === serverId);
  const ban = state?.banList?.find(b => b.id === banId);

  // Remove from local state
  if (state) {
    state.banList = state.banList.filter(b => b.id !== banId);
  }

  // Remove from CFTools if we have a steamId to reference
  if (isConfiguredForServer(serverId) && srv?.cftoolsBanlistId && ban) {
    try {
      const client = getClient(serverId);
      const sdk = getSdkTypes();
      if (client && sdk) {
        const steamId = ban.steamId || ban.id;
        await client.deleteBans({
          playerId: sdk.SteamId64.of(steamId),
          list: sdk.Banlist.of(srv.cftoolsBanlistId),
        });
        logger.info({ serverId, banId }, 'CFTools ban removed');
      }
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'CFTools deleteBan failed');
    }
  }
}

module.exports = { listBans, banPlayer, unbanPlayer };
