/**
 * Authentication routes (login with brute-force protection + TOTP MFA).
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const logger = require('../lib/logger');
const { fail2ban, recordLoginFailure, recordLoginSuccess } = require('../middleware/rate-limit');

const loginAttempts = {};
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of stale loginAttempts entries to prevent memory leaks.
// Removes entries older than LOCK_TIME * 2 (20 minutes of inactivity).
const _loginAttemptsCleanup = setInterval(() => {
  const cutoff = Date.now() - (LOCK_TIME * 2);
  for (const key of Object.keys(loginAttempts)) {
    const entry = loginAttempts[key];
    if (entry.last < cutoff && entry.lockedUntil < Date.now()) {
      delete loginAttempts[key];
    }
  }
}, 10 * 60 * 1000); // Every 10 minutes
_loginAttemptsCleanup.unref(); // Don't prevent process exit

module.exports = function(app) {
  // Fail2Ban middleware applied before the login handler
  app.post('/api/auth/login', fail2ban, async (req, res) => {
    const { username, password, mfa } = req.body;
    const user = ctx.users.find(u => u.username === username);

    // Constant-time path: always run bcrypt even for non-existent users
    // to prevent timing-based user enumeration
    const dummyHash = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0';
    const hashToCompare = user ? user.passwordHash : dummyHash;

    // Brute-force lockout
    const key = (username || '').toLowerCase();
    const now = Date.now();
    if (!loginAttempts[key]) loginAttempts[key] = { count: 0, last: 0, lockedUntil: 0 };
    if (loginAttempts[key].lockedUntil > now) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    }

    const valid = await bcrypt.compare(password || '', hashToCompare);
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    if (!user || !valid) {
      loginAttempts[key].count++;
      loginAttempts[key].last = now;
      if (loginAttempts[key].count >= MAX_ATTEMPTS) {
        loginAttempts[key].lockedUntil = now + LOCK_TIME;
        logger.warn({ username: key }, 'Account locked due to failed login attempts');
      }
      // Record IP-level failure for fail2ban
      recordLoginFailure(clientIp);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    loginAttempts[key] = { count: 0, last: now, lockedUntil: 0 };
    // Reset IP-level failure tracking on success
    recordLoginSuccess(clientIp);

    // MFA validation (TOTP)
    if (user.mfaEnabled && user.mfaSecret) {
      if (!mfa) return res.status(401).json({ error: 'MFA code required', mfaRequired: true });
      const isValid = authenticator.check(String(mfa), user.mfaSecret);
      if (!isValid) {
        logger.warn({ userId: user.id }, 'Invalid MFA code');
        return res.status(401).json({ error: 'Invalid MFA code' });
      }
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      ctx.CONFIG.jwtSecret,
      { expiresIn: '8h' }  // Shorter token lifetime for security
    );
    addAudit(user.id, user.username, 'login', 'User logged in');
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  });

  // MFA enrollment endpoint
  const auth = require('../middleware/auth');
  app.post('/api/auth/mfa/setup', auth(), async (req, res) => {
    const user = ctx.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.mfaEnabled) return res.status(400).json({ error: 'MFA already enabled' });
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.username, 'Citadel', secret);
    // Store secret temporarily (not yet enabled until verified)
    user._pendingMfaSecret = secret;
    res.json({ secret, otpauthUrl });
  });

  app.post('/api/auth/mfa/verify', auth(), async (req, res) => {
    const { code } = req.body;
    const user = ctx.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user._pendingMfaSecret) return res.status(400).json({ error: 'No MFA setup in progress' });
    const isValid = authenticator.check(String(code), user._pendingMfaSecret);
    if (!isValid) return res.status(400).json({ error: 'Invalid code — try again' });
    user.mfaSecret = user._pendingMfaSecret;
    user.mfaEnabled = true;
    delete user._pendingMfaSecret;
    const { saveJSON } = require('../lib/data-store');
    saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users);
    addAudit(user.id, user.username, 'mfa.enable', 'MFA enabled');
    res.json({ message: 'MFA enabled successfully' });
  });

  app.post('/api/auth/mfa/disable', auth(), async (req, res) => {
    const { password } = req.body;
    const user = ctx.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.mfaEnabled) return res.status(400).json({ error: 'MFA not enabled' });
    const valid = await bcrypt.compare(password || '', user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });
    user.mfaEnabled = false;
    delete user.mfaSecret;
    delete user._pendingMfaSecret;
    const { saveJSON } = require('../lib/data-store');
    saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users);
    addAudit(user.id, user.username, 'mfa.disable', 'MFA disabled');
    res.json({ message: 'MFA disabled' });
  });
};
