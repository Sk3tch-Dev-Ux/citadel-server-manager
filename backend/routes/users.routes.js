/**
 * User CRUD routes.
 */
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { validateFields, checkPasswordPolicy } = require('../lib/helpers');
const { addAudit } = require('../lib/audit');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/users', auth('users.manage'), (req, res) => {
    res.json(ctx.users.map(u => ({ id: u.id, username: u.username, role: u.role, isRoot: u.isRoot || false, description: u.description || '', createdAt: u.createdAt })));
  });

  app.post('/api/users', auth('users.manage'), async (req, res) => {
    const { username, password, role, description, mfaEnabled } = req.body;
    const error = validateFields(req.body, {
      username: { required: true, type: 'string', minLength: 3, maxLength: 32, pattern: /^[a-zA-Z0-9_]+$/ },
      password: { required: true, type: 'string', minLength: 8 },
      role: { required: false, type: 'string' },
      description: { required: false, type: 'string', maxLength: 128 },
      mfaEnabled: { required: false, type: 'boolean' },
    });
    if (error) return res.status(400).json({ error });
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
    if (req.body.username) user.username = req.body.username;
    if (req.body.role) user.role = req.body.role;
    if (req.body.description !== undefined) user.description = req.body.description;
    if (req.body.password) user.passwordHash = await bcrypt.hash(req.body.password, 10);
    saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users.map(u => ({ ...u })));
    addAudit(req.user.id, req.user.username, 'user.update', `Updated user: ${user.username}`);
    res.json({ id: user.id, username: user.username, role: user.role });
  });

  app.delete('/api/users/:id', auth('users.manage'), (req, res) => {
    const user = ctx.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isRoot) return res.status(403).json({ error: 'Cannot delete root user' });
    ctx.users = ctx.users.filter(u => u.id !== req.params.id);
    saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users.map(u => ({ ...u })));
    addAudit(req.user.id, req.user.username, 'user.delete', `Deleted user: ${user.username}`);
    res.json({ message: 'User deleted' });
  });
};
