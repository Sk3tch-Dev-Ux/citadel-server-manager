/**
 * Spawnable Types Editor routes — CRUD for cfgspawnabletypes.xml editing.
 *
 * GET    /api/servers/:id/spawnabletypes         — read & parse all spawnable types
 * PUT    /api/servers/:id/spawnabletypes         — save all spawnable types
 * POST   /api/servers/:id/spawnabletypes/add     — add a new spawnable type
 * DELETE /api/servers/:id/spawnabletypes/item    — delete a spawnable type by name
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');
const { parseSpawnableTypes, buildSpawnableTypes } = require('../lib/spawnabletypes-parser');

// ─── Find cfgspawnabletypes.xml ──────────────────────────────

function findSpawnableTypesFile(missionDir) {
  const candidates = [
    path.join(missionDir, 'db', 'cfgspawnabletypes.xml'),
    path.join(missionDir, 'cfgspawnabletypes.xml'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

// ─── Routes ──────────────────────────────────────────────────

module.exports = function(app) {

  // Load and parse cfgspawnabletypes.xml
  app.get('/api/servers/:id/spawnabletypes', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    try {
      const filePath = findSpawnableTypesFile(missionDir);
      if (!filePath) return res.status(404).json({ error: 'cfgspawnabletypes.xml not found' });

      const content = fs.readFileSync(filePath, 'utf8');
      const items = parseSpawnableTypes(content);
      res.json({ items });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to load spawnable types');
      res.status(500).json({ error: err.message });
    }
  });

  // Save all spawnable types (full replacement)
  app.put('/api/servers/:id/spawnabletypes', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'No items provided' });
    }

    try {
      const filePath = findSpawnableTypesFile(missionDir);
      if (!filePath) return res.status(404).json({ error: 'cfgspawnabletypes.xml not found' });

      // Create backup before writing
      createBackup(srv.installDir, filePath, 'cfgspawnabletypes.xml');

      const newXml = buildSpawnableTypes(items);
      fs.writeFileSync(filePath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'spawnabletypes.save',
        `Saved ${items.length} spawnable types on ${srv.name}`);

      res.json({ success: true, itemCount: items.length });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to save spawnable types');
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new spawnable type
  app.post('/api/servers/:id/spawnabletypes/add', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { item } = req.body;
    if (!item || !item.name) {
      return res.status(400).json({ error: 'Item with name is required' });
    }

    try {
      const filePath = findSpawnableTypesFile(missionDir);
      if (!filePath) return res.status(404).json({ error: 'cfgspawnabletypes.xml not found' });

      const content = fs.readFileSync(filePath, 'utf8');
      const existing = parseSpawnableTypes(content);

      // Check for duplicate name
      if (existing.some(e => e.name.toLowerCase() === item.name.toLowerCase())) {
        return res.status(409).json({ error: `Spawnable type "${item.name}" already exists` });
      }

      existing.push({
        name: item.name,
        hoarder: !!item.hoarder,
        attachments: item.attachments || [],
        cargo: item.cargo || [],
      });

      // Backup and write
      createBackup(srv.installDir, filePath, 'cfgspawnabletypes.xml');
      const newXml = buildSpawnableTypes(existing);
      fs.writeFileSync(filePath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'spawnabletypes.add',
        `Added spawnable type "${item.name}" on ${srv.name}`);

      res.json({ success: true, item });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to add spawnable type');
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a spawnable type by name
  app.delete('/api/servers/:id/spawnabletypes/item', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'Item name is required' });
    }

    try {
      const filePath = findSpawnableTypesFile(missionDir);
      if (!filePath) return res.status(404).json({ error: 'cfgspawnabletypes.xml not found' });

      const content = fs.readFileSync(filePath, 'utf8');
      const items = parseSpawnableTypes(content);
      const filtered = items.filter(i => i.name !== name);

      if (filtered.length === items.length) {
        return res.status(404).json({ error: `Spawnable type "${name}" not found` });
      }

      // Backup and write
      createBackup(srv.installDir, filePath, 'cfgspawnabletypes.xml');
      const newXml = buildSpawnableTypes(filtered);
      fs.writeFileSync(filePath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'spawnabletypes.delete',
        `Deleted spawnable type "${name}" on ${srv.name}`);

      res.json({ success: true });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to delete spawnable type');
      res.status(500).json({ error: err.message });
    }
  });
};
