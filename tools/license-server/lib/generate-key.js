/**
 * RSA-signed license key generation.
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
 * Generate a permanent Citadel license key for a customer.
 * @param {string} email
 * @param {string} name
 * @returns {string} RSA-signed JWT license key
 */
function generateLicenseKey(email, name) {
  const payload = {
    product: 'citadel',
    licensee: name || email,
    email,
  };

  return jwt.sign(payload, getPrivateKey(), {
    algorithm: 'RS256',
    issuer: 'citadel-license',
    // No expiresIn → permanent license
  });
}

module.exports = { generateLicenseKey };
