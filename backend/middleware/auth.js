/**
 * JWT authentication middleware factory.
 * Optionally checks role-based permissions.
 * Always verifies the user still exists (prevents deleted-user tokens).
 * Checks token revocation status to prevent use of invalidated tokens.
 */
const jwt = require('jsonwebtoken');
const ctx = require('../lib/context');
const logger = require('../lib/logger');
const { isTokenRevoked } = require('../lib/token-revocation');

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

      // Check if token has been revoked (user deleted, forced logout, etc.)
      if (isTokenRevoked(decoded)) {
        return res.status(401).json({ error: 'Token has been revoked' });
      }

      // Always verify the user still exists (covers deleted/disabled accounts)
      const user = ctx.users.find(u => u.id === decoded.id);
      if (!user) return res.status(401).json({ error: 'User no longer exists' });
      // Use fresh role and mustChangePassword from database, not stale JWT claims
      req.user = { ...decoded, role: user.role, mustChangePassword: !!user.mustChangePassword };

      // Block all API calls if user must change password (except password change endpoint)
      if (user.mustChangePassword && !req.path.includes('/api/auth/change-password-forced')) {
        return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
      }

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

/**
 * Server-scoped permission middleware factory.
 * Like auth(permission) but additionally checks if the user's role
 * has access to the specific server identified by req.params.id.
 *
 * - If the role has an empty/undefined/null serverScope, all servers are accessible (backward compatible).
 * - If the role has a non-empty serverScope array, the serverId must be in that array.
 * - Roles with '*' (wildcard) permission always bypass server scope checks.
 */
function authForServer(requiredPermission) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      const decoded = jwt.verify(token, ctx.CONFIG.jwtSecret);

      // Check if token has been revoked (user deleted, forced logout, etc.)
      if (isTokenRevoked(decoded)) {
        return res.status(401).json({ error: 'Token has been revoked' });
      }

      const user = ctx.users.find(u => u.id === decoded.id);
      if (!user) return res.status(401).json({ error: 'User no longer exists' });
      req.user = { ...decoded, role: user.role, mustChangePassword: !!user.mustChangePassword };

      // Block all API calls if user must change password (except password change endpoint)
      if (user.mustChangePassword && !req.path.includes('/api/auth/change-password-forced')) {
        return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
      }

      const role = ctx.roles.find(r => r.id === user.role);
      if (!role) return res.status(403).json({ error: 'Role not found' });

      // Check permission
      const isWildcard = role.permissions.includes('*');
      if (requiredPermission && !isWildcard && !role.permissions.includes(requiredPermission)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // Server scope check — wildcard roles bypass scope
      if (!isWildcard) {
        const serverId = req.params.id;
        if (serverId && Array.isArray(role.serverScope) && role.serverScope.length > 0) {
          if (!role.serverScope.includes(serverId)) {
            return res.status(403).json({ error: 'Access denied: no access to this server' });
          }
        }
      }

      next();
    } catch (err) {
      logger.debug({ err: err.message }, 'JWT verification failed');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

/**
 * Helper to get the effective server scope for a user.
 * Returns null if the user has access to all servers, or an array of server IDs.
 */
function getUserServerScope(userId) {
  const user = ctx.users.find(u => u.id === userId);
  if (!user) return [];
  const role = ctx.roles.find(r => r.id === user.role);
  if (!role) return [];
  // Wildcard permissions = access to everything
  if (role.permissions.includes('*')) return null;
  // No scope restriction = access to everything
  if (!Array.isArray(role.serverScope) || role.serverScope.length === 0) return null;
  return role.serverScope;
}

module.exports = auth;
module.exports.auth = auth;
module.exports.authForServer = authForServer;
module.exports.getUserServerScope = getUserServerScope;
