/**
 * Citadel License Validation System
 *
 * Simple one-time purchase model: $34.99 → full access to every feature.
 * License keys are RSA-signed JWTs verified with the embedded public key.
 * The private key is held by the vendor (tools/license-private.pem) and
 * used via tools/generate-license.js to issue keys.
 *
 * States:
 *   unlicensed — No valid key; tool runs with a "please purchase" watermark
 *   licensed   — Valid key; full unrestricted access to all features
 */
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

// ─── License State ───────────────────────────────────────────────
let _license = {
  licensed: false,
  licensee: null,
  email: null,
  expiresAt: null,
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

    // Must be a Citadel product key
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
      // Cache valid license
      try {
        fs.writeFileSync(cacheFile, JSON.stringify({
          key,
          activatedAt: new Date().toISOString(),
        }));
      } catch { /* non-critical */ }
      return _license;
    }
    logger.warn({ error: result.error }, 'License key validation failed — running unlicensed');
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
        logger.warn({ error: result.error }, 'Cached license invalid — running unlicensed');
      }
    } catch { /* corrupted cache, just continue */ }
  }

  // Default: unlicensed
  logger.info('No valid license key found — running unlicensed (purchase at citadel.gg for $34.99)');
  _license = {
    licensed: false,
    licensee: null,
    email: null,
    expiresAt: null,
    watermark: true,
    key: null,
  };

  return _license;
}

/**
 * Apply a decoded license token to the runtime state.
 */
function applyLicense(decoded, key) {
  _license = {
    licensed: true,
    licensee: decoded.licensee || null,
    email: decoded.email || null,
    expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    watermark: false,
    key,
  };

  logger.info({
    licensee: decoded.licensee,
    expires: _license.expiresAt || 'never',
  }, 'License activated — full access enabled');
}

/**
 * Get the current license state (safe for API responses — no key).
 */
function getLicense() {
  const { key, ...safe } = _license;
  return safe;
}

/**
 * Check if the instance is licensed.
 * @returns {boolean}
 */
function isLicensed() {
  return _license.licensed === true;
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
    }));
  } catch { /* non-critical */ }

  return { success: true, license: getLicense() };
}

module.exports = {
  activateLicense,
  getLicense,
  isLicensed,
  setLicenseKey,
  validateKey,
};
