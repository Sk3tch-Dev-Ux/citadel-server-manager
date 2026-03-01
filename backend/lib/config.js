/**
 * Application configuration from environment variables.
 * Auto-generates missing secrets for seamless first-run experience.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('./logger');

// Auto-generate JWT_SECRET if missing (first run without setup script)
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  logger.warn('JWT_SECRET was not set — generated a temporary secret. Run "npm run setup" or complete the Setup Wizard to persist it.');
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
  cftools: {
    // DEPRECATED — CFTools is no longer required. Configure InHouse sidecar
    // per-server via inHouseApiUrl/inHouseApiKey in servers.json instead.
    // These are retained for backward compatibility during migration.
    applicationId: process.env.CFTOOLS_APPLICATION_ID || '',
    secret: process.env.CFTOOLS_SECRET || '',
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
