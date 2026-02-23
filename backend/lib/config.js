/**
 * Application configuration from environment variables.
 * Fails fast on missing required values.
 */
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

if (!process.env.JWT_SECRET) {
  logger.fatal('JWT_SECRET environment variable is required. Set it in .env');
  process.exit(1);
}

const CONFIG = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET,
  dataDir: path.join(__dirname, '..', '..', 'data'),
  dayz: {
    ip: process.env.DAYZ_SERVER_IP || '127.0.0.1',
    rconPort: parseInt(process.env.DAYZ_RCON_PORT || '2305'),
    rconPassword: process.env.RCON_PASSWORD || '',
    installDir: process.env.DAYZ_INSTALL_DIR || 'C:\\DayZServer',
    profileDir: process.env.DAYZ_PROFILE_DIR || '',
    executable: process.env.DAYZ_EXECUTABLE || 'DayZServer_x64.exe',
    startBat: process.env.DAYZ_START_BAT || '',
    launchParams: process.env.DAYZ_LAUNCH_PARAMS || '-config=serverDZ.cfg -port=2302 -dologs -adminlog -netlog -freezecheck',
  },
  webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  steam: {
    cmdPath: process.env.STEAMCMD_PATH || '',
    username: process.env.STEAM_USERNAME || '',
    password: process.env.STEAM_PASSWORD || '',
    appId: '221100',
    serverAppId: '223350',
  },
};

// Parse allowed CORS origins from env (comma-separated) or default to localhost
CONFIG.allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : [`http://localhost:${CONFIG.port}`, 'http://localhost:3001', 'http://127.0.0.1:3001'];

// Ensure data directory exists
if (!fs.existsSync(CONFIG.dataDir)) fs.mkdirSync(CONFIG.dataDir, { recursive: true });

module.exports = CONFIG;
