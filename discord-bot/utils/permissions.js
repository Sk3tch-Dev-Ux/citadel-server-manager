/**
 * Discord permission checks.
 */
const CONFIG = require('../config');

/** Check if interaction user has the admin role */
function isAdmin(interaction) {
  if (!CONFIG.adminRoleId) {
    console.warn('[security] DISCORD_ADMIN_ROLE_ID not configured — all admin actions denied');
    return false;
  }
  return interaction.member.roles.cache.has(CONFIG.adminRoleId);
}

module.exports = { isAdmin };
