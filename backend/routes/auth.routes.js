/**
 * Authentication routes (login with brute-force protection + TOTP MFA).
 */
const jwt = require('jsonwebtoken');
// Audit N5: bcryptjs → @node-rs/bcrypt. Hash format and API surface are
// identical (hash, compare, hashSync); existing user records validate
// without re-hash.
const bcrypt = require('@node-rs/bcrypt');
const { clientError } = require('../lib/http-errors');
const { authenticator } = require('../lib/totp');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const logger = require('../lib/logger');
const { loadJSON, saveJSON } = require('../lib/data-store');
const { fail2ban, recordLoginFailure, recordLoginSuccess } = require('../middleware/rate-limit');

const MAX_ATTEMPTS = 5;
const LOCK_TIME = 10 * 60 * 1000; // 10 minutes

// Pre-computed real bcrypt hash, used as a constant-time stand-in when the
// looked-up username doesn't exist. Generated once at module load so the
// hash is well-formed (the previous string-literal "$2a$10$abc...0" was 49
// chars after the prefix instead of the required 53, so bcrypt.compare
// rejected it instantly without doing any work — defeating the timing
// mitigation that the dummy is supposed to provide).
//
// The plaintext is random + namespaced so it can never collide with a real
// user password. We don't care what it is — only that compare runs the full
// algorithm at the same cost as a real user lookup.
const DUMMY_HASH = bcrypt.hashSync(
  'citadel-dummy-' + require('crypto').randomBytes(16).toString('hex'),
  10
);

// Persist lockout state to disk so it survives restarts.
// Structure: { [username]: { count, last, lockedUntil } }
let loginAttempts = loadJSON(ctx.CONFIG.dataDir, 'lockouts.json', {});

// Prune expired entries on load
const _loadNow = Date.now();
for (const key of Object.keys(loginAttempts)) {
  const entry = loginAttempts[key];
  if (entry.lockedUntil < _loadNow && (_loadNow - entry.last) > LOCK_TIME * 2) {
    delete loginAttempts[key];
  }
}

// Periodic cleanup of stale loginAttempts entries.
// Removes entries older than LOCK_TIME * 2 (20 minutes of inactivity).
const _loginAttemptsCleanup = setInterval(() => {
  const cutoff = Date.now() - (LOCK_TIME * 2);
  let changed = false;
  for (const key of Object.keys(loginAttempts)) {
    const entry = loginAttempts[key];
    if (entry.last < cutoff && entry.lockedUntil < Date.now()) {
      delete loginAttempts[key];
      changed = true;
    }
  }
  if (changed) {
    saveJSON(ctx.CONFIG.dataDir, 'lockouts.json', loginAttempts);
  }
}, 10 * 60 * 1000); // Every 10 minutes
_loginAttemptsCleanup.unref(); // Don't prevent process exit

