const { safeError, clientError } = require('../lib/http-errors');
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
const { isConfigFile, redactConfigSecrets, restoreRedactedSecrets } = require('../lib/config-secrets');

// Whitelist of safe file extensions for writing
const SAFE_WRITE_EXTENSIONS = new Set([
  '.cfg', '.config',      // DayZ config files
  '.xml',                 // XML configs
  '.json',                // JSON configs
  '.ini', '.txt',         // Text configs
  '.c', '.h', '.cpp', '.hpp', // Source code (read-only in editor; .js.bak typo
                              // removed — path.extname() returns '.bak' for
                              // foo.js.bak so the entry never matched anyway).
  '.bat', '.cmd', '.ps1', // Batch scripts — gated by files.edit-scripts +
  '.sh',                  // lifecycle_hooks/ path constraint, see below.
  '.md', '.log'           // Documentation
]);

// Audit H8. Subset of SAFE_WRITE_EXTENSIONS that is auto-executed by
// lib/lifecycle-hooks.js when placed under installDir/lifecycle_hooks/.
// A user with plain 'files.edit' permission can write any other allowed
// file (.cfg, .xml, .json, etc.) but writing one of these is privilege
// escalation — they end up running as the backend's process identity
// (typically LOCAL SYSTEM under NSSM). So we additionally require:
//   1. The user's role grants 'files.edit-scripts' (or '*').
//   2. The destination path is inside the server's lifecycle_hooks/ dir.
// Both checks must pass; otherwise the write is refused with a 403.
const SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd', '.ps1', '.sh']);
const HOOKS_DIRNAME = 'lifecycle_hooks';

// Maximum file size for writes (10 MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Look up a user's resolved permission set. Returns true if they have '*'
 * or the specific permission. Mirrors the lookup pattern in
 * middleware/auth.js so we don't duplicate role-resolution logic that
 * could drift.
 */
function userHasPermission(userId, perm) {
  const user = ctx.users.find(u => u.id === userId);
  if (!user) return false;
  const role = ctx.roles.find(r => r.id === user.role);
  if (!role || !Array.isArray(role.permissions)) return false;
  return role.permissions.includes('*') || role.permissions.includes(perm);
}

/**
 * Is a resolved (already safePath-validated) absolute file path inside
 * the server's lifecycle_hooks directory? Compare on lower-cased prefix
 * with the OS separator so 'lifecycle_hooks_evil/foo.ps1' can't sneak in
 * as a sibling-prefix. (Same shape as the audit C2 fix to safePath.)
 */
