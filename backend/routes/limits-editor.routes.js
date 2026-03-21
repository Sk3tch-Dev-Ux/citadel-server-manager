/**
 * Limits Definition Editor routes — CRUD for cfglimitsdefinition.xml.
 *
 * GET /api/servers/:id/limits  — read & parse limits definition
 * PUT /api/servers/:id/limits  — save limits definition (full replacement)
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');
const { parseLimitsXml, buildLimitsXml } = require('../lib/limits-parser');

// ─── Find cfglimitsdefinition.xml ────────────────────────────

function findLimitsFile(missionDir) {
  const candidates = [
    path.join(missionDir, 'cfglimitsdefinition.xml'),
    path.join(missionDir, 'db', 'cfglimitsdefinition.xml'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

// ─── Routes ──────────────────────────────────────────────────

module.exports = function(app) {

  // Load and parse cfglimitsdefinition.xml
  app.get('/api/servers/:id/limits', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    try {
      const filePath = findLimitsFile(missionDir);
      if (!filePath) return res.status(404).json({ error: 'cfglimitsdefinition.xml not found' });

      const content = fs.readFileSync(filePath, 'utf8');
      const data = parseLimitsXml(content);
      res.json(data);
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to load limits definition');
      res.status(500).json({ error: err.message });
    }
  });

  // Save limits definition (full replacement)
  app.put('/api/servers/:id/limits', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { categories, usages, values, tags } = req.body;
    if (!categories || !usages || !values || !tags) {
      return res.status(400).json({ error: 'All four sections (categories, usages, values, tags) are required' });
    }
    if (!Array.isArray(categories) || !Array.isArray(usages) || !Array.isArray(values) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'All sections must be arrays of strings' });
    }

    try {
      const filePath = findLimitsFile(missionDir);
      if (!filePath) return res.status(404).json({ error: 'cfglimitsdefinition.xml not found' });

      // Create backup before writing
      createBackup(srv.installDir, filePath, 'cfglimitsdefinition.xml');

      const newXml = buildLimitsXml({ categories, usages, values, tags });
      fs.writeFileSync(filePath, newXml, 'utf8');

      const total = categories.length + usages.length + values.length + tags.length;
      addAudit(req.user.id, req.user.username, 'limits.save',
        `Saved limits definition (${total} entries) on ${srv.name}`);

      res.json({ success: true, counts: {
        categories: categories.length,
        usages: usages.length,
        values: values.length,
        tags: tags.length,
      }});
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to save limits definition');
      res.status(500).json({ error: err.message });
    }
  });
};
