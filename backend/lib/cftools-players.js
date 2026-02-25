/**
 * Player data fetching — CFTools or RCON fallback.
 * Normalizes player data to a consistent format for state.players.
 */
const logger = require('./logger');
const ctx = require('./context');
const { getClient, isConfiguredForServer } = require('./cftools-client');

/**
 * Fetch players for a server using CFTools if available.
 * Returns normalized player array compatible with existing state.players format.
 */
async function fetchPlayers(serverId) {
  if (!isConfiguredForServer(serverId)) {
    return ctx.serverStates[serverId]?.players || [];
  }

  try {
    const client = getClient(serverId);
    if (!client) return ctx.serverStates[serverId]?.players || [];

    const sessions = await client.listGameSessions({});
    const state = ctx.serverStates[serverId];
    if (state?.cftools) {
      state.cftools.gameSessions = sessions;
      state.cftools.lastSessionPoll = Date.now();
    }

    return sessions.map(session => ({
      id: session.id,
      name: session.playerName,
      steamId: session.steamId?.id || '',
      cftoolsId: session.cftoolsId?.id || '',
      ping: session.live?.ping?.actual || 0,
      ip: '',
      source: 'cftools',
      loaded: session.live?.loaded || false,
      position: session.live?.position?.latest || null,
      bans: session.bans ? {
        count: session.bans.count || 0,
        communityBanned: session.bans.communityBanned || false,
        vacBanned: session.bans.vacBanned || false,
        gameBanned: session.bans.gameBanned || false,
      } : null,
    }));
  } catch (err) {
    logger.warn({ err: err.message, serverId }, 'CFTools listGameSessions failed, using cached players');
    return ctx.serverStates[serverId]?.players || [];
  }
}

module.exports = { fetchPlayers };
