/**
 * Globals Editor routes — read and write globals.xml.
 *
 * GET  /api/servers/:id/globals  — parse globals.xml and return variables + metadata
 * PUT  /api/servers/:id/globals  — save modified globals back to globals.xml
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');
const { parseGlobalsXml, buildGlobalsXml, GLOBALS_METADATA } = require('../lib/globals-xml-parser');

// ─── Locate globals.xml within the mission directory ─────────

function findGlobalsXml(missionDir) {
  const candidates = [
    path.join(missionDir, 'db', 'globals.xml'),
    path.join(missionDir, 'globals.xml'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

// ─── Routes ──────────────────────────────────────────────────

module.exports = function(app) {

  // Read globals.xml
  app.get('/api/servers/:id/globals', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const globalsPath = findGlobalsXml(missionDir);
    if (!globalsPath) return res.status(404).json({ error: 'globals.xml not found' });

    try {
      const content = fs.readFileSync(globalsPath, 'utf8');
      const globals = parseGlobalsXml(content);
      res.json({ globals, metadata: GLOBALS_METADATA });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to read globals.xml');
      res.status(500).json({ error: err.message });
    }
  });

  // Save globals.xml
  app.put('/api/servers/:id/globals', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const globalsPath = findGlobalsXml(missionDir);
    if (!globalsPath) return res.status(404).json({ error: 'globals.xml not found' });

    const { globals } = req.body;
    if (!globals || !Array.isArray(globals) || globals.length === 0) {
      return res.status(400).json({ error: 'No globals provided' });
    }

    try {
      // Create backup before writing
      createBackup(srv.installDir, globalsPath, 'globals.xml');

      // Build and write XML
      const newXml = buildGlobalsXml(globals);
      fs.writeFileSync(globalsPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'globals.save',
        `Saved ${globals.length} global variables on ${srv.name}`);

      res.json({ success: true, count: globals.length });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to save globals.xml');
      res.status(500).json({ error: err.message });
    }
  });
};
