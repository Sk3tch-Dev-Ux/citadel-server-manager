/**
 * Rate limiter configurations for different endpoint groups,
 * plus IP-level Fail2Ban brute-force protection.
 */
const rateLimit = require('express-rate-limit');
const logger = require('../lib/logger');
const ctx = require('../lib/context');
const { loadJSON, saveJSON } = require('../lib/data-store');

/** General API limiter: 120 requests per minute per IP */
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/** Auth endpoints: 15 attempts per 15 minutes (brute-force protection) */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

/** Discord bot endpoint: 60 requests per minute */
const discordLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' },
});

// ─── Fail2Ban: IP-Level Brute Force Protection ──────────────
//
// Tracks failed login attempts per IP address.
// After FAIL2BAN_THRESHOLD failures, the IP is banned for an escalating duration.
// Ban durations: 60s -> 300s -> 3600s (resets after successful login).
// Stale entries are pruned every 5 minutes to prevent memory leaks.

const FAIL2BAN_THRESHOLD = 5;
const BAN_DURATIONS = [60 * 1000, 300 * 1000, 3600 * 1000]; // 60s, 5min, 1hr
const STALE_ENTRY_TTL = 3600 * 1000; // Remove entries not seen for 1 hour
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Prune every 5 minutes

// Persistent tracking: ip -> { failures, lastFailure, bannedUntil, banLevel }
// Loaded from disk so bans survive restarts.
const _ipTracker = new Map();

// Restore persisted IP bans on startup
try {
  const persisted = loadJSON(ctx.CONFIG.dataDir, 'ip-bans.json', {});
  const now = Date.now();
  for (const [ip, entry] of Object.entries(persisted)) {
    // Only restore entries with active bans or recent failures
    if (entry.bannedUntil > now || (now - entry.lastFailure) < STALE_ENTRY_TTL) {
      _ipTracker.set(ip, entry);
    }
  }
} catch { /* ignore startup load errors */ }

/**
 * Fail2Ban middleware.
 * Returns 429 with Retry-After header when an IP is banned.
 * Must be applied BEFORE the login route handler.
 */
function fail2ban(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const entry = _ipTracker.get(ip);

  if (entry && entry.bannedUntil > Date.now()) {
    const retryAfter = Math.ceil((entry.bannedUntil - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Too many failed login attempts. Your IP is temporarily blocked.',
      retryAfter,
    });
  }

  next();
}

/**
 * Record a failed login attempt for an IP.
 * Called from the auth route when login fails.
 *
 * @param {string} ip - The client IP address
 */
function recordLoginFailure(ip) {
  if (!ip) return;

  let entry = _ipTracker.get(ip);
  if (!entry) {
    entry = { failures: 0, lastFailure: 0, bannedUntil: 0, banLevel: 0 };
    _ipTracker.set(ip, entry);
  }

  entry.failures++;
  entry.lastFailure = Date.now();

  if (entry.failures >= FAIL2BAN_THRESHOLD) {
    // Pick ban duration based on escalation level
    const duration = BAN_DURATIONS[Math.min(entry.banLevel, BAN_DURATIONS.length - 1)];
    entry.bannedUntil = Date.now() + duration;
    entry.banLevel++;
    entry.failures = 0; // Reset failures for next escalation cycle
    logger.warn({ ip, banDurationMs: duration, banLevel: entry.banLevel }, 'IP banned by fail2ban');
  }

  // Persist IP ban state to disk
  _persistIpBans();
}

/**
 * Record a successful login for an IP.
 * Resets the failure counter and ban state.
 *
 * @param {string} ip - The client IP address
 */
function recordLoginSuccess(ip) {
  if (!ip) return;
  _ipTracker.delete(ip);
  _persistIpBans();
}

/**
 * Persist current IP ban state to disk.
 * Uses saveJSON (debounced) so rapid login failures don't hammer disk I/O.
 */
function _persistIpBans() {
  const obj = {};
  for (const [ip, entry] of _ipTracker.entries()) {
    obj[ip] = entry;
  }
  saveJSON(ctx.CONFIG.dataDir, 'ip-bans.json', obj);
}

/**
 * Prune stale entries from the tracker to prevent memory leaks.
 * Removes entries that haven't had activity in STALE_ENTRY_TTL
 * and whose ban has expired.
 */
function _pruneStaleEntries() {
  const now = Date.now();
  for (const [ip, entry] of _ipTracker.entries()) {
    const isExpiredBan = entry.bannedUntil <= now;
    const isStale = (now - entry.lastFailure) > STALE_ENTRY_TTL;
    if (isExpiredBan && isStale) {
      _ipTracker.delete(ip);
    }
  }
}

// Start periodic cleanup
const _cleanupInterval = setInterval(_pruneStaleEntries, CLEANUP_INTERVAL);
// Allow Node to exit without waiting for this interval
if (_cleanupInterval.unref) _cleanupInterval.unref();

module.exports = {
  apiLimiter,
  authLimiter,
  discordLimiter,
  fail2ban,
  recordLoginFailure,
  recordLoginSuccess,
};
