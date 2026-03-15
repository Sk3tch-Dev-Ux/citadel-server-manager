/**
 * Bot configuration from environment variables.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const CONFIG = {
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID,
  apiUrl: process.env.PANEL_API_URL || 'http://localhost:3001',
  apiKey: process.env.DISCORD_BOT_API_KEY || (() => {
    console.error('FATAL: DISCORD_BOT_API_KEY environment variable is required. Set it in .env');
    process.exit(1);
  })(),
};

module.exports = CONFIG;
