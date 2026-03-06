/**
 * Player data fetching — InHouse sidecar or RCON fallback.
 * Normalizes player data to a consistent format for state.players.
 * Enriches with IP/ping from BattlEye RCON when available.
 * No CFTools dependency.
 */
const logger = require('./logger');
const ctx = require('./context');

/**
 * Parse BattlEye RCON `players` command output.
 * Format:
 *   Players on server:
 *   [#] [IP Address]:[Port] [Ping] [GUID] [Name]
 *   ------------------------------------------
 *   0   123.45.67.89:2304     30     abc123def456(OK)     PlayerName
 *   (N players in total)
 *
 * Returns a map of { playerName: { ip, ping, guid, slot } }
 */
function parseRCONPlayerList(raw) {
  const result = new Map();
  if (!raw || typeof raw !== 'string') return result;

  const lines = raw.split('\n');
  for (const line of lines) {
    // Match: slot  ip:port  ping  guid(status)  name
    const m = line.match(/^\s*(\d+)\s+([\d.]+):(\d+)\s+(\d+)\s+(\w+)\([^)]*\)\s+(.+?)\s*$/);
    if (m) {
      const name = m[6].trim();
      result.set(name, {
        slot: parseInt(m[1]),
        ip: m[2],
        port: parseInt(m[3]),
        ping: parseInt(m[4]),
        guid: m[5],
      });
    }
  }
  return result;
}

/**
 * Fetch IP/ping data from BattlEye RCON for a server.
 * Returns a Map of playerName → { ip, ping, guid, slot } or empty Map on failure.
 */
async function fetchRCONPlayerData(serverId) {
  const state = ctx.serverStates[serverId];
  if (!state?.rcon?.loggedIn) return new Map();

  try {
    const raw = await state.rcon.getPlayers();
    return parseRCONPlayerList(raw);
  } catch (err) {
    logger.debug({ err: err.message, serverId }, 'RCON player list fetch failed');
    return new Map();
  }
}

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

    // Enrich with IP/ping from BattlEye RCON
    const rconData = await fetchRCONPlayerData(serverId);

    return json.data.map(player => {
      const name = player.name || 'Unknown';
      const rcon = rconData.get(name);
      return {
        id: player.id || player.steamId,
        name,
        steamId: player.steamId || '',
        ping: rcon?.ping || player.ping || 0,
        ip: rcon?.ip || '',
        rconSlot: rcon?.slot ?? null,
        source: 'inhouse',
        loaded: player.loaded !== false,
        position: player.position || null,
        health: player.health || null,
        blood: player.blood || null,
        alive: player.alive !== false,
      };
    });
  } catch (err) {
    logger.warn({ err: err.message, serverId }, 'Sidecar player fetch failed, using cached players');
    return ctx.serverStates[serverId]?.players || [];
  }
}

/**
 * Fetch mod-level server metrics from the sidecar /metrics endpoint.
 * Returns the full metrics object (fps, players, ai_count, etc.) or null on failure.
 */
async function fetchModMetrics(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const baseUrl = srv?.inHouseApiUrl;

  if (!baseUrl) return null;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (srv.inHouseApiKey) headers['Authorization'] = `Bearer ${srv.inHouseApiKey}`;

    const res = await fetch(`${baseUrl}/metrics`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (!json.ok || !json.data) throw new Error('Invalid metrics response');

    return json.data;
  } catch (err) {
    logger.debug({ err: err.message, serverId }, 'Sidecar metrics fetch failed');
    return null;
  }
}

/**
 * Fetch vehicle data from the sidecar /vehicles endpoint.
 * Returns array of vehicle objects or empty array on failure.
 */
async function fetchModVehicles(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const baseUrl = srv?.inHouseApiUrl;

  if (!baseUrl) return [];

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (srv.inHouseApiKey) headers['Authorization'] = `Bearer ${srv.inHouseApiKey}`;

    const res = await fetch(`${baseUrl}/vehicles`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (!json.ok || !Array.isArray(json.data)) throw new Error('Invalid vehicles response');

    return json.data;
  } catch (err) {
    logger.debug({ err: err.message, serverId }, 'Sidecar vehicles fetch failed');
    return [];
  }
}

/**
 * Fetch world events from the sidecar /world-events endpoint.
 * Returns array of event objects or empty array on failure.
 */
async function fetchModWorldEvents(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const baseUrl = srv?.inHouseApiUrl;

  if (!baseUrl) return [];

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (srv.inHouseApiKey) headers['Authorization'] = `Bearer ${srv.inHouseApiKey}`;

    const res = await fetch(`${baseUrl}/world-events`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (!json.ok || !Array.isArray(json.data)) throw new Error('Invalid world-events response');

    return json.data;
  } catch (err) {
    logger.debug({ err: err.message, serverId }, 'Sidecar world-events fetch failed');
    return [];
  }
}

module.exports = { fetchPlayers, fetchModMetrics, fetchModVehicles, fetchModWorldEvents };
