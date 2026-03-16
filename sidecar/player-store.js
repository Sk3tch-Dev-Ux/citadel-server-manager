/**
 * Citadel Sidecar — Player Data Store
 *
 * Reads the player session data written by the DayZ mod.
 * The mod updates players.json on an interval with live positions,
 * health, inventory summary, etc.
 *
 * Also maintains a player statistics database (kills, deaths, playtime)
 * for tracking player stats locally.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

const statsFile = path.join(path.dirname(config.playerDataFile), 'player-stats.json');

// In-memory caches
let activePlayers = [];
let playerStats = {};

/**
 * Read current player sessions from the mod-written file.
 * Called on an interval by the sidecar.
 */
function refreshPlayers() {
  try {
    if (!fs.existsSync(config.playerDataFile)) return [];
    const raw = fs.readFileSync(config.playerDataFile, 'utf-8');
    activePlayers = JSON.parse(raw);
    return activePlayers;
  } catch (err) {
    logger.debug({ err: err.message }, 'Failed to read player data');
    return activePlayers;
  }
}

/**
 * Get current active players (from cache).
 */
function getPlayers() {
  return activePlayers;
}

/**
 * Find a player by steamId in active sessions.
 */
function findPlayer(steamId) {
  return activePlayers.find(p =>
    p.steamId === steamId || p.steam64 === steamId
  ) || null;
}

// ─── Player Statistics (persistent) ─────────────────────

function loadStats() {
  try {
    if (fs.existsSync(statsFile)) {
      playerStats = JSON.parse(fs.readFileSync(statsFile, 'utf-8'));
      logger.info({ players: Object.keys(playerStats).length }, 'Player stats loaded');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to load player stats');
    playerStats = {};
  }
}

function saveStats() {
  try {
    const tmpFile = statsFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(playerStats, null, 2));
    fs.renameSync(tmpFile, statsFile);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to save player stats');
  }
}

/**
 * Record a player event (kill, death, connection, etc.)
 * Called when the mod reports events or the sidecar detects changes.
 */
function recordEvent(steamId, event) {
  if (!playerStats[steamId]) {
    playerStats[steamId] = {
      steamId,
      names: [],
      kills: 0,
      deaths: 0,
      suicides: 0,
      hits: 0,
      longestKill: 0,
      playtimeSeconds: 0,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      sessions: 0,
    };
  }

  const stat = playerStats[steamId];
  stat.lastSeen = new Date().toISOString();

  switch (event.type) {
    case 'kill':
      stat.kills++;
      if (event.distance && event.distance > stat.longestKill) {
        stat.longestKill = event.distance;
      }
      break;
    case 'death':
      stat.deaths++;
      break;
    case 'suicide':
      stat.suicides++;
      stat.deaths++;
      break;
    case 'hit':
      stat.hits++;
      break;
    case 'connect':
      stat.sessions++;
      if (event.name && !stat.names.includes(event.name)) {
        stat.names.push(event.name);
      }
      break;
    case 'playtime':
      stat.playtimeSeconds += event.seconds || 0;
      break;
  }
}

function getPlayerStats(steamId) {
  return playerStats[steamId] || null;
}

function getLeaderboard(limit = 100) {
  return Object.values(playerStats)
    .map(s => ({
      player: s.names[s.names.length - 1] || s.steamId,
      steamId: s.steamId,
      kills: s.kills,
      deaths: s.deaths,
      score: Math.max(0, s.kills - s.deaths),
      kdratio: s.deaths > 0 ? +(s.kills / s.deaths).toFixed(2) : s.kills,
      playtime: s.playtimeSeconds,
      longestKill: s.longestKill,
      suicides: s.suicides,
      hits: s.hits,
      source: 'inhouse',
    }))
    .sort((a, b) => b.kills - a.kills)
    .slice(0, limit)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/**
 * Process kill events from the DayZ mod's kill feed file.
 * The mod writes kills to Citadel/events.jsonl (newline-delimited JSON).
 *
 * Uses rename-before-read to prevent a race condition where the mod
 * writes new events between our read and truncate, causing data loss.
 */
function processEventLog() {
  const eventFile = path.join(path.dirname(config.playerDataFile), 'events.jsonl');
  const processingFile = eventFile + '.processing';

  if (!fs.existsSync(eventFile)) return;

  try {
    // Atomically rename the file so the mod starts writing to a fresh events.jsonl.
    // This prevents losing events written between our read and truncate.
    fs.renameSync(eventFile, processingFile);
  } catch (err) {
    // Rename can fail if the mod is actively writing — skip this cycle
    logger.debug({ err: err.message }, 'Could not rename event log, will retry next cycle');
    return;
  }

  try {
    const raw = fs.readFileSync(processingFile, 'utf-8').trim();
    if (!raw) {
      fs.unlinkSync(processingFile);
      return;
    }

    const lines = raw.split('\n');
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.steamId) recordEvent(event.steamId, event);
        // Record victim deaths
        if (event.type === 'kill' && event.victimSteamId) {
          recordEvent(event.victimSteamId, { type: 'death' });
        }
      } catch { /* skip malformed lines */ }
    }

    // Delete the processing file now that we've consumed all events
    fs.unlinkSync(processingFile);
    saveStats();
  } catch (err) {
    logger.debug({ err: err.message }, 'Failed to process event log');
    // Try to clean up the processing file if it still exists
    try { fs.unlinkSync(processingFile); } catch { /* ignore */ }
  }
}

// Load on require
loadStats();

module.exports = {
  refreshPlayers,
  getPlayers,
  findPlayer,
  recordEvent,
  getPlayerStats,
  getLeaderboard,
  processEventLog,
  saveStats,
};
