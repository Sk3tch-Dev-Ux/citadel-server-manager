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

/**
 * Audit M11 — extract the JWT from either:
 *   - the HttpOnly 'auth-token' cookie (preferred — XSS can't read it), or
 *   - the Authorization: Bearer header (fallback for the desktop app and
 *     any custom client that explicitly opts into Bearer).
 *
 * Cookie wins when both are present (a logged-in browser session
 * shouldn't be impersonatable by a stale Bearer token in the same
 * request). Returns null if neither is present.
 */
function extractToken(req) {
  if (req.cookies && typeof req.cookies['auth-token'] === 'string' && req.cookies['auth-token']) {
    return req.cookies['auth-token'];
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token) return token;
  }
  return null;
}

/**
 * Returns true if `role` satisfies `requiredPermission`.
 * Accepts either a single permission string or an array of permissions
 * (treated as "any-of" — the role needs at least one). The '*' wildcard
 * always satisfies. Passing an array used to silently fail because
 * Array.prototype.includes did a strict-equality scan for the array
 * object itself, so array-form callers only passed for literal '*' roles.
 */
function roleHasPermission(role, requiredPermission) {
  if (!requiredPermission) return true;
  if (role.permissions.includes('*')) return true;
  const needed = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
  return needed.some(p => role.permissions.includes(p));
}

/**
 * Per-user-per-minute coalesce window for access-denied audit events.
 *
 * The RBAC chokepoint is a tempting place to bury detection — but a client
 * hammering a forbidden route (a scanner, a misconfigured integration, a
 * probing attacker) must not be able to flood audit.json and rotate the real
 * signal out of the rolling buffer. We therefore write at most one
 * access.denied row per (userId, minute); further denials in the same window
 * are counted but not persisted, capping the audit write rate.
 */
const DENIAL_AUDIT_WINDOW_MS = 60 * 1000;
const _denialWindows = new Map(); // key: `${userId}:${minuteBucket}` => hit count

function auditAccessDenied(decoded, req, permission, reason) {
  try {
    const userId = decoded?.id || 'unknown';
    const bucket = Math.floor(Date.now() / DENIAL_AUDIT_WINDOW_MS);
    const key = `${userId}:${bucket}`;
    const hits = (_denialWindows.get(key) || 0) + 1;
    _denialWindows.set(key, hits);

    // Opportunistic GC of stale buckets so a churn of distinct users can't grow
    // the map unbounded between requests.
    if (_denialWindows.size > 1000) {
      for (const k of _denialWindows.keys()) {
        if (k.endsWith(`:${bucket}`)) continue;
        _denialWindows.delete(k);
      }
    }

    // Only the first denial in each (user, minute) window writes a row; later
    // hits in the same window are coalesced away, capping the audit write rate
    // at one row per user per minute regardless of how hard a client hammers.
    if (hits > 1) return;

    // Lazy-require to avoid the audit ⇄ middleware require cycle (pattern from
    // discord.routes.js). Best-effort: an audit failure must never block the
    // 403 response.
    const { addAudit } = require('../lib/audit');
    addAudit(userId, decoded?.username, 'access.denied', {
      permission,
      serverId: req.params?.id,
      path: req.originalUrl,
      method: req.method,
      reason,
    });
  } catch { /* best-effort — never block the denial response */ }
}

function auth(requiredPermission) {
  return (req, res, next) => {
    const token = extractToken(req);
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
        if (!role) {
          auditAccessDenied(decoded, req, requiredPermission, 'role-not-found');
          return res.status(403).json({ error: 'Role not found' });
        }
        if (!roleHasPermission(role, requiredPermission)) {
          auditAccessDenied(decoded, req, requiredPermission, 'insufficient-permissions');
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
    const token = extractToken(req);
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
      if (!role) {
        auditAccessDenied(decoded, req, requiredPermission, 'role-not-found');
        return res.status(403).json({ error: 'Role not found' });
      }

      // Check permission (supports a single string or an "any-of" array)
      const isWildcard = role.permissions.includes('*');
      if (!roleHasPermission(role, requiredPermission)) {
        auditAccessDenied(decoded, req, requiredPermission, 'insufficient-permissions');
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // Server scope check — wildcard roles bypass scope
      if (!isWildcard) {
        const serverId = req.params.id;
        if (serverId && Array.isArray(role.serverScope) && role.serverScope.length > 0) {
          if (!role.serverScope.includes(serverId)) {
            auditAccessDenied(decoded, req, requiredPermission, 'server-scope-denied');
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
// Exported for unit testing the any-of permission contract (Audit C3 regression).
module.exports.roleHasPermission = roleHasPermission;