function isInsideLifecycleHooks(installDir, resolvedPath) {
  const hooksDir = path.join(installDir, HOOKS_DIRNAME);
  // Use path.sep to match safePath()'s comparison style on the host. The
  // resolvedPath returned by safePath() always uses native separators.
  const prefix = hooksDir.endsWith(path.sep) ? hooksDir : hooksDir + path.sep;
  return resolvedPath === hooksDir
    || resolvedPath.toLowerCase().startsWith(prefix.toLowerCase());
}

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
      let content = fs.readFileSync(filePath, 'utf8');
      // Redact plaintext secrets (BattlEye RConPassword, serverDZ password/
      // passwordAdmin) in .cfg reads so files.edit holders can't recover the
      // RCON password the servers API deliberately strips. The write path
      // (restoreRedactedSecrets) restores the on-disk value when a masked line
      // is saved back unchanged, so editing the file still works.
      if (isConfigFile(filePath)) content = redactConfigSecrets(content);
      res.json({ content, path: file, size: stat.size, modified: stat.mtimeMs });
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
      return clientError(res, 400, `File extension "${ext}" is not allowed.`, {
        code: 'EXTENSION_BLOCKED',
        suggestion: `Allowed extensions: ${Array.from(SAFE_WRITE_EXTENSIONS).join(', ')}. To edit a binary file, do it on the server filesystem directly.`,
      });
    }

    // Check file size
    if (content.length > MAX_FILE_SIZE) {
      return clientError(res, 400, `File is too large (limit ${MAX_FILE_SIZE / 1024 / 1024}MB).`, {
        code: 'FILE_TOO_LARGE',
        suggestion: 'Split the file or use a different editing flow (RDP / SSH) for files over this size.',
      });
    }

    const filePath = safePath(srv.installDir, file);
    if (!filePath) return clientError(res, 403, 'That path is outside the server install directory.', {
      code: 'PATH_TRAVERSAL_BLOCKED',
      suggestion: 'Use a relative path under the server\'s install root.',
    });

    // Audit H8 — script gate. Writing an auto-executed script
    // (.bat / .cmd / .ps1 / .sh) is privilege escalation: the file gets
    // run as the backend's process identity (typically LOCAL SYSTEM under
    // NSSM) by lib/lifecycle-hooks.js. Two extra checks beyond plain
    // files.edit:
    //   1. Role must grant files.edit-scripts (or wildcard '*').
    //   2. The destination MUST resolve inside <installDir>/lifecycle_hooks/.
    // Both are required; either alone is not sufficient.
    if (SCRIPT_EXTENSIONS.has(ext)) {
      if (!userHasPermission(req.user.id, 'files.edit-scripts')) {
        logger.warn({ userId: req.user.id, file, ext }, 'Script write denied — missing files.edit-scripts');
        addAudit(req.user.id, req.user.username, 'file.write-blocked',
          `Blocked script write to ${file} (extension ${ext}, role lacks files.edit-scripts)`);
        return clientError(res, 403, `Writing ${ext} files requires the 'files.edit-scripts' permission.`, {
          code: 'PERMISSION_DENIED',
          suggestion: 'Ask an admin to grant your role files.edit-scripts in Settings → Users & Roles.',
        });
      }
      if (!isInsideLifecycleHooks(srv.installDir, filePath)) {
        logger.warn({ userId: req.user.id, file, resolved: filePath }, 'Script write denied — outside lifecycle_hooks/');
        addAudit(req.user.id, req.user.username, 'file.write-blocked',
          `Blocked script write to ${file} (extension ${ext}, outside lifecycle_hooks/)`);
        return clientError(res, 403, `${ext} files must live inside lifecycle_hooks/.`, {
          code: 'SCRIPT_OUTSIDE_HOOKS',
          suggestion: 'Place this file under <serverDir>/lifecycle_hooks/ to opt in to auto-execution by the hook system.',
        });
      }
    }

    try {
      const bd = path.join(srv.installDir, '.backups');
      if (!fs.existsSync(bd)) fs.mkdirSync(bd, { recursive: true });
      const existed = fs.existsSync(filePath);
      if (existed) fs.copyFileSync(filePath, path.join(bd, `${path.basename(file)}.${Date.now()}.bak`));
      // For config files, a secret line saved back with the redaction mask (the
      // value the editor was shown on read) must NOT clobber the real on-disk
      // password — restore it from the existing file. A genuinely new value is
      // kept, so passwords can still be changed.
      let toWrite = content;
      if (isConfigFile(filePath) && existed) {
        const onDisk = fs.readFileSync(filePath, 'utf8');
        toWrite = restoreRedactedSecrets(content, onDisk);
      }
      fs.writeFileSync(filePath, toWrite);
      // Differentiate audit entries so a security-minded operator can grep
      // their audit log for script writes specifically.
      const action = SCRIPT_EXTENSIONS.has(ext) ? 'file.edit-script' : 'file.edit';
      addAudit(req.user.id, req.user.username, action, `Edited ${file} on ${srv.name}`);
      res.json({ message: 'Saved' });
    } catch (err) {
      logger.error({ err, file }, 'File write error');
      safeError(err, req, res, { status: 500 });
    }
  });
};
