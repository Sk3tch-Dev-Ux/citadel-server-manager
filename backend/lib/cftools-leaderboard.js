/**
 * Leaderboard data — CFTools or RPT scraping fallback.
 * Normalizes to the same format used by ctx.leaderboard.
 */
const logger = require('./logger');
const ctx = require('./context');
const { getClient, isConfiguredForServer, getSdkTypes } = require('./cftools-client');
const { updateLeaderboard: updateLeaderboardRPT } = require('./rpt-scraper');
const { saveJSON } = require('./data-store');

/**
 * Fetch leaderboard for a specific server.
 * Uses CFTools getLeaderboard() if configured, else falls back to RPT scraping.
 */
async function updateLeaderboard(serverId) {
  if (!isConfiguredForServer(serverId)) {
    updateLeaderboardRPT(serverId);
    return;
  }

  try {
    const client = getClient(serverId);
    const sdk = getSdkTypes();
    if (!client || !sdk) {
      updateLeaderboardRPT(serverId);
      return;
    }

    const items = await client.getLeaderboard({
      statistic: sdk.Statistic.KILLS,
      order: 'DESC',
      limit: 100,
    });

    ctx.leaderboard = items.map((item, index) => ({
      player: item.name,
      kills: item.kills || 0,
      deaths: item.deaths || 0,
      score: Math.max(0, (item.kills || 0) - (item.deaths || 0)),
      kdratio: item.killDeathRatio || 0,
      playtime: item.playtime || 0,
      longestKill: item.longestKill || 0,
      longestShot: item.longestShot || 0,
      suicides: item.suicides || 0,
      hits: item.hits || 0,
      rank: item.rank || index + 1,
      source: 'cftools',
    }));

    saveJSON(ctx.CONFIG.dataDir, 'leaderboard.json', ctx.leaderboard);
    logger.debug({ serverId, count: items.length }, 'Leaderboard updated from CFTools');
  } catch (err) {
    logger.warn({ err: err.message, serverId }, 'CFTools leaderboard failed, falling back to RPT');
    updateLeaderboardRPT(serverId);
  }
}

module.exports = { updateLeaderboard };
