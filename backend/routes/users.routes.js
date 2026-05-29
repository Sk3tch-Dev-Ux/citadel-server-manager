/**
 * User CRUD routes.
 */
const { v4: uuid } = require('uuid');
// Audit N5: bcryptjs → @node-rs/bcrypt (hash-compatible, prebuilt native).
const bcrypt = require('@node-rs/bcrypt');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { checkPasswordPolicy } = require('../lib/helpers');
const { validate } = require('../lib/request-validator');
const { addAudit } = require('../lib/audit');
const { revokeUserTokens } = require('../lib/token-revocation');
const auth = require('../middleware/auth');

/**
 * Audit M13. Decide whether the requesting user can act on OTHER users.
 *
 * The previous check was `req.user.role !== 'admin'` — a literal role-id
 * compare. That works today because the built-in admin role's id is
 * 'admin', but it silently breaks if an operator creates a custom role
 * with users.manage + a different id. The intent is "the actor has
 * privileged user management" — express it that way: roles with
 * wildcard ('*') permissions act on others; everyone else can only
 * touch their own row even if they happen to hold users.manage for
 * self-service password changes.
 */
function canManageOthers(reqUser) {
  if (!reqUser) return false;
  const role = ctx.roles.find(r => r.id === reqUser.role);
  if (!role || !Array.isArray(role.permissions)) return false;
  return role.permissions.includes('*');
}

module.exports = function(app) {
  app.get('/api/users', auth('users.manage'), (req, res) => {
    res.json(ctx.users.map(u => ({ id: u.id, username: u.username, role: u.role, isRoot: u.isRoot || false, description: u.description || '', createdAt: u.createdAt })));
  });

  app.post('/api/users',
    auth('users.manage'),
    validate({
      username: { type: 'string', required: true, minLength: 3, maxLength: 32, pattern: /^[a-zA-Z0-9_]+$/ },
      password: { type: 'string', required: true, minLength: 8 },
      role: { type: 'string' },
      description: { type: 'string', maxLength: 128 },
      mfaEnabled: { type: 'boolean' },
    }),
    async (req, res) => {
    const { username, password, role, description, mfaEnabled } = req.body;
    if (ctx.users.find(u => u.username === username)) return res.status(400).json({ error: 'Username already exists' });
    if (!checkPasswordPolicy(password)) {
      return res.status(400).json({ error: 'Password does not meet policy requirements.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = { id: uuid(), username, passwordHash: hash, role: role || 'viewer', description: description || '', createdAt: new Date().toISOString(), mfaEnabled: !!mfaEnabled };
    ctx.users.push(user);
    saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users.map(u => ({ ...u })));
    addAudit(req.user.id, req.user.username, 'user.create', `Created user: ${username}`);
    res.json({ id: user.id, username: user.username, role: user.role });
  });

  app.patch('/api/users/:id', auth('users.manage'), async (req, res) => {
    const user = ctx.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isRoot) return res.status(403).json({ error: 'Cannot modify root user' });

    // Prevent non-admin users from modifying other users (MUST be checked before mutations)
    if (req.user.id !== req.params.id && !canManageOthers(req.user)) {
      return res.status(403).json({ error: 'You can only modify your own account' });
    }

    // Validate input fields
    if (req.body.username !== undefined) {
      if (typeof req.body.username !== 'string') return res.status(400).json({ error: 'Username must be a string' });
      if (req.body.username.length < 3 || req.body.username.length > 32) return res.status(400).json({ error: 'Username must be 3-32 characters' });
      if (!/^[a-zA-Z0-9_]+$/.test(req.body.username)) return res.status(400).json({ error: 'Username must contain only alphanumeric characters and underscores' });
      // Check for duplicates
      if (ctx.users.some(u => u.id !== user.id && u.username === req.body.username)) {
        return res.status(400).json({ error: 'Username already exists' });
      }
      user.username = req.body.username;
    }

    if (req.body.role !== undefined) {
      if (typeof req.body.role !== 'string') return res.status(400).json({ error: 'Role must be a string' });
      // Validate role exists
      if (!ctx.roles.find(r => r.id === req.body.role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      // Prevent non-admin users from escalating their own role.
      // (canManageOthers stays the gate even though the targeted row is
      // self — the rule is "only wildcard roles can hand out roles".)
      if (req.user.id === req.params.id && !canManageOthers(req.user)) {
        return res.status(403).json({ error: 'Users cannot change their own role' });
      }
      user.role = req.body.role;
    }

    if (req.body.description !== undefined) {
      if (typeof req.body.description !== 'string') return res.status(400).json({ error: 'Description must be a string' });
      if (req.body.description.length > 256) return res.status(400).json({ error: 'Description must be 256 characters or less' });
      user.description = req.body.description;
    }

    if (req.body.password !== undefined) {
      if (typeof req.body.password !== 'string') return res.status(400).json({ error: 'Password must be a string' });
      if (!checkPasswordPolicy(req.body.password)) {
        return res.status(400).json({ error: 'Password does not meet policy requirements (min 8 chars, uppercase, lowercase, number, special char).' });
      }
      user.passwordHash = await bcrypt.hash(req.body.password, 10);
      // Invalidate existing sessions when password changes
      const { revokeUserTokens } = require('../lib/token-revocation');
      revokeUserTokens(user.id, 'password.changed.by.admin');
    }

    saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users.map(u => ({ ...u })));
    addAudit(req.user.id, req.user.username, 'user.update', `Updated user: ${user.username}`);
    res.json({ id: user.id, username: user.username, role: user.role });
  });

  app.delete('/api/users/:id', auth('users.manage'), (req, res) => {
    const user = ctx.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isRoot) return res.status(403).json({ error: 'Cannot delete root user' });

    // Revoke all active tokens for this user
    revokeUserTokens(req.params.id, 'user.deleted');

    ctx.users = ctx.users.filter(u => u.id !== req.params.id);
    saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users.map(u => ({ ...u })));
    addAudit(req.user.id, req.user.username, 'user.delete', `Deleted user: ${user.username}`);
    res.json({ message: 'User deleted' });
  });
};
