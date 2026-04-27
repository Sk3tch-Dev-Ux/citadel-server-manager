/**
 * Economy Core Editor routes — CRUD for cfgeconomycore.xml.
 *
 * GET    /api/servers/:id/economycore          — read & parse economy core config
 * PUT    /api/servers/:id/economycore          — save CE folder entries (preserves classes/defaults)
 * POST   /api/servers/:id/economycore/folders   — create a CE folder on disk
 * DELETE /api/servers/:id/economycore/folders   — remove an empty CE folder from disk
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');
const { safeError } = require('../lib/http-errors');
const {
  parseEconomyCoreXml,
  buildEconomyCoreXml,
  validateFolderName,
  validateFileName,
  VALID_FILE_TYPES,
} = require('../lib/economycore-parser');

// ─── Helpers ────────────────────────────────────────────────

/** Resolve a CE folder path safely (prevents path traversal). */
function safeCeFolderPath(missionDir, folderName) {
  const resolved = path.resolve(missionDir, folderName);
  // Ensure the resolved path is still within the mission directory
  if (!resolved.startsWith(path.resolve(missionDir) + path.sep) && resolved !== path.resolve(missionDir)) {
    return null; // Path traversal attempt
  }
  return resolved;
}

/** Check folder existence + list XML files inside it. */
async function getFolderInfo(missionDir, folderName) {
  const folderPath = safeCeFolderPath(missionDir, folderName);
  if (!folderPath) return { exists: false, diskFiles: [] };

  try {
    const stat = await fsp.stat(folderPath);
    if (!stat.isDirectory()) return { exists: false, diskFiles: [] };

    const entries = await fsp.readdir(folderPath);
    const diskFiles = entries.filter(f => f.toLowerCase().endsWith('.xml')).sort();
    return { exists: true, diskFiles };
  } catch {
    return { exists: false, diskFiles: [] };
  }
}

// ─── Routes ─────────────────────────────────────────────────

