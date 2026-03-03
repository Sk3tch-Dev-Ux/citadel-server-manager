/**
 * File browser and editor routes (per server).
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { safePath } = require('../lib/helpers');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/servers/:id/files', authForServer('files.browse'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { dir } = req.query;
    const targetDir = safePath(srv.installDir, dir);
    if (!targetDir) return res.status(403).json({ error: 'Access denied' });
    // Normalize basePath — can't use realpathSync on remote Windows paths from macOS
    const isRemoteWindows = /^[A-Za-z]:[\\/]/.test(srv.installDir) && process.platform !== 'win32';
    const basePath = isRemoteWindows ? srv.installDir.replace(/\\/g, '/') : fs.realpathSync(srv.installDir);
    try {
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const results = entries.map(e => {
        const fullPath = path.join(targetDir, e.name);
        let size = 0, modified = 0;
        try { const s = fs.statSync(fullPath); size = s.size; modified = s.mtimeMs; } catch {}
        return { name: e.name, type: e.isDirectory() ? 'directory' : 'file', path: path.relative(basePath, fullPath).replace(/\\/g, '/'), size, modified };
      });
      results.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      res.json(results);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/servers/:id/files/read', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'File path required' });
    const filePath = safePath(srv.installDir, file);
    if (!filePath) return res.status(403).json({ error: 'Access denied' });
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large' });
      const binaryExts = ['.exe','.dll','.pdb','.pbo','.pak','.bin','.so','.png','.jpg','.jpeg','.gif','.bmp','.ico','.wav','.ogg','.mp3','.zip','.rar','.7z','.bikey','.bisign'];
      if (binaryExts.includes(path.extname(filePath).toLowerCase())) return res.status(400).json({ error: 'Binary file' });
      res.json({ content: fs.readFileSync(filePath, 'utf8'), path: file, size: stat.size, modified: stat.mtimeMs });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/servers/:id/files/write', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { file, content } = req.body;
    if (!file) return res.status(400).json({ error: 'File path required' });
    const filePath = safePath(srv.installDir, file);
    if (!filePath) return res.status(403).json({ error: 'Access denied' });
    try {
      const bd = path.join(srv.installDir, '.backups');
      if (!fs.existsSync(bd)) fs.mkdirSync(bd, { recursive: true });
      if (fs.existsSync(filePath)) fs.copyFileSync(filePath, path.join(bd, `${path.basename(file)}.${Date.now()}.bak`));
      fs.writeFileSync(filePath, content);
      addAudit(req.user.id, req.user.username, 'file.edit', `Edited ${file} on ${srv.name}`);
      res.json({ message: 'Saved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
