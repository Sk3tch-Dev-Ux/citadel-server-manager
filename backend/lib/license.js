/**
 * Citadel License & Subscription System
 *
 * Subscription tiers: Free (no key) → Basic → Pro → Community
 * License keys are RSA-signed JWTs with tier + limits embedded.
 * The private key is held by the vendor (tools/license-private.pem).
 *
 * Subscription JWTs expire after 30-35 days. Users obtain fresh keys
 * from Citadel Cloud (Settings → License Key) and paste them here.
 *
 * States:
 *   free       — No valid key; limited to 1 server, basic features
 *   basic      — 2 servers, all admin actions, VIP store
 *   pro        — 5 servers, data export, cross-server features
 *   community  — Unlimited servers, custom branding, priority support
 */
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ─── RSA Public Key (used to verify license signatures) ──────────
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAp82bd+QOzARJ1BinD2f9
q7+9LezIXHmkMKBDMRvueNJ38J8djPOSU1w9oeIVS4XJHbj4LZ3ECV92+Bw35kGh
UTy9YjNMXcwfdNJmCgUgezqOvxstBcSiJe5IMSE7vGq9qhsJk4GuT+2giA9lXCii
K+PyHk12JIDmtTWecX/VajfuZ8KLwx5bbWyQjOVvhNtnpYvLpW+hwOhY743oEr22
OaPzEti64f6yOFGLuW3gMyXOk2LzEVfH9/VGqWUQEKAk/u2qhae9/tUrnNMYzaRJ
D2smJX4CWutpCPohja/KuNK4trE9KNdj+CcH2wt+WHCCBMasNERbK1y9QjT26g6Q
1wIDAQAB
-----END PUBLIC KEY-----`;

// ─── Tier Limits ─────────────────────────────────────────
const TIER_LIMITS = {
  free:      { maxServers: 1,  maxWebhooks: 2,  maxTeamMembers: 3,  dataRetentionDays: 3,   apiRate: 60 },
  basic:     { maxServers: 2,  maxWebhooks: 5,  maxTeamMembers: 5,  dataRetentionDays: 14,  apiRate: 120 },
  pro:       { maxServers: 5,  maxWebhooks: 15, maxTeamMembers: 15, dataRetentionDays: 30,  apiRate: 300 },
  community: { maxServers: -1, maxWebhooks: -1, maxTeamMembers: -1, dataRetentionDays: 365, apiRate: 1000 },
};

const TIER_ORDER = ['free', 'basic', 'pro', 'community'];

// ─── License State ───────────────────────────────────────
let _license = {
  licensed: false,
  tier: 'free',
  licensee: null,
  email: null,
  expiresAt: null,
  watermark: true,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  key: null,
};

/**
 * Get the limits for a given tier.
 */
function getTierLimits(tier) {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

/**
 * Check if tierA meets or exceeds the minimum tier requirement.
 */
function meetsMinTier(currentTier, minTier) {
  if (!minTier) return true;
  return TIER_ORDER.indexOf(currentTier) >= TIER_ORDER.indexOf(minTier);
}

/**
 * Validate and decode a license key (RSA-signed JWT).
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

    if (decoded.product !== 'citadel') {
      return { valid: false, error: 'Invalid product identifier in license key' };
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
      try {
        fs.writeFileSync(cacheFile, JSON.stringify({ key, activatedAt: new Date().toISOString() }));
      } catch { /* non-critical */ }
      return _license;
    }
    logger.warn({ error: result.error }, 'License key validation failed — running as free tier');
  }

  // Try cached license
  if (!key && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached.key) {
        const result = validateKey(cached.key);
        if (result.valid) {
          applyLicense(result.decoded, cached.key);
          return _license;
        }
        logger.warn({ error: result.error }, 'Cached license invalid — running as free tier');
      }
    } catch { /* corrupted cache */ }
  }

  // Default: free tier
  applyFreeTier();
  return _license;
}

/**
 * Apply a decoded license token to the runtime state.
 */
function applyLicense(decoded, key) {
  const tier = decoded.tier || (decoded.product === 'citadel' ? 'community' : 'free'); // Legacy permanent keys get community tier

  _license = {
    licensed: true,
    tier,
    licensee: decoded.licensee || null,
    email: decoded.email || null,
    expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    watermark: false,
    stripeCustomerId: decoded.stripeCustomerId || null,
    stripeSubscriptionId: decoded.stripeSubscriptionId || null,
    key,
  };

  logger.info({
    licensee: decoded.licensee,
    tier,
    expires: _license.expiresAt || 'never',
  }, `License activated — ${tier} tier`);
}

/**
 * Set the free tier defaults.
 */
function applyFreeTier() {
  logger.info('No valid license key — running as free tier (1 server, limited features)');
  _license = {
    licensed: false,
    tier: 'free',
    licensee: null,
    email: null,
    expiresAt: null,
    watermark: true,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    key: null,
  };
}

/**
 * Get the current license state (safe for API responses — no key).
 */
function getLicense() {
  const { key, ...safe } = _license;
  return {
    ...safe,
    tierLimits: getTierLimits(_license.tier),
  };
}

/**
 * Check if the instance is licensed (any paid tier).
 */
function isLicensed() {
  return _license.licensed === true;
}

/**
 * Get the current tier.
 */
function getTier() {
  return _license.tier;
}

/**
 * Manually activate a new license key at runtime (e.g., from the UI).
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
    fs.writeFileSync(cacheFile, JSON.stringify({ key, activatedAt: new Date().toISOString() }));
  } catch { /* non-critical */ }

  return { success: true, license: getLicense() };
}

module.exports = {
  activateLicense,
  getLicense,
  isLicensed,
  getTier,
  getTierLimits,
  meetsMinTier,
  setLicenseKey,
  validateKey,
  TIER_LIMITS,
  TIER_ORDER,
};
