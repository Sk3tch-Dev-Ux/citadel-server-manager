/**
 * Backup routes — Config backup/restore + Game file backup management.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { addAudit } = require('../lib/audit');
const auth = require('../middleware/auth');
const { safePath } = require('../lib/helpers');
const {
  createBackup, listBackups, deleteBackup,
  getBackupConfig, saveBackupConfig, DEFAULT_CONFIG,
} = require('../lib/backup-engine');

module.exports = function (app) {

  // ════════════════════════════════════════════════════════
  // Config backup/restore (existing functionality)
  // ════════════════════════════════════════════════════════

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

  // ════════════════════════════════════════════════════════
  // Game file backup settings & management
  // ════════════════════════════════════════════════════════

  // ─── Get backup config ─────────────────────────────────
  app.get('/api/servers/:id/backup-config', auth(), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    res.json(getBackupConfig(req.params.id));
  });

  // ─── Update backup config ─────────────────────────────
  app.put('/api/servers/:id/backup-config', auth('server.restart'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { enabled, backupAtStartup, intervalMinutes, maxKeepDays, paths } = req.body;

    const config = { ...DEFAULT_CONFIG };
    if (enabled !== undefined) config.enabled = !!enabled;
    if (backupAtStartup !== undefined) config.backupAtStartup = !!backupAtStartup;
    if (intervalMinutes !== undefined) config.intervalMinutes = Math.max(5, Math.min(1440, parseInt(intervalMinutes, 10) || 60));
    if (maxKeepDays !== undefined) config.maxKeepDays = Math.max(1, Math.min(90, parseInt(maxKeepDays, 10) || 7));

    if (Array.isArray(paths)) {
      const validPaths = [];
      for (const p of paths.slice(0, 20)) {
        if (typeof p !== 'string') continue;
        const trimmed = p.trim().replace(/\\/g, '/');
        if (!trimmed || trimmed.includes('..') || path.isAbsolute(trimmed)) continue;
        validPaths.push(trimmed);
      }
      config.paths = validPaths;
    }

    // Preserve lastBackupAt from existing config
    const existing = getBackupConfig(req.params.id);
    config.lastBackupAt = existing.lastBackupAt || null;

    saveBackupConfig(req.params.id, config);
    addAudit(req.user?.id || 'system', req.user?.username || 'system', 'backup.config', `Updated backup config for server ${req.params.id}`);
    res.json(config);
  });

  // ─── List all backups ──────────────────────────────────
  app.get('/api/servers/:id/backups', auth(), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    res.json(listBackups(req.params.id));
  });

  // ─── Trigger manual backup ─────────────────────────────
  app.post('/api/servers/:id/backups', auth('server.restart'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
      const result = await createBackup(req.params.id, 'manual');
      if (!result) return res.status(500).json({ error: 'Backup failed — check server logs' });
      addAudit(req.user?.id || 'system', req.user?.username || 'system', 'backup.manual', `Manual backup on server ${srv.name}`);
      res.json({ message: 'Backup created', ...result });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Backup failed' });
    }
  });

  // ─── Delete a backup ───────────────────────────────────
  app.delete('/api/servers/:id/backups/:filename', auth('server.restart'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const type = req.query.type || 'manual';
    if (!['automated', 'manual'].includes(type)) return res.status(400).json({ error: 'Invalid backup type' });

    const success = deleteBackup(req.params.id, req.params.filename, type);
    if (!success) return res.status(404).json({ error: 'Backup not found or could not be deleted' });

    addAudit(req.user?.id || 'system', req.user?.username || 'system', 'backup.delete', `Deleted backup ${req.params.filename}`);
    res.json({ message: 'Deleted' });
  });

  // ─── Download a backup ─────────────────────────────────
  app.get('/api/servers/:id/backups/:filename/download', (req, res, next) => {
    // Allow token in query param for browser window.open() downloads
    if (req.query.token && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
  }, auth('server.restart'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const type = req.query.type || 'manual';
    if (!['automated', 'manual'].includes(type)) return res.status(400).json({ error: 'Invalid backup type' });

    const backupsRoot = path.join(srv.installDir, '.backups', type);
    const fullPath = safePath(backupsRoot, req.params.filename);
    if (!fullPath || !fs.existsSync(fullPath)) return res.status(404).json({ error: 'Backup file not found' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    fs.createReadStream(fullPath).pipe(res);
  });
};
