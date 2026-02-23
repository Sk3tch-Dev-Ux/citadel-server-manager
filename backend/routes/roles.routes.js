/**
 * Role CRUD routes.
 */
const { v4: uuid } = require('uuid');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { addAudit } = require('../lib/audit');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/roles', auth(), (req, res) => { res.json(ctx.roles); });

  app.post('/api/roles', auth('users.manage'), (req, res) => {
    const { name, permissions, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const role = { id: uuid(), name, permissions: permissions || [], color: color || '#8b919a', builtIn: false };
    ctx.roles.push(role);
    saveJSON(ctx.CONFIG.dataDir, 'roles.json', ctx.roles);
    addAudit(req.user.id, req.user.username, 'role.create', `Created role: ${name}`);
    res.json(role);
  });

  app.patch('/api/roles/:id', auth('users.manage'), (req, res) => {
    const role = ctx.roles.find(r => r.id === req.params.id);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.builtIn && req.body.name) return res.status(403).json({ error: 'Cannot rename built-in role' });
    if (req.body.permissions) role.permissions = req.body.permissions;
    if (req.body.color) role.color = req.body.color;
    if (req.body.name && !role.builtIn) role.name = req.body.name;
    saveJSON(ctx.CONFIG.dataDir, 'roles.json', ctx.roles);
    res.json(role);
  });

  app.delete('/api/roles/:id', auth('users.manage'), (req, res) => {
    const role = ctx.roles.find(r => r.id === req.params.id);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.builtIn) return res.status(403).json({ error: 'Cannot delete built-in role' });
    ctx.roles = ctx.roles.filter(r => r.id !== req.params.id);
    saveJSON(ctx.CONFIG.dataDir, 'roles.json', ctx.roles);
    res.json({ message: 'Role deleted' });
  });
};
