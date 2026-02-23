/**
 * Backup and restore routes.
 */
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { addAudit } = require('../lib/audit');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/backup/:type', auth('admin'), (req, res) => {
    const { type } = req.params;
    let data, filename;
    switch (type) {
      case 'servers': data = ctx.servers; filename = 'servers-backup.json'; break;
      case 'users': data = ctx.users; filename = 'users-backup.json'; break;
      case 'roles': data = ctx.roles; filename = 'roles-backup.json'; break;
      case 'webhooks': data = ctx.webhooks; filename = 'webhooks-backup.json'; break;
      default: return res.status(400).json({ error: 'Invalid backup type' });
    }
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  });

  app.post('/api/restore/:type', auth('admin'), (req, res) => {
    const { type } = req.params;
    const { data } = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ error: 'Data must be an array' });
    if (data.length > 1000) return res.status(400).json({ error: 'Restore data exceeds maximum size (1000 entries)' });
    const allowedTypes = ['servers', 'users', 'roles', 'webhooks'];
    if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Invalid restore type' });
    if (!data.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
      return res.status(400).json({ error: 'Each entry must be a valid object' });
    }
    switch (type) {
      case 'servers': ctx.servers = data; saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers); break;
      case 'users': ctx.users = data; saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users.map(u => ({ ...u }))); break;
      case 'roles': ctx.roles = data; saveJSON(ctx.CONFIG.dataDir, 'roles.json', ctx.roles); break;
      case 'webhooks': ctx.webhooks = data; saveJSON(ctx.CONFIG.dataDir, 'webhooks.json', ctx.webhooks); break;
    }
    addAudit(req.user.id, req.user.username, 'backup.restore', `Restored ${type} from backup`);
    res.json({ message: `Restored ${type}` });
  });
};
