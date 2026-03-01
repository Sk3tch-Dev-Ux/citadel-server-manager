/**
 * Player data fetching — InHouse sidecar or RCON fallback.
 * Normalizes player data to a consistent format for state.players.
 * No CFTools dependency.
 */
const logger = require('./logger');
const ctx = require('./context');

/**
 * Fetch players for a server using the InHouse sidecar if available.
 * Returns normalized player array compatible with existing state.players format.
 */
async function fetchPlayers(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const baseUrl = srv?.inHouseApiUrl;

  if (!baseUrl) {
    return ctx.serverStates[serverId]?.players || [];
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (srv.inHouseApiKey) headers['Authorization'] = `Bearer ${srv.inHouseApiKey}`;

    const res = await fetch(`${baseUrl}/players`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (!json.ok || !Array.isArray(json.data)) throw new Error('Invalid player response');

    const state = ctx.serverStates[serverId];
    if (state?.inhouse) {
      state.inhouse.sessions = json.data;
      state.inhouse.lastPoll = Date.now();
    }

    return json.data.map(player => ({
      id: player.id || player.steamId,
      name: player.name || 'Unknown',
      steamId: player.steamId || '',
      ping: player.ping || 0,
      ip: '',
      source: 'inhouse',
      loaded: player.loaded !== false,
      position: player.position || null,
      health: player.health || null,
      blood: player.blood || null,
      alive: player.alive !== false,
    }));
  } catch (err) {
    logger.warn({ err: err.message, serverId }, 'Sidecar player fetch failed, using cached players');
    return ctx.serverStates[serverId]?.players || [];
  }
}

module.exports = { fetchPlayers };
