const { safeError } = require('../lib/http-errors');
/**
 * Spawn Points Editor routes — read/write cfgplayerspawnpoints.xml.
 *
 * GET  /api/servers/:id/spawnpoints  — read & parse spawn points
 * PUT  /api/servers/:id/spawnpoints  — save all spawn points (full replacement)
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');
const { parseSpawnPoints, buildSpawnPoints } = require('../lib/spawnpoints-parser');

// ─── Find cfgplayerspawnpoints.xml ──────────────────────────

function findSpawnPointsFile(missionDir) {
  const candidates = [
    path.join(missionDir, 'db', 'cfgplayerspawnpoints.xml'),
    path.join(missionDir, 'cfgplayerspawnpoints.xml'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

// ─── Routes ──────────────────────────────────────────────────

module.exports = function(app) {

  // Load and parse cfgplayerspawnpoints.xml
  app.get('/api/servers/:id/spawnpoints', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    try {
      const filePath = findSpawnPointsFile(missionDir);
      if (!filePath) return res.status(404).json({ error: 'cfgplayerspawnpoints.xml not found' });

      const content = fs.readFileSync(filePath, 'utf8');
      const data = parseSpawnPoints(content);
      const totalCount = (data.fresh?.length || 0) + (data.hop?.length || 0) + (data.travel?.length || 0);
      res.json({ ...data, totalCount });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to load spawn points');
      safeError(err, req, res, { status: 500 });
    }
  });

  // Save all spawn points (full replacement)
  app.put('/api/servers/:id/spawnpoints', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { fresh, hop, travel } = req.body;
    if (!Array.isArray(fresh) || !Array.isArray(hop) || !Array.isArray(travel)) {
      return res.status(400).json({ error: 'All three spawn point arrays (fresh, hop, travel) are required' });
    }

    try {
      const filePath = findSpawnPointsFile(missionDir);
      if (!filePath) return res.status(404).json({ error: 'cfgplayerspawnpoints.xml not found' });

      // Create backup before writing
      createBackup(srv.installDir, filePath, 'cfgplayerspawnpoints.xml');

      const newXml = buildSpawnPoints({ fresh, hop, travel });
      fs.writeFileSync(filePath, newXml, 'utf8');

      const totalCount = fresh.length + hop.length + travel.length;
      addAudit(req.user.id, req.user.username, 'spawnpoints.save',
        `Saved spawn points (${fresh.length} fresh, ${hop.length} hop, ${travel.length} travel) on ${srv.name}`);

      res.json({ success: true, totalCount });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to save spawn points');
      safeError(err, req, res, { status: 500 });
    }
  });
};
