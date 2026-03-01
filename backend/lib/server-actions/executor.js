/**
 * Server Actions Executor — public API for all admin actions.
 *
 * Routes call this module instead of touching cftools-client directly.
 * The executor resolves the best available provider for each server/action
 * combination and delegates the call.
 *
 * Usage:
 *   const { getProviderForAction, findSession, getCapabilities } = require('./server-actions/executor');
 *   const provider = getProviderForAction(serverId, ActionType.HEAL_PLAYER);
 *   await provider.healPlayer(serverId, session);
 */
const ctx = require('../context');
const CFToolsProvider = require('./providers/cftools');
const RCONProvider = require('./providers/rcon');
const { ActionType, ACTION_LABELS } = require('./types');

// ─── Provider Singletons ────────────────────────────────
const cftoolsProvider = new CFToolsProvider();
const rconProvider = new RCONProvider();

// Provider resolution order — highest-capability first
const PROVIDERS = [cftoolsProvider, rconProvider];

/**
 * Get the best provider that supports a given action for a given server.
 * Throws a descriptive error if no provider can handle it.
 *
 * @param {string} serverId
 * @param {string} actionType - An ActionType constant
 * @returns {BaseProvider}
 */
function getProviderForAction(serverId, actionType) {
  for (const provider of PROVIDERS) {
    if (provider.getCapabilities().has(actionType) && provider.isAvailable(serverId)) {
      return provider;
    }
  }

  const label = ACTION_LABELS[actionType] || actionType;
  throw new Error(`No provider available for "${label}". Ensure CFTools is configured or RCON is connected.`);
}

/**
 * Find the active game session for a player by steamId.
 * Used by routes before calling player actions.
 *
 * @param {string} serverId
 * @param {string} steamId
 * @returns {object|null} The session object or null
 */
function findSession(serverId, steamId) {
  const state = ctx.serverStates[serverId];
  const sessions = state?.cftools?.gameSessions || [];
  return sessions.find(s => s.steamId?.id === steamId) || null;
}

/**
 * Get the capabilities available for a server (for the frontend).
 *
 * @param {string} serverId
 * @returns {{ provider: string, actions: string[] }}
 */
function getCapabilities(serverId) {
  for (const provider of PROVIDERS) {
    if (provider.isAvailable(serverId)) {
      const caps = provider.getCapabilities();
      return {
        provider: provider.name,
        actions: Array.from(caps),
      };
    }
  }
  return { provider: 'none', actions: [] };
}

/**
 * Check if any provider supports a specific action for a server.
 *
 * @param {string} serverId
 * @param {string} actionType
 * @returns {boolean}
 */
function isActionAvailable(serverId, actionType) {
  try {
    getProviderForAction(serverId, actionType);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getProviderForAction,
  findSession,
  getCapabilities,
  isActionAvailable,
  // Re-export types for convenience
  ActionType,
};
