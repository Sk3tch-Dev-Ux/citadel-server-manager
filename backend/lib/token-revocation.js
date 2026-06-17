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

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const ctx = require('./context');
const dataStore = require('./data-store');
const { TOKEN_REVOCATION_TTL_MS } = require('./constants');

// On-disk filename, persisted via data-store.saveJSON so it inherits the
// atomic temp-file+rename, the M16 symlink guard, the 0o600 mode (it's in
// data-store's SENSITIVE_FILES), and the FRAG-4 force-flush (revocations are
// security-critical — they must be durable before the request returns).
const REVOCATION_FILENAME = 'token-revocations.json';

/**
 * Canonical revocation reason codes. Use these (rather than ad-hoc strings)
 * when revoking tokens so audit/forensics queries can group by a stable set.
 */
const REVOCATION_REASONS = Object.freeze({
  USER_DELETED: 'user.deleted',
  USER_DISABLED: 'user.disabled',
  PASSWORD_CHANGED: 'password.changed',
  LOGOUT: 'logout',
  SECURITY_INCIDENT: 'security.incident',
  MANUAL: 'manual',
});

/**
 * In-memory revocation registry: Set of revoked JWT jti values
 * Expires entries after 8+ hours (token lifetime + buffer)
 *
 * Persisted to disk on every write so revocations survive server restarts.
 */
const revokedTokens = new Map(); // Map of jti => expiryTime

/**
 * Resolve the data directory at call time. Prefer the configured dataDir
 * (ctx.CONFIG is set in server.js before middleware/auth — and hence this
 * module — is first required), and fall back to <cwd>/data so the module is
 * still usable in isolation (e.g. a unit test that doesn't boot the server).
 */
function getDataDir() {
  return (ctx.CONFIG && ctx.CONFIG.dataDir) || path.join(process.cwd(), 'data');
}

/** Load persisted revocations from disk on startup */
function loadFromDisk() {
  try {
    const persistFile = path.join(getDataDir(), REVOCATION_FILENAME);
    if (fs.existsSync(persistFile)) {
      const raw = JSON.parse(fs.readFileSync(persistFile, 'utf8'));
      const now = Date.now();
      let loaded = 0;
      for (const [key, entry] of Object.entries(raw)) {
        // Skip expired entries
        if (entry && entry.expiresAt && entry.expiresAt > now) {
          revokedTokens.set(key, entry);
          loaded++;
        }
      }
      if (loaded > 0) {
        logger.info({ loaded }, 'Loaded persisted token revocations from disk');
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to load token revocations from disk (starting fresh)');
  }
}

/**
 * Persist current revocations to disk.
 *
 * Routed through data-store.saveJSON (instead of a raw fs.writeFileSync) so it
 * inherits the atomic temp-file+rename, the M16 symlink-refusal guard, the
 * 0o600 mode, and — because 'token-revocations.json' is a SENSITIVE_FILE —
 * the FRAG-4 force-flush: the revocation is durable on disk before the call
 * returns, so a revocation can't be lost in a debounce window if the process
 * is killed right after.
 */
function persistToDisk() {
  try {
    const data = Object.fromEntries(revokedTokens);
    // saveJSON returns a Promise that rejects on write failure; the failure is
    // already logged + routed to the onWriteError hook inside data-store, so
    // just suppress the rejection here to avoid an unhandledRejection.
    Promise.resolve(dataStore.saveJSON(getDataDir(), REVOCATION_FILENAME, data)).catch(() => {});
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to persist token revocations to disk');
  }
}

// Load on module init
loadFromDisk();

/**
 * Revoke all tokens for a user by ID.
 * In a distributed system, you'd want to persist this to a database/Redis.
 *
 * @param {string} userId - The user ID to revoke tokens for
 * @param {string} reason - Why we're revoking (e.g., 'user.deleted', 'user.disabled')
 */
function revokeUserTokens(userId, reason = 'manual') {
  logger.info({ userId, reason }, 'Revoking all tokens for user');
  // Mark all tokens issued before now as revoked.
  // New tokens will have a newer iat (issued-at) time.
  //
  // The entry's expiresAt does double duty: it is both the cutoff this
  // revocation enforces (isTokenRevoked treats any token with iat < expiresAt
  // as revoked) AND the entry's own cleanup TTL. Login JWTs carry no jti, so
  // this user-wide branch is the ONLY revocation that applies to them — the
  // entry must therefore outlive the longest-lived login token (its full TTL
  // plus a clock-skew buffer). The old 30-minute window let an 8h login token
  // survive an admin password-reset/change once 30 minutes had elapsed,
  // because the entry was garbage-collected out from under the still-valid
  // token.
  revokedTokens.set(`user:${userId}:*`, { expiresAt: Date.now() + TOKEN_REVOCATION_TTL_MS, reason });
  persistToDisk();
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
  persistToDisk();
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
    persistToDisk();
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
  clearAll,
  REVOCATION_REASONS
};
