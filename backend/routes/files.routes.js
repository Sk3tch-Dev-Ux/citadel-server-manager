const { safeError } = require('../lib/http-errors');
/**
 * File browser and editor routes (per server).
 *
 * SECURITY: Enforces a whitelist of safe file extensions for writing.
 * Prevents execution of dangerous files (.exe, .dll, .js, .html, etc.)
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { safePath } = require('../lib/helpers');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');

// Whitelist of safe file extensions for writing
const SAFE_WRITE_EXTENSIONS = new Set([
  '.cfg', '.config',      // DayZ config files
  '.xml',                 // XML configs
  '.json',                // JSON configs
  '.ini', '.txt',         // Text configs
  '.c', '.h', '.cpp', '.hpp', '.js.bak', // Source code (read-only in editor)
  '.bat', '.cmd', '.ps1', // Batch scripts (dangerous, but sometimes needed)
  '.sh',                  // Shell scripts
  '.md', '.log'           // Documentation
]);

// Maximum file size for writes (10 MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

module.exports = function(app) {
  app.get('/api/servers/:id/files', authForServer('files.browse'), async (req, res) => {
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
      // Parallelize stat calls rather than blocking per-entry. Also skip stat
      // entirely for directories (size doesn't matter for listing) — cheap win
      // on mods folders with 50+ entries.
      const results = await Promise.all(entries.map(async (e) => {
        const fullPath = path.join(targetDir, e.name);
        const isDir = e.isDirectory();
        let size = 0, modified = 0;
        if (!isDir) {
          try {
            const s = await fs.promises.stat(fullPath);
            size = s.size;
            modified = s.mtimeMs;
          } catch { /* unreadable — report zero */ }
        }
        return {
          name: e.name,
          type: isDir ? 'directory' : 'file',
          path: path.relative(basePath, fullPath).replace(/\\/g, '/'),
          size,
          modified,
        };
      }));
      results.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      res.json(results);
    } catch (err) { safeError(err, req, res, { status: 500 }); }
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
    } catch (err) { safeError(err, req, res, { status: 500 }); }
  });

  app.put('/api/servers/:id/files/write', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { file, content } = req.body;
    if (!file) return res.status(400).json({ error: 'File path required' });
    if (!content || typeof content !== 'string') return res.status(400).json({ error: 'Content must be a string' });

    // Check file extension against whitelist
    const ext = path.extname(file).toLowerCase();
    if (!SAFE_WRITE_EXTENSIONS.has(ext)) {
      logger.warn({ userId: req.user.id, file, ext }, 'Attempted write to file with unsafe extension');
      addAudit(req.user.id, req.user.username, 'file.write-blocked', `Blocked write to ${file} (unsafe extension: ${ext})`);
      return res.status(400).json({ error: `File extension "${ext}" is not allowed. Allowed: ${Array.from(SAFE_WRITE_EXTENSIONS).join(', ')}` });
    }

    // Check file size
    if (content.length > MAX_FILE_SIZE) {
      return res.status(400).json({ error: `File content exceeds maximum size (${MAX_FILE_SIZE / 1024 / 1024}MB)` });
    }

    const filePath = safePath(srv.installDir, file);
    if (!filePath) return res.status(403).json({ error: 'Access denied' });
    try {
      const bd = path.join(srv.installDir, '.backups');
      if (!fs.existsSync(bd)) fs.mkdirSync(bd, { recursive: true });
      if (fs.existsSync(filePath)) fs.copyFileSync(filePath, path.join(bd, `${path.basename(file)}.${Date.now()}.bak`));
      fs.writeFileSync(filePath, content);
      addAudit(req.user.id, req.user.username, 'file.edit', `Edited ${file} on ${srv.name}`);
      res.json({ message: 'Saved' });
    } catch (err) {
      logger.error({ err, file }, 'File write error');
      safeError(err, req, res, { status: 500 });
    }
  });
};
