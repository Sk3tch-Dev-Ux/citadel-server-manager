/**
 * Economy Core Editor routes — CRUD for cfgeconomycore.xml.
 *
 * GET    /api/servers/:id/economycore              — read & parse economy core config
 * PUT    /api/servers/:id/economycore              — save CE folder entries (auto-creates folders on disk)
 * POST   /api/servers/:id/economycore/folders       — create a CE folder on disk
 * DELETE /api/servers/:id/economycore/folders       — remove an empty CE folder from disk
 * POST   /api/servers/:id/economycore/upload        — upload XML file(s) into a CE folder
 * GET    /api/servers/:id/economycore/folders/files — list XML files in a CE folder on disk
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

// ── Max upload size (2MB per file — XML configs are small) ──
const MAX_FILE_SIZE = 2 * 1024 * 1024;

// ─── Helpers ────────────────────────────────────────────────

/** Resolve a CE folder path safely (prevents path traversal). */
function safeCeFolderPath(missionDir, folderName) {
  const resolved = path.resolve(missionDir, folderName);
  const missionResolved = path.resolve(missionDir);
  // Ensure the resolved path is still within the mission directory
  if (!resolved.startsWith(missionResolved + path.sep) && resolved !== missionResolved) {
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

/** Ensure a CE folder exists on disk, create it if not. Returns true if created. */
async function ensureCeFolder(missionDir, folderName) {
  const folderPath = safeCeFolderPath(missionDir, folderName);
  if (!folderPath) return false;

  try {
    await fsp.access(folderPath);
    return false; // Already exists
  } catch {
    await fsp.mkdir(folderPath, { recursive: true });
    return true; // Created
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

      res.json({ folders: enriched, validTypes: VALID_FILE_TYPES, missionDir: path.basename(path.resolve(missionDir)) });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to load cfgeconomycore.xml');
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * PUT /api/servers/:id/economycore
   * Save economy core config — replaces CE folder entries, preserves <classes>/<defaults>.
   * AUTO-CREATES folders on disk that don't exist yet.
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

      const folderCheck = validateFolderName(ce.folder);
      if (!folderCheck.valid) {
        errors.push(`Folder #${i + 1}: ${folderCheck.reason}`);
        continue;
      }

      const normalizedFolder = ce.folder.trim().toLowerCase();
      if (seenFolders.has(normalizedFolder)) {
        errors.push(`Folder #${i + 1}: Duplicate folder name "${ce.folder}"`);
        continue;
      }
      seenFolders.add(normalizedFolder);

      if (!safeCeFolderPath(missionDir, ce.folder.trim())) {
        errors.push(`Folder #${i + 1}: Invalid folder path`);
        continue;
      }

      if (!Array.isArray(ce.files)) {
        errors.push(`Folder "${ce.folder}": files must be an array`);
        continue;
      }

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

      // Trim values
      const cleanedFolders = folders.map(f => ({
        folder: f.folder.trim(),
        files: f.files.map(file => ({ name: file.name.trim(), type: file.type })),
      }));

      // ── Auto-create folders on disk ───────────────────────
      const created = [];
      for (const ce of cleanedFolders) {
        const wasCreated = await ensureCeFolder(missionDir, ce.folder);
        if (wasCreated) created.push(ce.folder);
      }
      if (created.length > 0) {
        logger.info({ serverId: srv.id, created }, 'Auto-created CE folders on disk');
      }

      const xml = buildEconomyCoreXml(cleanedFolders, rawClasses, rawDefaults);
      await fsp.writeFile(filePath, xml, 'utf8');

      addAudit(req.user.id, req.user.username, 'economycore.update',
        `Updated cfgeconomycore.xml (${cleanedFolders.length} CE folders)${created.length ? ` — created: ${created.join(', ')}` : ''}`
      );
      logger.info({ serverId: srv.id, folderCount: cleanedFolders.length }, 'cfgeconomycore.xml saved');

      // Return enriched folder data
      const enriched = await Promise.all(
        cleanedFolders.map(async (f) => {
          const info = await getFolderInfo(missionDir, f.folder);
          return { ...f, ...info };
        })
      );

      res.json({ ok: true, folders: enriched, created });
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
      logger.error({ err, serverId: srv.id, folder: folder.trim() }, 'Failed to create CE folder');
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
          files: entries.slice(0, 20),
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

  /**
   * POST /api/servers/:id/economycore/upload
   * Upload XML file(s) into a CE folder.
   *
   * Body: {
   *   folder: "custom_ce",
   *   files: [
   *     { name: "my_types.xml", content: "<base64-encoded XML>" },
   *     ...
   *   ]
   * }
   *
   * Uses base64-encoded content in JSON body (no multipart needed).
   * Max 2MB per file, max 20 files per request.
   */
  app.post('/api/servers/:id/economycore/upload', authForServer('files.edit'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { folder, files } = req.body;

    // Validate folder
    const folderCheck = validateFolderName(folder);
    if (!folderCheck.valid) return res.status(400).json({ error: folderCheck.reason });

    const folderPath = safeCeFolderPath(missionDir, folder.trim());
    if (!folderPath) return res.status(400).json({ error: 'Invalid folder path' });

    // Validate files array
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required and must not be empty' });
    }
    if (files.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 files per upload' });
    }

    // Validate each file
    const errors = [];
    const validFiles = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const nameCheck = validateFileName(f.name);
      if (!nameCheck.valid) {
        errors.push(`File #${i + 1}: ${nameCheck.reason}`);
        continue;
      }
      if (!f.content || typeof f.content !== 'string') {
        errors.push(`File "${f.name}": content is required`);
        continue;
      }

      // Decode base64 and check size
      let decoded;
      try {
        decoded = Buffer.from(f.content, 'base64');
      } catch {
        errors.push(`File "${f.name}": invalid base64 encoding`);
        continue;
      }
      if (decoded.length > MAX_FILE_SIZE) {
        errors.push(`File "${f.name}": exceeds 2MB limit (${(decoded.length / 1024 / 1024).toFixed(1)}MB)`);
        continue;
      }

      // Quick XML sanity check — must start with < after whitespace
      const text = decoded.toString('utf8').trimStart();
      if (!text.startsWith('<') && !text.startsWith('﻿<')) {
        errors.push(`File "${f.name}": does not appear to be valid XML`);
        continue;
      }

      validFiles.push({ name: f.name.trim(), decoded });
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Upload validation failed', details: errors });
    }

    try {
      // Ensure folder exists
      await fsp.mkdir(folderPath, { recursive: true });

      // Write each file
      const written = [];
      for (const vf of validFiles) {
        const filePath = path.join(folderPath, vf.name);
        // Safety: make sure resolved path is still inside the folder
        if (!path.resolve(filePath).startsWith(path.resolve(folderPath) + path.sep)) {
          errors.push(`File "${vf.name}": path traversal blocked`);
          continue;
        }
        await fsp.writeFile(filePath, vf.decoded);
        written.push(vf.name);
      }

      if (errors.length > 0) {
        return res.status(400).json({ error: 'Some files failed', details: errors, written });
      }

      addAudit(req.user.id, req.user.username, 'economycore.upload',
        `Uploaded ${written.length} file(s) to CE folder "${folder.trim()}": ${written.join(', ')}`
      );
      logger.info({ serverId: srv.id, folder: folder.trim(), files: written }, 'CE files uploaded');

      // Return updated folder info
      const info = await getFolderInfo(missionDir, folder.trim());
      res.json({ ok: true, written, ...info });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to upload CE files');
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * GET /api/servers/:id/economycore/folders/files?folder=custom_ce
   * List XML files on disk in a specific CE folder.
   */
  app.get('/api/servers/:id/economycore/folders/files', authForServer('files.edit'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const folder = req.query.folder;
    const check = validateFolderName(folder);
    if (!check.valid) return res.status(400).json({ error: check.reason });

    const info = await getFolderInfo(missionDir, folder.trim());
    res.json(info);
  });
};
