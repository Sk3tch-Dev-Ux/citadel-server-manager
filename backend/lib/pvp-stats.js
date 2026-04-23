/**
 * PvP stats store — persistent leaderboard per server.
 *
 * Lifecycle:
 *   - Kill/death events from the in-game mod are fed into `recordKill/recordDeath`.
 *   - Aggregated stats are persisted to `data/pvp-stats-{serverId}.json`.
 *   - Writes are debounced (500ms) to avoid thrashing the disk on kill bursts.
 *   - `reset(serverId)` wipes the server's leaderboard (called by Dangerzone
 *     on wipe actions; also exposed via admin API).
 *
 * Stats tracked per (server, steamId):
 *   - kills, deaths, headshots
 *   - longestKill { distance, weapon, victim, timestamp }
 *   - weapons used (weapon → kill count)
 *   - firstSeenThisWipe, lastKillAt, lastDeathAt
 *   - name (latest seen, in case a player renames)
 *
 * All "per wipe" — reset() clears the file and starts over with a new wipeId.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const WRITE_DEBOUNCE_MS = 500;

/** @type {Map<string, { path: string, state: object, dirty: boolean, timer: NodeJS.Timeout | null }>} */
const _stores = new Map();

function _storePath(dataDir, serverId) {
  return path.join(dataDir, `pvp-stats-${serverId}.json`);
}

function _emptyState() {
  return {
    wipeId: crypto.randomBytes(6).toString('hex'),
    lastReset: new Date().toISOString(),
    players: {},
  };
}

function _loadStore(dataDir, serverId) {
  const key = serverId;
  const existing = _stores.get(key);
  if (existing) return existing;

  const filePath = _storePath(dataDir, serverId);
  let state = _emptyState();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.players) {
        state = parsed;
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, serverId }, 'pvp-stats: failed to load — starting fresh');
  }

  const store = { path: filePath, state, dirty: false, timer: null };
  _stores.set(key, store);
  return store;
}

function _scheduleWrite(store) {
  store.dirty = true;
  if (store.timer) return;
  store.timer = setTimeout(() => {
    store.timer = null;
    if (!store.dirty) return;
    store.dirty = false;
    try {
      fs.mkdirSync(path.dirname(store.path), { recursive: true });
      fs.writeFileSync(store.path, JSON.stringify(store.state, null, 2), 'utf-8');
    } catch (err) {
      logger.error({ err: err.message, path: store.path }, 'pvp-stats: failed to write');
    }
  }, WRITE_DEBOUNCE_MS);
}

/** Lazily create a per-player record. */
function _player(state, steamId, name) {
  if (!state.players[steamId]) {
    state.players[steamId] = {
      steamId,
      name: name || 'Unknown',
      kills: 0,
      deaths: 0,
      headshots: 0,
      longestKill: null,
      weapons: {},
      firstSeenThisWipe: new Date().toISOString(),
      lastKillAt: null,
      lastDeathAt: null,
    };
  } else if (name && state.players[steamId].name !== name) {
    state.players[steamId].name = name;
  }
  return state.players[steamId];
}

/**
 * Record a kill. Event shape matches what the in-game mod emits:
 *   { type:'kill', steamId, name, victimSteamId, victimName, distance, weapon, zone, timestamp, killerPos, victimPos }
 */
function recordKill(dataDir, serverId, event) {
  if (!event || !event.steamId || !event.victimSteamId) return;
  // Self-kills (suicides) don't count in the leaderboard
  if (event.steamId === event.victimSteamId) return;

  const store = _loadStore(dataDir, serverId);
  const killer = _player(store.state, event.steamId, event.name);
  const victim = _player(store.state, event.victimSteamId, event.victimName);

  killer.kills += 1;
  killer.lastKillAt = event.timestamp || new Date().toISOString();

  const headshot = (event.zone || '').toLowerCase() === 'head';
  if (headshot) killer.headshots += 1;

  if (event.weapon) {
    killer.weapons[event.weapon] = (killer.weapons[event.weapon] || 0) + 1;
  }

  const distance = Number(event.distance) || 0;
  if (!killer.longestKill || distance > killer.longestKill.distance) {
    killer.longestKill = {
      distance,
      weapon: event.weapon || null,
      victim: event.victimName || event.victimSteamId,
      timestamp: event.timestamp || new Date().toISOString(),
    };
  }

  victim.deaths += 1;
  victim.lastDeathAt = event.timestamp || new Date().toISOString();

  _scheduleWrite(store);
}