module.exports = function (app) {

  /**
   * GET /api/servers/:id/economycore
   * Load and parse cfgeconomycore.xml, enriched with disk state.
   */
  app.get('/api/servers/:id/economycore', authForServer('files.edit'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    try {
      const filePath = path.join(missionDir, 'cfgeconomycore.xml');

      try {
        await fsp.access(filePath);
      } catch {
        return res.status(404).json({ error: 'cfgeconomycore.xml not found in mission folder root' });
      }

      const content = await fsp.readFile(filePath, 'utf8');
      const { folders } = parseEconomyCoreXml(content);

      // Enrich each folder with disk state (existence + file list) in parallel
      const enriched = await Promise.all(
        folders.map(async (f) => {
          const info = await getFolderInfo(missionDir, f.folder);
          return { ...f, ...info };
        })
      );

      res.json({ folders: enriched, validTypes: VALID_FILE_TYPES });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to load cfgeconomycore.xml');
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * PUT /api/servers/:id/economycore
   * Save economy core config — replaces CE folder entries, preserves <classes>/<defaults>.
   */
  app.put('/api/servers/:id/economycore', authForServer('files.edit'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { folders } = req.body;
    if (!Array.isArray(folders)) {
      return res.status(400).json({ error: 'folders array is required' });
    }

    // ── Strict validation ──────────────────────────────────
    const errors = [];
    const seenFolders = new Set();

    for (let i = 0; i < folders.length; i++) {
      const ce = folders[i];

      // Validate folder name
      const folderCheck = validateFolderName(ce.folder);
      if (!folderCheck.valid) {
        errors.push(`Folder #${i + 1}: ${folderCheck.reason}`);
        continue;
      }

      // Check for duplicates
      const normalizedFolder = ce.folder.trim().toLowerCase();
      if (seenFolders.has(normalizedFolder)) {
        errors.push(`Folder #${i + 1}: Duplicate folder name "${ce.folder}"`);
        continue;
      }
      seenFolders.add(normalizedFolder);

      // Path traversal check
      if (!safeCeFolderPath(missionDir, ce.folder.trim())) {
        errors.push(`Folder #${i + 1}: Invalid folder path`);
        continue;
      }

      if (!Array.isArray(ce.files)) {
        errors.push(`Folder "${ce.folder}": files must be an array`);
        continue;
      }

      // Validate each file entry
      const seenFiles = new Set();
      for (let j = 0; j < ce.files.length; j++) {
        const file = ce.files[j];

        const fileCheck = validateFileName(file.name);
        if (!fileCheck.valid) {
          errors.push(`Folder "${ce.folder}", file #${j + 1}: ${fileCheck.reason}`);
          continue;
        }

        if (!file.type || !VALID_FILE_TYPES.includes(file.type)) {
          errors.push(`Folder "${ce.folder}", file "${file.name}": Invalid type "${file.type}". Valid: ${VALID_FILE_TYPES.join(', ')}`);
          continue;
        }

        // Check duplicate filenames within same folder
        const fileKey = file.name.trim().toLowerCase();
        if (seenFiles.has(fileKey)) {
          errors.push(`Folder "${ce.folder}": Duplicate file "${file.name}"`);
        }
        seenFiles.add(fileKey);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    // ── Save ───────────────────────────────────────────────
    try {
      const filePath = path.join(missionDir, 'cfgeconomycore.xml');

      // Read original to preserve <classes>/<defaults>
      let rawClasses = null;
      let rawDefaults = null;
      try {
        const originalContent = await fsp.readFile(filePath, 'utf8');
        const parsed = parseEconomyCoreXml(originalContent);
        rawClasses = parsed.rawClasses;
        rawDefaults = parsed.rawDefaults;

        // Backup existing file before overwriting
        createBackup(srv.installDir, filePath, 'cfgeconomycore.xml');
      } catch {
        // File doesn't exist yet — creating fresh
      }

      // Trim values before building XML
      const cleanedFolders = folders.map(f => ({
        folder: f.folder.trim(),
        files: f.files.map(file => ({ name: file.name.trim(), type: file.type })),
      }));

      const xml = buildEconomyCoreXml(cleanedFolders, rawClasses, rawDefaults);
      await fsp.writeFile(filePath, xml, 'utf8');

      addAudit(req.user.id, req.user.username, 'economycore.update', `Updated cfgeconomycore.xml (${cleanedFolders.length} CE folders)`);
      logger.info({ serverId: srv.id, folderCount: cleanedFolders.length }, 'cfgeconomycore.xml saved');

      // Return enriched folder data
      const enriched = await Promise.all(
        cleanedFolders.map(async (f) => {
          const info = await getFolderInfo(missionDir, f.folder);
          return { ...f, ...info };
        })
      );

      res.json({ ok: true, folders: enriched });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to save cfgeconomycore.xml');
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * POST /api/servers/:id/economycore/folders
   * Create a CE folder on disk so DayZ can load files from it.
   *
   * Body: { folder: "custom_ce" }
   */
  app.post('/api/servers/:id/economycore/folders', authForServer('files.edit'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { folder } = req.body;
    const check = validateFolderName(folder);
    if (!check.valid) return res.status(400).json({ error: check.reason });

    const folderPath = safeCeFolderPath(missionDir, folder.trim());
    if (!folderPath) return res.status(400).json({ error: 'Invalid folder path' });

    try {
      await fsp.mkdir(folderPath, { recursive: true });
      addAudit(req.user.id, req.user.username, 'economycore.createFolder', `Created CE folder: ${folder.trim()}`);
      logger.info({ serverId: srv.id, folder: folder.trim() }, 'CE folder created on disk');
      res.json({ ok: true, folder: folder.trim(), exists: true });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to create CE folder');
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * DELETE /api/servers/:id/economycore/folders
   * Remove an empty CE folder from disk. Refuses if folder contains files.
   *
   * Body: { folder: "custom_ce" }
   */
  app.delete('/api/servers/:id/economycore/folders', authForServer('files.edit'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { folder } = req.body;
    const check = validateFolderName(folder);
    if (!check.valid) return res.status(400).json({ error: check.reason });

    const folderPath = safeCeFolderPath(missionDir, folder.trim());
    if (!folderPath) return res.status(400).json({ error: 'Invalid folder path' });

    try {
      const entries = await fsp.readdir(folderPath);
      if (entries.length > 0) {
        return res.status(409).json({
          error: `Cannot delete — folder contains ${entries.length} file(s). Remove files first.`,
          files: entries.slice(0, 20), // Show first 20 as hint
        });
      }
      await fsp.rmdir(folderPath);
      addAudit(req.user.id, req.user.username, 'economycore.deleteFolder', `Deleted CE folder: ${folder.trim()}`);
      logger.info({ serverId: srv.id, folder: folder.trim() }, 'CE folder deleted from disk');
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Folder does not exist on disk' });
      }
      logger.error({ err, serverId: srv.id }, 'Failed to delete CE folder');
      safeError(err, req, res, { status: 500 });
    }
  });
};
