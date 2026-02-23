/**
 * JWT authentication middleware factory.
 * Optionally checks role-based permissions.
 */
const jwt = require('jsonwebtoken');
const ctx = require('../lib/context');

function auth(requiredPermission) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      const decoded = jwt.verify(token, ctx.CONFIG.jwtSecret);
      req.user = decoded;
      if (requiredPermission) {
        const user = ctx.users.find(u => u.id === decoded.id);
        if (!user) return res.status(401).json({ error: 'User not found' });
        const role = ctx.roles.find(r => r.id === user.role);
        if (!role) return res.status(403).json({ error: 'Role not found' });
        if (!role.permissions.includes('*') && !role.permissions.includes(requiredPermission)) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

module.exports = auth;
