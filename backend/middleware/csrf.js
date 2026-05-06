/**
 * CSRF Protection Middleware — HMAC-Signed Double-Submit Cookie Pattern
 *
 * Improved design:
 * 1. Generate a random nonce and HMAC-sign it with JWT_SECRET → signed token
 * 2. Store the SIGNED token in an HttpOnly cookie (XSS cannot read it)
 * 3. Send the NONCE to the client via response header (X-CSRF-Token)
 * 4. Client sends nonce back in X-CSRF-Token header on state-changing requests
 * 5. Server re-signs the nonce from the header and compares with the cookie
 *
 * This is secure because:
 * - XSS cannot read the HttpOnly cookie to extract the signed token
 * - An attacker who intercepts the nonce cannot forge the signed cookie
 * - SameSite=strict prevents cross-origin cookie attachment
 */

const crypto = require('crypto');
const logger = require('../lib/logger');

/**
 * Resolve the CSRF signing secret at call time, NOT at module load.
 *
 * Why late-bound: this module is required from server.js immediately after
 * dotenv config, but config.js is responsible for auto-generating + persisting
 * JWT_SECRET on first run. Reading process.env at module load risked capturing
 * an empty value if module-load order ever changed; the previous code papered
 * over that with a hard-coded fallback ('fallback-csrf-secret') which would
 * have silently turned every CSRF token into a forgeable known constant.
 *
 * Now we throw loudly instead. If you see this thrown, something is wrong
 * with config bootstrap order — fix the bootstrap, do NOT add a fallback.
 */
function getCsrfSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'CSRF: JWT_SECRET is not set. Refusing to sign tokens with a default value. ' +
      'config.js auto-generates one on first boot — make sure it loads before csrf.js.'
    );
  }
  return secret;
}

/**
 * Generate a random CSRF nonce (32 bytes = 64 hex chars).
 */
function generateNonce() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sign a nonce with HMAC-SHA256 to produce the cookie value.
 */
function signNonce(nonce) {
  return crypto.createHmac('sha256', getCsrfSecret()).update(nonce).digest('hex');
}

/**
 * CSRF middleware: Generate nonce, sign it, set HttpOnly cookie + response header.
 * Applies to all routes.
 */
function csrfProtection(req, res, next) {
  // Reuse existing nonce if we have a valid signed cookie
  const existingSignedCookie = req.cookies && req.cookies['csrf-token'];
  const existingNonce = req.cookies && req.cookies['csrf-nonce'];

  let nonce;
  let signedToken;

  if (existingNonce && existingSignedCookie) {
    // Verify existing pair is still valid
    const expectedSig = signNonce(existingNonce);
    if (constantTimeEqual(expectedSig, existingSignedCookie)) {
      nonce = existingNonce;
      signedToken = existingSignedCookie;
    }
  }

  if (!nonce) {
    nonce = generateNonce();
    signedToken = signNonce(nonce);
  }

  const isSecure = process.env.NODE_ENV === 'production' || process.env.USE_HTTPS === '1';

  // HttpOnly signed cookie — XSS CANNOT read this
  res.cookie('csrf-token', signedToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000 // 1 hour
  });

  // Non-HttpOnly nonce cookie — frontend reads this to send as header
  // Even if XSS steals the nonce, it cannot forge the signed cookie
  res.cookie('csrf-nonce', nonce, {
    httpOnly: false,
    secure: isSecure,
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000
  });

  // Also expose nonce via response header for initial page load
  res.setHeader('X-CSRF-Token', nonce);

  next();
}

/**
 * CSRF verification middleware: Validate token for state-changing requests.
 * Applies to POST, PATCH, PUT, DELETE.
 */
function verifyCsrfToken(req, res, next) {
  // Skip verification for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip CSRF for unauthenticated routes (no session/token yet)
  const exemptPaths = ['/api/auth/login', '/api/setup/', '/api/health', '/api/store/webhook'];
  if (exemptPaths.some(p => req.originalUrl.startsWith(p))) {
    return next();
  }

  const signedFromCookie = req.cookies['csrf-token'];
  const nonceFromHeader = req.headers['x-csrf-token'];

  if (!signedFromCookie) {
    logger.warn({ method: req.method, url: req.url }, 'Missing CSRF signed cookie');
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  if (!nonceFromHeader) {
    logger.warn({ method: req.method, url: req.url }, 'Missing CSRF token header');
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  // Re-sign the nonce from the header and compare with the HttpOnly cookie
  const expectedSignature = signNonce(nonceFromHeader);
  if (!constantTimeEqual(signedFromCookie, expectedSignature)) {
    logger.warn({ method: req.method, url: req.url, ip: req.ip }, 'CSRF token mismatch');
    return res.status(403).json({ error: 'CSRF token invalid' });
  }

  next();
}

/**
 * Constant-time string comparison (prevents timing attacks).
 */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

module.exports = {
  generateToken: generateNonce,
  csrfProtection,
  verifyCsrfToken,
  constantTimeEqual
};
