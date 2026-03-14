/**
 * CSRF Protection Middleware
 *
 * Implements a double-submit cookie pattern (stateless, suitable for SPAs):
 * 1. Generate a CSRF token and set it in an HttpOnly cookie
 * 2. Client reads the token from the cookie and includes it in X-CSRF-Token header
 * 3. Server verifies: token in header matches token in cookie
 *
 * The cookie is NOT httpOnly because the frontend needs to read it to send
 * it back as a header. SameSite=strict prevents cross-origin cookie access.
 */

const crypto = require('crypto');
const logger = require('../lib/logger');

/**
 * Generate a random CSRF token (32 bytes = 64 hex chars).
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF middleware: Generate token and set cookie.
 * Applies to all routes.
 */
function csrfProtection(req, res, next) {
  // Reuse existing token from cookie if present; only generate a new one if missing
  const existing = req.cookies && req.cookies['csrf-token'];
  const token = existing || generateToken();

  // Set token in a JS-readable cookie (NOT httpOnly — frontend must read it
  // to send back as X-CSRF-Token header for double-submit pattern)
  res.cookie('csrf-token', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production' || process.env.USE_HTTPS === '1',
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000 // 1 hour
  });

  // Also make token available via response header for frontend to read after page load
  res.setHeader('X-CSRF-Token', token);

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
  // Use req.originalUrl because this middleware is mounted at /api/ which strips the prefix from req.url
  const exemptPaths = ['/api/auth/login', '/api/setup/', '/api/health', '/api/store/webhook'];
  if (exemptPaths.some(p => req.originalUrl.startsWith(p))) {
    return next();
  }

  const tokenFromCookie = req.cookies['csrf-token'];
  const tokenFromHeader = req.headers['x-csrf-token'];

  if (!tokenFromCookie) {
    logger.warn({ method: req.method, url: req.url }, 'Missing CSRF token cookie');
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  if (!tokenFromHeader) {
    logger.warn({ method: req.method, url: req.url }, 'Missing CSRF token header');
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  // Constant-time comparison to prevent timing attacks
  if (!constantTimeEqual(tokenFromCookie, tokenFromHeader)) {
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
  generateToken,
  csrfProtection,
  verifyCsrfToken,
  constantTimeEqual
};
