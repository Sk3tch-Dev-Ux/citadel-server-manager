/**
 * Discord permission checks.
 */
const CONFIG = require('../config');
const logger = require('../lib/logger');

/** Check if interaction user has the admin role */
function isAdmin(interaction) {
  if (!CONFIG.adminRoleId) {
    logger.warn('DISCORD_ADMIN_ROLE_ID not configured — all admin actions denied');
    return false;
  }
  return interaction.member.roles.cache.has(CONFIG.adminRoleId);
}

module.exports = { isAdmin };
