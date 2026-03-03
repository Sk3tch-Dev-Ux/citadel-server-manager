/**
 * DayZ RPT log file scraping for FPS, kills, and leaderboard data.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const { saveJSON } = require('./data-store');
const { resolveProfileDir, findRPTFiles } = require('./profile-resolver');

/**
 * Extract average FPS from the most recent RPT log file.
 * Reads only the last 4KB for efficiency.
 */
function scrapeRPTForFPS(server) {
  try {
    const files = findRPTFiles(server);
    if (files.length === 0) return 0;
    const rptPath = files[0].fullPath;
    const stat = fs.statSync(rptPath);
    const readSize = Math.min(stat.size, 4096);
    const fd = fs.openSync(rptPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    const tail = buf.toString('utf8');
    const matches = [...tail.matchAll(/Average server FPS:\s*([\d.]+)/gi)];
    if (matches.length > 0) {
      const fps = parseFloat(matches[matches.length - 1][1]);
      return isNaN(fps) ? 0 : fps;
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Extract player kills from the most recent RPT log file.
 * Reads the last 128KB for kill data.
 */
function scrapeRPTForKills(server, limit = 30) {
  try {
    const files = findRPTFiles(server);
    if (files.length === 0) return [];
    const rptPath = files[0].fullPath;
    const stat = fs.statSync(rptPath);
    const readSize = Math.min(stat.size, 128 * 1024);
    const fd = fs.openSync(rptPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    const content = buf.toString('utf8');
    const kills = [];
    const regex = /(\d{2}:\d{2}:\d{2})\s+Player "([^"]+)"[^]*?was killed by (?:player "([^"]+)"|(\S+))/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      kills.push({
        time: match[1],
        victim: match[2],
        killer: match[3] || match[4] || 'Unknown',
        method: match[3] ? 'PvP' : (match[4] || 'Environment'),
      });
    }
    return kills.slice(-limit);
  } catch (err) { return []; }
}

/**
 * Build leaderboard statistics from RPT kill data.
 */
function updateLeaderboard(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return;
  const kills = scrapeRPTForKills(srv, 5000);
  const stats = {};
  for (const k of kills) {
    if (!stats[k.victim]) stats[k.victim] = { player: k.victim, kills: 0, deaths: 0, score: 0 };
    stats[k.victim].deaths++;
    if (k.method === 'PvP' && k.killer !== 'Unknown') {
      if (!stats[k.killer]) stats[k.killer] = { player: k.killer, kills: 0, deaths: 0, score: 0 };
      stats[k.killer].kills++;
    }
  }
  for (const p of Object.values(stats)) p.score = Math.max(0, p.kills - p.deaths);
  ctx.leaderboard = Object.values(stats).sort((a, b) => b.score - a.score);
  saveJSON(ctx.CONFIG.dataDir, 'leaderboard.json', ctx.leaderboard);
}

module.exports = { scrapeRPTForFPS, scrapeRPTForKills, updateLeaderboard };
