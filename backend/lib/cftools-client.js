/**
 * CFTools SDK integration layer.
 * Provides per-server CFTools client instances with lazy initialization.
 * All exports are safe to call when CFTools is not configured — they return null/false.
 */
const logger = require('./logger');
const ctx = require('./context');

let sdk = null;
let sdkLoadAttempted = false;

// Map of serverApiId -> built CFToolsClient instance
const clientCache = new Map();

/**
 * Load the cftools-sdk module. Returns the SDK or null if unavailable.
 */
function loadSdk() {
  if (sdkLoadAttempted) return sdk;
  sdkLoadAttempted = true;
  try {
    sdk = require('cftools-sdk');
    logger.info('cftools-sdk loaded successfully');
  } catch (err) {
    sdk = null;
    logger.debug({ err: err.message }, 'cftools-sdk not available — CFTools features disabled');
  }
  return sdk;
}

/**
 * Check whether CFTools is configured globally (application credentials exist).
 */
function isGloballyConfigured() {
  return !!(ctx.CONFIG?.cftools?.applicationId && ctx.CONFIG?.cftools?.secret);
}

/**
 * Check whether a specific server has CFTools configured.
 */
function isConfiguredForServer(serverId) {
  if (!isGloballyConfigured()) return false;
  const srv = ctx.servers.find(s => s.id === serverId);
  return !!(srv?.cftoolsServerApiId);
}

/**
 * Get or create a CFToolsClient for a specific server.
 * Returns null if CFTools is not configured for this server or SDK unavailable.
 */
function getClient(serverId) {
  if (!isConfiguredForServer(serverId)) return null;
  const cfSdk = loadSdk();
  if (!cfSdk) return null;

  const srv = ctx.servers.find(s => s.id === serverId);
  const serverApiId = srv.cftoolsServerApiId;

  if (clientCache.has(serverApiId)) return clientCache.get(serverApiId);

  try {
    const client = new cfSdk.CFToolsClientBuilder()
      .withServerApiId(serverApiId)
      .withCredentials(ctx.CONFIG.cftools.applicationId, ctx.CONFIG.cftools.secret)
      .withCache()
      .build();

    clientCache.set(serverApiId, client);
    logger.info({ serverId, serverApiId }, 'CFTools client initialized');
    return client;
  } catch (err) {
    logger.error({ err: err.message, serverId }, 'Failed to build CFTools client');
    return null;
  }
}

/**
 * Invalidate a cached client for a server (call when config changes).
 */
function invalidateClient(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (srv?.cftoolsServerApiId) {
    clientCache.delete(srv.cftoolsServerApiId);
  }
}

/**
 * Get SDK type constructors for routes that need them (SteamId64, Banlist, etc.).
 * Returns null if SDK unavailable.
 */
function getSdkTypes() {
  const cfSdk = loadSdk();
  if (!cfSdk) return null;
  return {
    SteamId64: cfSdk.SteamId64,
    ServerApiId: cfSdk.ServerApiId,
    Statistic: cfSdk.Statistic,
    Banlist: cfSdk.Banlist,
    CFToolsId: cfSdk.CFToolsId,
    Game: cfSdk.Game,
  };
}

module.exports = {
  isGloballyConfigured,
  isConfiguredForServer,
  getClient,
  invalidateClient,
  getSdkTypes,
  loadSdk,
};
