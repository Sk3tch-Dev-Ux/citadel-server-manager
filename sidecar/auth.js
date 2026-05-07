/**
 * Citadel Sidecar — Authentication Middleware
 *
 * Validates the Bearer token against the configured API key.
 *
 * If no API key is configured, all requests are allowed — but only when
 * the listener is bound to 127.0.0.1 (see server.js bindHost logic added
 * for audit H9). In production, server.js refuses to start without an
 * API key, so this branch only matters for local dev.
 */
const config = require('./config');
const crypto = require('crypto');

function authMiddleware(req, res, next) {
  // No API key configured — allow all (dev mode, loopback-only).
  // The bind in server.js prevents this from being reachable from the
  // network when no key is set; this branch should never run for a
  // network request.
  if (!config.apiKey) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Authorization required' });
  }

  // timingSafeEqual requires equal-length buffers. Pad both sides to a
  // fixed 64-byte buffer to avoid leaking the configured key's length
  // through the early-length-mismatch path. The pad XOR'd against itself
  // contributes 0 to the hash diff, so this is functionally equivalent
  // to comparing the original strings.
  const token = authHeader.slice(7);
  const target = Buffer.alloc(64);
  const candidate = Buffer.alloc(64);
  Buffer.from(config.apiKey).copy(target);
  Buffer.from(token).copy(candidate);
  // The length check still has to happen (so we don't accept a longer
  // token whose first config.apiKey.length bytes happen to match), but
  // it runs AFTER the constant-time hash compare so the timing of the
  // length leak is masked.
  const eq = crypto.timingSafeEqual(target, candidate);
  if (!eq || token.length !== config.apiKey.length) {
    return res.status(403).json({ ok: false, error: 'Invalid API key' });
  }

  next();
}

module.exports = authMiddleware;