module.exports = function(app) {
  // Fail2Ban middleware applied before the login handler
  app.post('/api/auth/login', fail2ban, async (req, res) => {
    const { username, password, mfa } = req.body;
    const user = ctx.users.find(u => u.username === username);

    // Constant-time path: always run bcrypt even for non-existent users
    // to prevent timing-based user enumeration. DUMMY_HASH is a real bcrypt
    // hash precomputed at module load — see top of file for rationale.
    const hashToCompare = user ? user.passwordHash : DUMMY_HASH;

    // Audit M12: lockout key is namespaced by client IP so an attacker
    // who knows a victim's username cannot lock that account by spamming
    // bad-password attempts from arbitrary IPs. Attempts from the same IP
    // still get counted normally; per-IP global brute-force is also
    // throttled by fail2ban (recordLoginFailure below), so the union of
    // these two defenses covers same-IP-and-username, same-IP-many-users,
    // and many-IPs-same-user.
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const usernameKey = (username || '').toLowerCase();
    const key = `${clientIp}|${usernameKey}`;
    const now = Date.now();
    if (!loginAttempts[key]) loginAttempts[key] = { count: 0, last: 0, lockedUntil: 0 };
    if (loginAttempts[key].lockedUntil > now) {
      return clientError(res, 429, 'Too many failed login attempts.', {
        code: 'LOGIN_LOCKED',
        suggestion: 'Wait a few minutes before trying again. If you\'re locked out and the server is yours, restart the Citadel service to clear the in-memory lockout.',
      });
    }

    const valid = await bcrypt.compare(password || '', hashToCompare);
    if (!user || !valid) {
      loginAttempts[key].count++;
      loginAttempts[key].last = now;
      if (loginAttempts[key].count >= MAX_ATTEMPTS) {
        loginAttempts[key].lockedUntil = now + LOCK_TIME;
        logger.warn({ ip: clientIp, username: usernameKey }, 'Account locked due to failed login attempts (per-IP)');
      }
      saveJSON(ctx.CONFIG.dataDir, 'lockouts.json', loginAttempts);
      // Record IP-level failure for fail2ban
      recordLoginFailure(clientIp);
      return clientError(res, 401, 'Invalid username or password.', {
        code: 'INVALID_CREDENTIALS',
        suggestion: 'Check caps lock. If you forgot the password and you\'re the only admin, recovery is via editing data/users.json on the server.',
      });
    }
    loginAttempts[key] = { count: 0, last: now, lockedUntil: 0 };
    saveJSON(ctx.CONFIG.dataDir, 'lockouts.json', loginAttempts);
    // Reset IP-level failure tracking on success
    recordLoginSuccess(clientIp);

    // MFA validation (TOTP)
    if (user.mfaEnabled && user.mfaSecret) {
      if (!mfa) return res.status(401).json({
        error: 'MFA code required.',
        code: 'MFA_REQUIRED',
        suggestion: 'Open your authenticator app and enter the 6-digit Citadel code.',
        mfaRequired: true,
      });

      // Decrypt the stored MFA secret
      let decryptedSecret;
      try {
        decryptedSecret = decrypt(user.mfaSecret);
      } catch (err) {
        logger.error({ err, userId: user.id }, 'Failed to decrypt MFA secret');
        return res.status(500).json({ error: 'Internal error' });
      }

      const isValid = authenticator.check(String(mfa), decryptedSecret);
      if (!isValid) {
        logger.warn({ userId: user.id }, 'Invalid MFA code');
        return clientError(res, 401, 'Invalid MFA code.', {
          code: 'MFA_INVALID',
          suggestion: 'Make sure your authenticator app\'s clock is synced. Codes refresh every 30 seconds.',
        });
      }
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, mustChangePassword: !!user.mustChangePassword },
      ctx.CONFIG.jwtSecret,
      { expiresIn: '8h' }  // Shorter token lifetime for security
    );
    addAudit(user.id, user.username, 'login', 'User logged in');

    // Audit M11 — set the JWT as an HttpOnly cookie alongside returning
    // it in the body. middleware/security.js wraps res.cookie() to
    // default httpOnly: true, sameSite: 'strict', secure: useHttps. The
    // cookie auto-attaches to every same-origin request, so the panel
    // doesn't need to keep the token in localStorage where DOM-XSS could
    // steal it. The body return stays for backward-compat with the
    // desktop app and any custom clients that explicitly use Bearer.
    //
    // 8 hours matches the JWT lifetime above. Path '/' so it attaches
    // to both /api/* (REST) and /socket.io/* (WebSocket upgrade).
    res.cookie('auth-token', token, {
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: !!user.mustChangePassword
      }
    });
  });

  // Audit M11 — explicit logout that clears the auth cookie. Frontend
  // clients calling this in addition to clearing their own state ensures
  // a stale cookie can't keep someone signed in after logout. No-auth
  // (idempotent — clearing a non-set cookie is fine).
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth-token', { path: '/' });
    res.json({ message: 'Logged out' });
  });

  // MFA enrollment endpoint
  const auth = require('../middleware/auth');
  const { encrypt, decrypt } = require('../lib/credential-encryption');

  app.post('/api/auth/mfa/setup', auth(), async (req, res) => {
    const user = ctx.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.mfaEnabled) return res.status(400).json({ error: 'MFA already enabled' });
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.username, 'Citadel', secret);
    // Store secret encrypted temporarily (not yet enabled until verified)
    // The secret is encrypted for at-rest protection
    user._pendingMfaSecret = encrypt(secret);
    res.json({ secret, otpauthUrl });
  });

  app.post('/api/auth/mfa/verify', auth(), async (req, res) => {
    const { code } = req.body;
    const user = ctx.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user._pendingMfaSecret) return res.status(400).json({ error: 'No MFA setup in progress' });

    // Decrypt the pending secret
    let decryptedSecret;
    try {
      decryptedSecret = decrypt(user._pendingMfaSecret);
    } catch (err) {
      logger.error({ err }, 'Failed to decrypt pending MFA secret');
      return res.status(500).json({ error: 'Internal error' });
    }

    const isValid = authenticator.check(String(code), decryptedSecret);
    if (!isValid) return res.status(400).json({ error: 'Invalid code — try again' });

    // Store the verified secret (encrypted)
    user.mfaSecret = encrypt(decryptedSecret);
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

  // Force password change endpoint (for users with mustChangePassword flag)
  app.post('/api/auth/change-password-forced', auth(), async (req, res) => {
    const { newPassword } = req.body;
    const user = ctx.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Validate new password
    const { checkPasswordPolicy } = require('../lib/helpers');
    if (!newPassword || !checkPasswordPolicy(newPassword)) {
      return res.status(400).json({ error: 'Password does not meet policy requirements (min 8 chars, uppercase, lowercase, number, special char).' });
    }

    // Update password and clear the flag
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.mustChangePassword = false;
    const { saveJSON } = require('../lib/data-store');
    saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users);

    // Invalidate all existing sessions for this user so old tokens can't be reused
    const { revokeUserTokens } = require('../lib/token-revocation');
    revokeUserTokens(user.id, 'password.changed');

    addAudit(user.id, user.username, 'password.force-change', 'User changed forced password (all sessions invalidated)');
    res.json({ message: 'Password changed successfully. Please log in again.' });
  });
};
