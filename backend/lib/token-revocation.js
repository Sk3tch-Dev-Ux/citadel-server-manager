/**
 * Token Revocation System
 *
 * Implements a simple in-memory token blacklist for immediate revocation.
 * Uses JWT jti (JWT ID) claims for tracking revoked tokens.
 *
 * Use cases:
 *   - User deleted (revoke all their tokens)
 *   - User disabled (revoke all their tokens)
 *   - Forced logout (revoke specific token)
 *   - Security incident (revoke token class)
 */

const logger = require('./logger');

/**
 * In-memory revocation registry: Set of revoked JWT jti values
 * Expires entries after 8+ hours (token lifetime + buffer)
 */
const revokedTokens = new Map(); // Map of jti => expiryTime

/**
 * Revoke all tokens for a user by ID.
 * In a distributed system, you'd want to persist this to a database/Redis.
 *
 * @param {string} userId - The user ID to revoke tokens for
 * @param {string} reason - Why we're revoking (e.g., 'user.deleted', 'user.disabled')
 */
function revokeUserTokens(userId, reason = 'manual') {
  logger.info({ userId, reason }, 'Revoking all tokens for user');
  // Mark all tokens issued before now as revoked
  // New tokens will have a newer iat (issued-at) time
  revokedTokens.set(`user:${userId}:*`, { expiresAt: Date.now() + 30 * 60 * 1000, reason });
}

/**
 * Revoke a specific token by jti.
 *
 * @param {string} jti - JWT ID to revoke
 * @param {number} expiresAt - When the token naturally expires (for cleanup)
 * @param {string} reason - Why we're revoking
 */
function revokeToken(jti, expiresAt, reason = 'manual') {
  if (!jti) return;
  logger.debug({ jti, reason }, 'Revoking token');
  revokedTokens.set(jti, { expiresAt, reason });
}

/**
 * Check if a token is revoked.
 *
 * @param {Object} decoded - Decoded JWT payload { jti, id, iat, ... }
 * @returns {boolean} true if revoked, false otherwise
 */
function isTokenRevoked(decoded) {
  if (!decoded) return false;

  // Check specific jti revocation
  if (decoded.jti && revokedTokens.has(decoded.jti)) {
    return true;
  }

  // Check user-wide revocation (if iat is before revocation time)
  if (decoded.id && decoded.iat) {
    const userWideRevocation = revokedTokens.get(`user:${decoded.id}:*`);
    if (userWideRevocation && decoded.iat * 1000 < userWideRevocation.expiresAt) {
      return true;
    }
  }

  return false;
}

/**
 * Cleanup expired revocation entries.
 * Call this periodically (e.g., every hour) to prevent memory leaks.
 */
function cleanupExpired() {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of revokedTokens) {
    if (entry.expiresAt && entry.expiresAt < now) {
      revokedTokens.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    logger.debug({ removed }, 'Cleaned up expired token revocations');
  }
}

/**
 * Get revocation stats (for monitoring).
 */
function getStats() {
  return {
    revokedCount: revokedTokens.size,
    entries: Array.from(revokedTokens.entries()).map(([key, val]) => ({
      key,
      expiresAt: new Date(val.expiresAt).toISOString(),
      reason: val.reason
    }))
  };
}

/**
 * Clear all revocations (dangerous — use with care, e.g., for testing).
 */
function clearAll() {
  revokedTokens.clear();
  logger.warn('Cleared all token revocations');
}

// Periodic cleanup every hour
const cleanupInterval = setInterval(cleanupExpired, 60 * 60 * 1000);
cleanupInterval.unref(); // Don't prevent process exit

module.exports = {
  revokeUserTokens,
  revokeToken,
  isTokenRevoked,
  cleanupExpired,
  getStats,
  clearAll
};