/**
 * Record a non-PvP death (suicide, fall, zombie, etc.). Still bumps deaths
 * on the victim — K/D ratios reflect all deaths, not just PvP deaths.
 */
function recordDeath(dataDir, serverId, event) {
  if (!event || !event.steamId) return;
  const store = _loadStore(dataDir, serverId);
  const victim = _player(store.state, event.steamId, event.name);
  victim.deaths += 1;
  victim.lastDeathAt = event.timestamp || new Date().toISOString();
  _scheduleWrite(store);
}

/**
 * Sorted leaderboard.  `sortBy` ∈ 'kills'|'headshots'|'longestKill'|'kd'.
 */
function getLeaderboard(dataDir, serverId, { limit = 50, sortBy = 'kills' } = {}) {
  const store = _loadStore(dataDir, serverId);
  const entries = Object.values(store.state.players).map((p) => ({
    ...p,
    kd: p.deaths > 0 ? p.kills / p.deaths : p.kills,
    headshotPct: p.kills > 0 ? p.headshots / p.kills : 0,
  }));
  const sorters = {
    kills: (a, b) => b.kills - a.kills,
    headshots: (a, b) => b.headshots - a.headshots,
    longestKill: (a, b) => (b.longestKill?.distance || 0) - (a.longestKill?.distance || 0),
    kd: (a, b) => b.kd - a.kd,
  };
  entries.sort(sorters[sortBy] || sorters.kills);
  return {
    wipeId: store.state.wipeId,
    lastReset: store.state.lastReset,
    total: entries.length,
    entries: entries.slice(0, limit),
  };
}

/**
 * Aggregate stats across the whole server for the current wipe.
 */
function getServerStats(dataDir, serverId) {
  const store = _loadStore(dataDir, serverId);
  const players = Object.values(store.state.players);
  let totalKills = 0, totalHeadshots = 0, totalDeaths = 0;
  let longestKill = null;
  const weaponTotals = {};

  for (const p of players) {
    totalKills += p.kills;
    totalHeadshots += p.headshots;
    totalDeaths += p.deaths;
    if (p.longestKill && (!longestKill || p.longestKill.distance > longestKill.distance)) {
      longestKill = { ...p.longestKill, killer: p.name, killerSteamId: p.steamId };
    }
    for (const [w, n] of Object.entries(p.weapons)) {
      weaponTotals[w] = (weaponTotals[w] || 0) + n;
    }
  }

  const topWeapons = Object.entries(weaponTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([weapon, count]) => ({ weapon, count }));

  return {
    wipeId: store.state.wipeId,
    lastReset: store.state.lastReset,
    playerCount: players.length,
    totalKills,
    totalDeaths,
    totalHeadshots,
    headshotPct: totalKills > 0 ? totalHeadshots / totalKills : 0,
    longestKill,
    topWeapons,
  };
}

function getPlayerStats(dataDir, serverId, steamId) {
  const store = _loadStore(dataDir, serverId);
  const p = store.state.players[steamId];
  if (!p) return null;
  const weaponsTop = Object.entries(p.weapons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([weapon, count]) => ({ weapon, count }));
  return {
    ...p,
    kd: p.deaths > 0 ? p.kills / p.deaths : p.kills,
    headshotPct: p.kills > 0 ? p.headshots / p.kills : 0,
    weaponsTop,
  };
}

/**
 * Reset the leaderboard. Called by Dangerzone on wipe or by admin action.
 * Writes synchronously so callers can confirm completion.
 */
function reset(dataDir, serverId) {
  const store = _loadStore(dataDir, serverId);
  if (store.timer) { clearTimeout(store.timer); store.timer = null; }
  store.state = _emptyState();
  store.dirty = false;
  try {
    fs.mkdirSync(path.dirname(store.path), { recursive: true });
    fs.writeFileSync(store.path, JSON.stringify(store.state, null, 2), 'utf-8');
  } catch (err) {
    logger.error({ err: err.message, serverId }, 'pvp-stats: reset failed');
    throw err;
  }
  logger.info({ serverId, wipeId: store.state.wipeId }, 'pvp-stats: leaderboard reset');
  return { wipeId: store.state.wipeId, lastReset: store.state.lastReset };
}

/** Remove cached store (used for tests). */
function _clearCache() {
  for (const store of _stores.values()) {
    if (store.timer) clearTimeout(store.timer);
  }
  _stores.clear();
}

module.exports = {
  recordKill,
  recordDeath,
  getLeaderboard,
  getServerStats,
  getPlayerStats,
  reset,
  _clearCache,
};
