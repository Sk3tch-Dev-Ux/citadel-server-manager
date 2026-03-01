/**
 * Citadel License Validation System
 *
 * License keys are RSA-signed JWTs containing tier, server limits, and feature flags.
 * Only the public key ships with the product — the private key is held by the vendor
 * to generate new license keys via tools/generate-license.js.
 *
 * Tiers:
 *   community    — Free, 1 server, basic features, Citadel watermark
 *   standard     — Up to 3 servers, most features
 *   professional — Up to 10 servers, all features including Discord bot
 *   enterprise   — Unlimited servers, white-label, everything
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ─── RSA Public Key (used to verify license signatures) ──────────
// The corresponding private key is in tools/license-private.pem (NEVER ship this)
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAp82bd+QOzARJ1BinD2f9
q7+9LezIXHmkMKBDMRvueNJ38J8djPOSU1w9oeIVS4XJHbj4LZ3ECV92+Bw35kGh
UTy9YjNMXcwfdNJmCgUgezqOvxstBcSiJe5IMSE7vGq9qhsJk4GuT+2giA9lXCii
K+PyHk12JIDmtTWecX/VajfuZ8KLwx5bbWyQjOVvhNtnpYvLpW+hwOhY743oEr22
OaPzEti64f6yOFGLuW3gMyXOk2LzEVfH9/VGqWUQEKAk/u2qhae9/tUrnNMYzaRJ
D2smJX4CWutpCPohja/KuNK4trE9KNdj+CcH2wt+WHCCBMasNERbK1y9QjT26g6Q
1wIDAQAB
-----END PUBLIC KEY-----`;

// ─── Tier Definitions ────────────────────────────────────────────
const TIERS = {
  community: {
    label: 'Community',
    maxServers: 1,
    features: ['server.view', 'server.control', 'players', 'rcon', 'logs', 'metrics', 'mods.view', 'config'],
    watermark: true,
  },
  standard: {
    label: 'Standard',
    maxServers: 3,
    features: ['server.view', 'server.control', 'players', 'rcon', 'logs', 'metrics', 'mods', 'config', 'file_manager', 'scheduler', 'messenger', 'backups', 'bans', 'live_map', 'leaderboard', 'killfeed'],
    watermark: false,
  },
  professional: {
    label: 'Professional',
    maxServers: 10,
    features: ['server.view', 'server.control', 'players', 'rcon', 'logs', 'metrics', 'mods', 'config', 'file_manager', 'scheduler', 'messenger', 'backups', 'bans', 'live_map', 'leaderboard', 'killfeed', 'deploy', 'discord_bot', 'webhooks', 'priority_queue', 'watchlist'],
    watermark: false,
  },
  enterprise: {
    label: 'Enterprise',
    maxServers: Infinity,
    features: ['*'],  // All features
    watermark: false,
  },
};

// ─── License State ───────────────────────────────────────────────
let _license = {
  valid: false,
  tier: 'community',
  maxServers: 1,
  licensee: null,
  email: null,
  expiresAt: null,
  features: TIERS.community.features,
  watermark: true,
  key: null,
};

/**
 * Validate and decode a license key (RSA-signed JWT).
 * @param {string} key - The license key JWT string
 * @returns {{ valid: boolean, decoded?: object, error?: string }}
 */
function validateKey(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'No license key provided' };
  }

  try {
    const decoded = jwt.verify(key.trim(), LICENSE_PUBLIC_KEY, {
      algorithms: ['RS256'],
      issuer: 'citadel-license',
    });

    // Validate required fields
    if (!decoded.tier || !TIERS[decoded.tier]) {
      return { valid: false, error: `Unknown tier: ${decoded.tier}` };
    }

    return { valid: true, decoded };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, error: 'License key has expired' };
    }
    if (err.name === 'JsonWebTokenError') {
      return { valid: false, error: 'Invalid license key signature' };
    }
    return { valid: false, error: err.message };
  }
}

