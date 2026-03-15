/**
 * RSA-signed license key generation for subscription tiers.
 *
 * On Vercel the private key is stored as a base64-encoded env var
 * (LICENSE_PRIVATE_KEY_B64) because there is no persistent filesystem.
 *
 * To encode your PEM file:
 *   cat tools/license-private.pem | base64 | tr -d '\n'
 */
const jwt = require('jsonwebtoken');

let _privateKey = null;

function getPrivateKey() {
  if (_privateKey) return _privateKey;

  const b64 = process.env.LICENSE_PRIVATE_KEY_B64;
  if (!b64) throw new Error('LICENSE_PRIVATE_KEY_B64 environment variable is not set');

  _privateKey = Buffer.from(b64, 'base64').toString('utf8');
  return _privateKey;
}

/**
 * Tier limits — shared definition used by both the license server and backend.
 */
const TIER_LIMITS = {
  free:      { maxServers: 1,  maxWebhooks: 2,  maxTeamMembers: 3,  dataRetentionDays: 3,   apiRate: 60 },
  basic:     { maxServers: 2,  maxWebhooks: 5,  maxTeamMembers: 5,  dataRetentionDays: 14,  apiRate: 120 },
  pro:       { maxServers: 5,  maxWebhooks: 15, maxTeamMembers: 15, dataRetentionDays: 30,  apiRate: 300 },
  community: { maxServers: -1, maxWebhooks: -1, maxTeamMembers: -1, dataRetentionDays: 365, apiRate: 1000 },
};

/**
 * Generate a subscription-based Citadel license key.
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} opts.name
 * @param {string} opts.tier - 'basic' | 'pro' | 'community'
 * @param {string} [opts.stripeCustomerId]
 * @param {string} [opts.stripeSubscriptionId]
 * @param {number} [opts.expiresInDays=30] - JWT expiry in days
 * @returns {string} RSA-signed JWT license key
 */
function generateLicenseKey({ email, name, tier, stripeCustomerId, stripeSubscriptionId, expiresInDays = 30 }) {
  const limits = TIER_LIMITS[tier];
  if (!limits) throw new Error(`Unknown tier: ${tier}`);

  const payload = {
    product: 'citadel',
    licensee: name || email,
    email,
    tier,
    stripeCustomerId: stripeCustomerId || undefined,
    stripeSubscriptionId: stripeSubscriptionId || undefined,
    ...limits,
  };

  return jwt.sign(payload, getPrivateKey(), {
    algorithm: 'RS256',
    issuer: 'citadel-license',
    expiresIn: `${expiresInDays}d`,
  });
}

module.exports = { generateLicenseKey, TIER_LIMITS };
