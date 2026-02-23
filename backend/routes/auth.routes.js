/**
 * Authentication routes (login with brute-force protection).
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');

const loginAttempts = {};
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 10 * 60 * 1000; // 10 minutes

module.exports = function(app) {
  app.post('/api/auth/login', async (req, res) => {
    const { username, password, mfa } = req.body;
    const user = ctx.users.find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    // Brute-force lockout
    const now = Date.now();
    if (!loginAttempts[username]) loginAttempts[username] = { count: 0, last: 0, lockedUntil: 0 };
    if (loginAttempts[username].lockedUntil > now) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      loginAttempts[username].count++;
      loginAttempts[username].last = now;
      if (loginAttempts[username].count >= MAX_ATTEMPTS) {
        loginAttempts[username].lockedUntil = now + LOCK_TIME;
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    loginAttempts[username] = { count: 0, last: now, lockedUntil: 0 };
    // MFA placeholder
    if (user.mfaEnabled) {
      if (!mfa) return res.status(401).json({ error: 'MFA code required' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, ctx.CONFIG.jwtSecret, { expiresIn: '24h' });
    addAudit(user.id, user.username, 'login', 'User logged in');
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  });
};
