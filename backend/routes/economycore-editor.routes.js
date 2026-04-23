const { safeError } = require('../lib/http-errors');
/**
 * Economy Core Editor routes — CRUD for cfgeconomycore.xml.
 *
 * GET /api/servers/:id/economycore  — read & parse economy core config
 * PUT /api/servers/:id/economycore  — save CE folder entries (preserves classes/defaults)
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');
const { parseEconomyCoreXml, buildEconomyCoreXml, VALID_FILE_TYPES } = require('../lib/economycore-parser');

// ─── Routes ──────────────────────────────────────────────────

module.exports = function(app) {

  // Load and parse cfgeconomycore.xml
  app.get('/api/servers/:id/economycore', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    try {
      const filePath = path.join(missionDir, 'cfgeconomycore.xml');
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'cfgeconomycore.xml not found in mission folder root' });
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const { folders } = parseEconomyCoreXml(content);

      // Check which CE folders actually exist on disk
      const foldersWithExistence = folders.map(f => ({
        ...f,
        exists: fs.existsSync(path.join(missionDir, f.folder)),
      }));

      res.json({ folders: foldersWithExistence, validTypes: VALID_FILE_TYPES });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to load cfgeconomycore.xml');
      safeError(err, req, res, { status: 500 });
    }
  });

  // Save economy core config — only replaces CE folder entries,
  // preserves <classes> and <defaults> sections from the original file.
  app.put('/api/servers/:id/economycore', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { folders } = req.body;
    if (!Array.isArray(folders)) {
      return res.status(400).json({ error: 'folders array is required' });
    }

    // Validate structure
    for (const ce of folders) {
      if (!ce.folder || typeof ce.folder !== 'string') {
        return res.status(400).json({ error: 'Each CE entry must have a folder name' });
      }
      if (!Array.isArray(ce.files)) {
        return res.status(400).json({ error: `CE folder "${ce.folder}" must have a files array` });
      }
      for (const file of ce.files) {
        if (!file.name || !file.type) {
          return res.status(400).json({ error: `Files in "${ce.folder}" must have name and type` });
        }
        if (!VALID_FILE_TYPES.includes(file.type)) {
          return res.status(400).json({ error: `Invalid file type "${file.type}" in "${ce.folder}". Valid types: ${VALID_FILE_TYPES.join(', ')}` });
        }
      }
    }

    try {
      const filePath = path.join(missionDir, 'cfgeconomycore.xml');

      // Read the original file to preserve <classes> and <defaults> sections
      let rawClasses = null;
      let rawDefaults = null;
      if (fs.existsSync(filePath)) {
        const originalContent = fs.readFileSync(filePath, 'utf8');
        const parsed = parseEconomyCoreXml(originalContent);
        rawClasses = parsed.rawClasses;
        rawDefaults = parsed.rawDefaults;

        // Backup existing file
        createBackup(srv.installDir, filePath, 'cfgeconomycore.xml');
      }

      const xml = buildEconomyCoreXml(folders, rawClasses, rawDefaults);
      fs.writeFileSync(filePath, xml, 'utf8');

      addAudit(req.user.id, req.user.username, 'economycore.update', `Updated cfgeconomycore.xml (${folders.length} CE folders)`);
      logger.info({ serverId: srv.id, folderCount: folders.length }, 'cfgeconomycore.xml saved');

      // Return folders with existence check
      const foldersWithExistence = folders.map(f => ({
        ...f,
        exists: fs.existsSync(path.join(missionDir, f.folder)),
      }));

      res.json({ ok: true, folders: foldersWithExistence });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to save cfgeconomycore.xml');
      safeError(err, req, res, { status: 500 });
    }
  });
};
