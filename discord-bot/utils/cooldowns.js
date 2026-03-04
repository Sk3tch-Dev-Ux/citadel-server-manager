/**
 * Per-user, per-action cooldown system.
 */

/** Cooldown durations in ms per tier */
const COOLDOWN_TIERS = {
  query: 3_000,     // status, players, mods, intel feeds
  admin: 10_000,    // heal, kill, teleport, kick, rcon, broadcast
  control: 30_000,  // start, stop, restart
};

/** Action → tier mapping */
const ACTION_TIERS = {
  // Query
  panel_status: 'query', panel_players: 'query', panel_mod_list: 'query',
  panel_mod_status: 'query', panel_chat_feed: 'query', panel_killfeed: 'query',
  panel_watch_list: 'query', panel_priority_queue: 'query', panel_time_weather: 'query',
  panel_leaderboard: 'query', panel_ban_whitelist: 'query', panel_player_info: 'query',
  status: 'query', players: 'query', playerinfo: 'query',
  // Admin
  panel_lock: 'admin', panel_unlock: 'admin', panel_message: 'admin',
  panel_rcon: 'admin', panel_kick_menu: 'admin',
  panel_gl_heal: 'admin', panel_gl_kill: 'admin', panel_gl_teleport: 'admin', panel_gl_spawn: 'admin',
  panel_mod_install: 'admin', panel_mod_uninstall: 'admin', panel_mod_enable: 'admin', panel_mod_disable: 'admin',
  heal: 'admin', kill: 'admin', teleport: 'admin', spawnitem: 'admin',
  rcon: 'admin', broadcast: 'admin',
  // Control
  confirm_start: 'control', confirm_stop: 'control',
  restart_now: 'control', restart_60: 'control', restart_300: 'control',
  restart: 'control',
};

/** Map<"userId:action", expiresAt> */
const cooldowns = new Map();

/**
 * Check if a user is on cooldown for an action.
 * @returns {number} Seconds remaining, or 0 if no cooldown
 */
function checkCooldown(userId, action) {
  const key = `${userId}:${action}`;
  const expires = cooldowns.get(key);
  if (expires && Date.now() < expires) {
    return Math.ceil((expires - Date.now()) / 1000);
  }
  return 0;
}

/**
 * Set a cooldown for a user+action.
 * @param {string} userId
 * @param {string} action
 * @param {string} [tierOverride] - Force a specific tier
 */
function setCooldown(userId, action, tierOverride) {
  const tier = tierOverride || ACTION_TIERS[action] || 'query';
  const duration = COOLDOWN_TIERS[tier] || COOLDOWN_TIERS.query;
  const key = `${userId}:${action}`;
  const expires = Date.now() + duration;
  cooldowns.set(key, expires);
  setTimeout(() => {
    if (cooldowns.get(key) === expires) cooldowns.delete(key);
  }, duration + 1000);
}

module.exports = { checkCooldown, setCooldown, COOLDOWN_TIERS, ACTION_TIERS };
