/**
 * DSC Sidecar — Configuration
 *
 * Reads from environment variables with sensible defaults.
 * The sidecar runs on the SAME machine as the DayZ server.
 */
const path = require('path');
const fs = require('fs');

const CONFIG = {
  // HTTP server
  port: parseInt(process.env.SIDECAR_PORT || '9100'),
  apiKey: process.env.SIDECAR_API_KEY || '',

  // DayZ server paths (auto-detected or configured)
  dayzDir: process.env.DAYZ_INSTALL_DIR || 'C:\\DayZServer',
  profileDir: process.env.DAYZ_PROFILE_DIR || '',

  // Command queue directory — shared between sidecar and DayZ mod
  // The mod reads from this directory; the sidecar writes to it.
  queueDir: process.env.SIDECAR_QUEUE_DIR || '',

  // Response directory — the mod writes results here; sidecar reads them.
  responseDir: process.env.SIDECAR_RESPONSE_DIR || '',

  // Timeouts
  commandTimeoutMs: parseInt(process.env.COMMAND_TIMEOUT_MS || '10000'),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '100'),

  // Player data — the mod writes player session data to this file
  playerDataFile: '',

  // Ban storage
  banFile: '',
};

// Derive paths from dayzDir if not explicitly set
const profileBase = CONFIG.profileDir || path.join(CONFIG.dayzDir, 'profiles');
const dscDataDir = path.join(profileBase, 'DSC');

if (!CONFIG.queueDir) CONFIG.queueDir = path.join(dscDataDir, 'commands');
if (!CONFIG.responseDir) CONFIG.responseDir = path.join(dscDataDir, 'responses');
CONFIG.playerDataFile = path.join(dscDataDir, 'players.json');
CONFIG.banFile = path.join(dscDataDir, 'bans.json');
CONFIG.leaderboardFile = path.join(dscDataDir, 'leaderboard.json');

// Ensure directories exist
for (const dir of [CONFIG.queueDir, CONFIG.responseDir, dscDataDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = CONFIG;
