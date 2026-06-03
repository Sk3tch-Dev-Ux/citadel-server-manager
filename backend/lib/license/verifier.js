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
 * Tolerate small client-clock drift: a customer PC running a few minutes
 * fast must not see a freshly-issued token as not-yet-valid or a live one
 * as expired, which would force a spurious online re-activation.
 */
const CLOCK_TOLERANCE_SEC = 300;

/**
 * Verify signature + issuer + product, return decoded payload.
 * Throws on invalid signature, wrong issuer, or wrong product.
 *
 * Pass { ignoreExpiration: true } to validate authenticity of an EXPIRED
 * token (signature/issuer/product still enforced) — used at boot so an
 * expired-but-genuine cached token can enter the offline grace window
 * instead of being treated like a tampered token and cleared.
 */
function verifyToken(token, { ignoreExpiration = false } = {}) {
  const decoded = jwt.verify(token, CITADEL_LICENSE_PUBLIC_KEY, {
    algorithms: ['RS256'],
    issuer: 'citadels.cc',
    clockTolerance: CLOCK_TOLERANCE_SEC,
    ignoreExpiration,
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