/**
 * Load and activate the license from environment or cached file.
 * Called once at startup.
 */
function activateLicense(dataDir) {
  const key = process.env.CITADEL_LICENSE_KEY;
  const cacheFile = path.join(dataDir, 'license.json');

  // Try env key first
  if (key) {
    const result = validateKey(key);
    if (result.valid) {
      applyLicense(result.decoded, key);
      // Cache valid license
      try {
        fs.writeFileSync(cacheFile, JSON.stringify({
          key,
          activatedAt: new Date().toISOString(),
          tier: result.decoded.tier,
        }));
      } catch { /* non-critical */ }
      return _license;
    }
    logger.warn({ error: result.error }, 'License key validation failed — falling back to Community tier');
  }

  // Try cached license (for when key is removed from env but was previously activated)
  if (!key && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached.key) {
        const result = validateKey(cached.key);
        if (result.valid) {
          applyLicense(result.decoded, cached.key);
          return _license;
        }
        logger.warn({ error: result.error }, 'Cached license invalid — falling back to Community tier');
      }
    } catch { /* corrupted cache, just continue */ }
  }

  // Default: community tier (free)
  logger.info('No valid license key found — running in Community (free) tier');
  _license = {
    valid: true,
    tier: 'community',
    maxServers: 1,
    licensee: null,
    email: null,
    expiresAt: null,
    features: TIERS.community.features,
    watermark: true,
    key: null,
  };

  return _license;
}

/**
 * Apply a decoded license token to the runtime state.
 */
function applyLicense(decoded, key) {
  const tierDef = TIERS[decoded.tier] || TIERS.community;

  // maxServers can be overridden in the license itself
  const maxServers = decoded.maxServers || tierDef.maxServers;

  _license = {
    valid: true,
    tier: decoded.tier,
    maxServers,
    licensee: decoded.licensee || null,
    email: decoded.email || null,
    expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    features: tierDef.features,
    watermark: tierDef.watermark,
    key,
  };

  logger.info({
    tier: tierDef.label,
    licensee: decoded.licensee,
    maxServers: maxServers === Infinity ? 'unlimited' : maxServers,
    expires: _license.expiresAt || 'never',
  }, 'License activated');
}

/**
 * Get the current license state (safe for API responses — no key).
 */
function getLicense() {
  const { key, ...safe } = _license;
  return safe;
}

/**
 * Check if a specific feature is enabled by the current license.
 * @param {string} feature - Feature identifier (e.g., 'discord_bot', 'webhooks')
 * @returns {boolean}
 */
function hasFeature(feature) {
  if (_license.features.includes('*')) return true;
  return _license.features.includes(feature);
}

/**
 * Check if the current license allows adding another server.
 * @param {number} currentCount - Current number of configured servers
 * @returns {boolean}
 */
function canAddServer(currentCount) {
  return currentCount < _license.maxServers;
}

/**
 * Get the tier definition for a given tier name.
 */
function getTierDef(tier) {
  return TIERS[tier] || TIERS.community;
}

/**
 * Manually activate a new license key at runtime (e.g., from the UI).
 * @param {string} key - New license key
 * @param {string} dataDir - Data directory for caching
 * @returns {{ success: boolean, license?: object, error?: string }}
 */
function setLicenseKey(key, dataDir) {
  const result = validateKey(key);
  if (!result.valid) {
    return { success: false, error: result.error };
  }

  applyLicense(result.decoded, key);

  // Cache it
  try {
    const cacheFile = path.join(dataDir, 'license.json');
    fs.writeFileSync(cacheFile, JSON.stringify({
      key,
      activatedAt: new Date().toISOString(),
      tier: result.decoded.tier,
    }));
  } catch { /* non-critical */ }

  return { success: true, license: getLicense() };
}

module.exports = {
  activateLicense,
  getLicense,
  hasFeature,
  canAddServer,
  getTierDef,
  setLicenseKey,
  validateKey,
  TIERS,
};
