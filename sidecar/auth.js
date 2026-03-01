/**
 * Citadel Sidecar — Authentication Middleware
 *
 * Validates the Bearer token against the configured API key.
 * If no API key is configured, all requests are allowed (development mode).
 */
const config = require('./config');
const crypto = require('crypto');

function authMiddleware(req, res, next) {
  // No API key configured — allow all (dev mode)
  if (!config.apiKey) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Authorization required' });
  }

  const token = authHeader.slice(7);
  if (token.length !== config.apiKey.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.apiKey))) {
    return res.status(403).json({ ok: false, error: 'Invalid API key' });
  }

  next();
}

module.exports = authMiddleware;
