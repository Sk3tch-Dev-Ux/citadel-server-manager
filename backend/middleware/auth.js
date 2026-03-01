/**
 * JWT authentication middleware factory.
 * Optionally checks role-based permissions.
 * Always verifies the user still exists (prevents deleted-user tokens).
 */
const jwt = require('jsonwebtoken');
const ctx = require('../lib/context');
const logger = require('../lib/logger');

function auth(requiredPermission) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      const decoded = jwt.verify(token, ctx.CONFIG.jwtSecret);
      // Always verify the user still exists (covers deleted/disabled accounts)
      const user = ctx.users.find(u => u.id === decoded.id);
      if (!user) return res.status(401).json({ error: 'User no longer exists' });
      // Use fresh role from database, not stale JWT claim
      req.user = { ...decoded, role: user.role };
      if (requiredPermission) {
        const role = ctx.roles.find(r => r.id === user.role);
        if (!role) return res.status(403).json({ error: 'Role not found' });
        if (!role.permissions.includes('*') && !role.permissions.includes(requiredPermission)) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
      }
      next();
    } catch (err) {
      logger.debug({ err: err.message }, 'JWT verification failed');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = auth;
