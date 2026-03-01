/**
 * Leaderboard data — InHouse sidecar or RPT scraping fallback.
 * Normalizes to the same format used by ctx.leaderboard.
 * No CFTools dependency.
 */
const logger = require('./logger');
const ctx = require('./context');
const { updateLeaderboard: updateLeaderboardRPT } = require('./rpt-scraper');
const { saveJSON } = require('./data-store');

/**
 * Fetch leaderboard for a specific server.
 * Uses InHouse sidecar if configured, else falls back to RPT scraping.
 */
async function updateLeaderboard(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const baseUrl = srv?.inHouseApiUrl;

  if (!baseUrl) {
    updateLeaderboardRPT(serverId);
    return;
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (srv.inHouseApiKey) headers['Authorization'] = `Bearer ${srv.inHouseApiKey}`;

    const res = await fetch(`${baseUrl}/leaderboard?limit=100`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (!json.ok || !Array.isArray(json.data)) throw new Error('Invalid leaderboard response');

    ctx.leaderboard = json.data.map((item, index) => ({
      player: item.player || 'Unknown',
      steamId: item.steamId || '',
      kills: item.kills || 0,
      deaths: item.deaths || 0,
      score: item.score || Math.max(0, (item.kills || 0) - (item.deaths || 0)),
      kdratio: item.kdratio || 0,
      playtime: item.playtime || 0,
      longestKill: item.longestKill || 0,
      longestShot: item.longestShot || 0,
      suicides: item.suicides || 0,
      hits: item.hits || 0,
      rank: item.rank || index + 1,
      source: 'inhouse',
    }));

    saveJSON(ctx.CONFIG.dataDir, 'leaderboard.json', ctx.leaderboard);
    logger.debug({ serverId, count: json.data.length }, 'Leaderboard updated from sidecar');
  } catch (err) {
    logger.warn({ err: err.message, serverId }, 'Sidecar leaderboard failed, falling back to RPT');
    updateLeaderboardRPT(serverId);
  }
}

module.exports = { updateLeaderboard };
