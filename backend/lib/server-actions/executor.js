/**
 * Server Actions Executor — public API for all admin actions.
 *
 * Routes call this module to execute player/world actions.
 * The executor resolves the best available provider for each server/action
 * combination and delegates the call.
 *
 * Usage:
 *   const { getProviderForAction, findSession, getCapabilities } = require('./server-actions/executor');
 *   const provider = getProviderForAction(serverId, ActionType.HEAL_PLAYER);
 *   await provider.healPlayer(serverId, session);
 */
const ctx = require('../context');
const logger = require('../logger');
const InHouseProvider = require('./providers/inhouse');
const RCONProvider = require('./providers/rcon');
const { ActionType, ACTION_LABELS } = require('./types');

// Legacy SDK provider — only available if optional SDK package is installed
let LegacySDKProvider;
try {
  LegacySDKProvider = require('./providers/legacy-sdk');
} catch {
  LegacySDKProvider = null;
}

// ─── Provider Singletons ────────────────────────────────
const inHouseProvider = new InHouseProvider();
const legacySdkProvider = LegacySDKProvider ? new LegacySDKProvider() : null;
const rconProvider = new RCONProvider();

// Provider resolution order — highest-capability first.
// InHouse is the preferred provider.
const PROVIDERS = [inHouseProvider, legacySdkProvider, rconProvider].filter(Boolean);

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

  // FRAG-5: before failing, capture WHY each provider was skipped — was it
  // unavailable for this server (not configured / offline) or available but
  // lacking this action? This turns an opaque "No provider available" into an
  // actionable diagnostic (e.g. "RCON is up but can't spawn items").
  const diagnostics = PROVIDERS.map((provider) => {
    let available = false;
    let supportsAction = false;
    try { available = provider.isAvailable(serverId); } catch { /* treat as unavailable */ }
    try { supportsAction = provider.getCapabilities().has(actionType); } catch { /* treat as unsupported */ }
    return { name: provider.name, available, supportsAction };
  });
  logger.warn({ serverId, action: actionType, label, providers: diagnostics }, 'No provider available for action');

  const err = new Error(`No provider available for "${label}". Ensure InHouse API or RCON is configured.`);
  err.code = 'NO_PROVIDER';
  throw err;
}

/**
 * Find the active game session for a player by steamId.
 * Used by routes before calling player actions.
 *
 * Checks multiple sources:
 *   1. InHouse player list (from sidecar polling)
 *   2. Legacy SDK game sessions
 *   3. RCON player list (fallback — returns a synthetic session)
 *
 * @param {string} serverId
 * @param {string} steamId
 * @returns {object|null} The session object or null
 */
function findSession(serverId, steamId) {
  const state = ctx.serverStates[serverId];

  // 1. InHouse sessions (if sidecar populates them)
  const inhouseSessions = state?.inhouse?.sessions || [];
  const inhouseHit = inhouseSessions.find(s =>
    s.steamId === steamId || s.steamId?.id === steamId
  );
  if (inhouseHit) return inhouseHit;

  // 2. Legacy SDK game sessions
  const legacySessions = state?.cftools?.gameSessions || [];
  const legacyHit = legacySessions.find(s => s.steamId?.id === steamId);
  if (legacyHit) return legacyHit;

  // 3. RCON player list — synthesise a minimal session so the InHouse
  //    provider (which only needs a steamId) can still work.
  const rconPlayers = state?.players || [];
  const rconHit = rconPlayers.find(p =>
    p.steamId === steamId || p.steam64 === steamId
  );
  if (rconHit) return { steamId, name: rconHit.name || 'Unknown' };

  return null;
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
