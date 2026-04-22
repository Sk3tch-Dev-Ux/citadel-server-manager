/**
 * Verify a Citadel license JWT locally using the embedded RSA public key.
 *
 * This is what powers the offline grace period — we can confirm a cached
 * token is genuine without calling citadels.cc on every request. When the
 * token expires or goes past the grace window, we require a fresh /verify
 * call (which requires network).
 */
const jwt = require('jsonwebtoken');
const { CITADEL_LICENSE_PUBLIC_KEY } = require('./public-key');

/**
 * Verify signature + issuer + product, return decoded payload.
 * Throws on invalid signature, wrong issuer, or wrong product.
 */
function verifyToken(token) {
  const decoded = jwt.verify(token, CITADEL_LICENSE_PUBLIC_KEY, {
    algorithms: ['RS256'],
    issuer: 'citadels.cc',
  });
  if (decoded.product !== 'citadel') {
    throw new Error('Token is not a Citadel license');
  }
  return decoded;
}

/**
 * Decode without verification — used to check expiry/status locally when
 * verifyToken() has already succeeded and we just want claim data.
 */
function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = { verifyToken, decodeToken };
