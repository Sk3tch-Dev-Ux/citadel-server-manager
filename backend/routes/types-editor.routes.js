/**
 * Types Editor routes — full CRUD for types.xml editing.
 *
 * GET  /api/servers/:id/types/files    — list all types.xml files
 * GET  /api/servers/:id/types/items    — read & parse all items across all types files
 * GET  /api/servers/:id/types/limits   — parse limits definitions (categories, usages, values, tags)
 * PUT  /api/servers/:id/types/save     — save modified items back to their source files
 * POST /api/servers/:id/types/add      — add a new item to a types file
 * DELETE /api/servers/:id/types/item   — delete an item from its source file
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { readServerConfig } = require('../lib/dayz-config');
const { safePath } = require('../lib/helpers');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const {
  parseLimitsDefinition,
  parseUserDefinitions,
  parseTypesXml,
  buildTypesXml,
  parseEconomyCore,
} = require('../lib/types-xml-parser');

// ─── Mission Folder Detection (shared with items.routes) ────

const TEMPLATE_TO_FOLDER = {
  'dayzoffline.chernarusplus': 'dayzOffline.chernarusplus',
  'chernarusplus': 'dayzOffline.chernarusplus',
  'dayzoffline.enoch': 'dayzOffline.enoch',
  'enoch': 'dayzOffline.enoch',
  'deerisle': 'deerisle',
  'namalsk': 'namalsk',
  'sakhal': 'sakhal',
  'takistanplus': 'takistanplus',
};

function detectMissionFolder(installDir) {
  const mpDir = path.join(installDir, 'mpmissions');
  if (!fs.existsSync(mpDir)) return null;
  const cfg = readServerConfig(installDir);
  const template = (cfg.template || '').toLowerCase();
  if (template && TEMPLATE_TO_FOLDER[template]) {
    const candidate = path.join(mpDir, TEMPLATE_TO_FOLDER[template]);
    if (fs.existsSync(candidate)) return TEMPLATE_TO_FOLDER[template];
  }
  try {
    const entries = fs.readdirSync(mpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (template && entry.name.toLowerCase().includes(template)) return entry.name;
    }
    const dirs = entries.filter(e => e.isDirectory());
    if (dirs.length > 0) return dirs[0].name;
  } catch { /* ignore */ }
  return null;
}

function getMissionDir(srv) {
  const missionFolder = detectMissionFolder(srv.installDir);
  if (!missionFolder) return null;
  const missionDir = path.join(srv.installDir, 'mpmissions', missionFolder);
  return fs.existsSync(missionDir) ? missionDir : null;
}

// ─── Find all types XML files via cfgeconomycore.xml ────────

function findAllTypesFiles(missionDir) {
  const typesFiles = [];
  const economyCorePath = path.join(missionDir, 'cfgeconomycore.xml');

  if (fs.existsSync(economyCorePath)) {
    try {
      const content = fs.readFileSync(economyCorePath, 'utf8');
      const relativePaths = parseEconomyCore(content);
      for (const relPath of relativePaths) {
        const fullPath = path.join(missionDir, relPath);
        if (fs.existsSync(fullPath)) typesFiles.push(relPath);
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to parse cfgeconomycore.xml');
    }
  }

  // Fallback: always include db/types.xml if it exists
  const defaultRel = 'db/types.xml';
  const defaultFull = path.join(missionDir, defaultRel);
  if (fs.existsSync(defaultFull) && !typesFiles.includes(defaultRel)) {
    typesFiles.unshift(defaultRel);
  }

  return typesFiles;
}

// ─── Load limits definitions ────────────────────────────────

function loadLimits(missionDir) {
  let limits = { categories: [], usages: [], values: [], tags: [] };
  let userDefs = {};

  // cfglimitsdefinition.xml
  const limitsPath = path.join(missionDir, 'db', 'cfglimitsdefinition.xml');
  if (fs.existsSync(limitsPath)) {
    try {
      limits = parseLimitsDefinition(fs.readFileSync(limitsPath, 'utf8'));
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to parse cfglimitsdefinition.xml');
    }
  }

  // cfglimitsdefinitionuser.xml
  const userPath = path.join(missionDir, 'db', 'cfglimitsdefinitionuser.xml');
  if (fs.existsSync(userPath)) {
    try {
      userDefs = parseUserDefinitions(fs.readFileSync(userPath, 'utf8'));
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to parse cfglimitsdefinitionuser.xml');
    }
  }

  return { limits, userDefs };
}

// ─── Routes ─────────────────────────────────────────────────

module.exports = function(app) {

  // List all types files discovered via cfgeconomycore.xml
  app.get('/api/servers/:id/types/files', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    try {
      const files = findAllTypesFiles(missionDir);
      const result = files.map(relPath => {
        const fullPath = path.join(missionDir, relPath);
        let itemCount = 0;
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const typeRe = /<type\s+name="/gi;
          let m;
          while ((m = typeRe.exec(content)) !== null) itemCount++;
        } catch { /* ignore */ }
        return { path: relPath, itemCount };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Load all items from all types files (parsed with limits expansion)
  app.get('/api/servers/:id/types/items', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    try {
      const typesFiles = findAllTypesFiles(missionDir);
      const { userDefs } = loadLimits(missionDir);
      const allItems = [];

      for (const relPath of typesFiles) {
        const fullPath = path.join(missionDir, relPath);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const items = parseTypesXml(content, relPath, userDefs);
          allItems.push(...items);
        } catch (err) {
          logger.warn({ err: err.message, file: relPath }, 'Failed to parse types file');
        }
      }

      res.json({ items: allItems, files: typesFiles });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Load limits definitions (categories, usages, values, tags)
  app.get('/api/servers/:id/types/limits', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    try {
      const { limits, userDefs } = loadLimits(missionDir);
      res.json({ ...limits, userDefinitions: Object.keys(userDefs).sort() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save modified items back to their source files
  app.put('/api/servers/:id/types/save', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    try {
      const { userDefs } = loadLimits(missionDir);

      // Group items by source file
      const fileGroups = {};
      for (const item of items) {
        const sf = item.source_file;
        if (!sf) continue;
        if (!fileGroups[sf]) fileGroups[sf] = [];
        fileGroups[sf].push(item);
      }

      const savedFiles = [];

      for (const [relPath, modifiedItems] of Object.entries(fileGroups)) {
        const fullPath = path.join(missionDir, relPath);
        const validated = safePath(path.join(srv.installDir, 'mpmissions'), fullPath);
        if (!validated) continue;

        // Read the original file, parse all items, apply modifications
        const originalContent = fs.readFileSync(fullPath, 'utf8');
        const allItems = parseTypesXml(originalContent, relPath, userDefs);

        // Build a map of modified items by name
        const modMap = {};
        for (const mod of modifiedItems) modMap[mod.name] = mod;

        // Replace modified items in the full list
        const finalItems = allItems.map(item => modMap[item.name] || item);

        // Create backup
        const backupDir = path.join(srv.installDir, '.backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(fullPath, path.join(backupDir, `${path.basename(relPath)}.${Date.now()}.bak`));

        // Write new XML
        const newXml = buildTypesXml(finalItems, originalContent, userDefs);
        fs.writeFileSync(fullPath, newXml, 'utf8');
        savedFiles.push(relPath);
      }

      addAudit(req.user.id, req.user.username, 'types.save',
        `Saved ${items.length} type items across ${savedFiles.length} file(s) on ${srv.name}`);

      res.json({ success: true, savedFiles, itemCount: items.length });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to save types');
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new item to a types file
  app.post('/api/servers/:id/types/add', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { item, targetFile } = req.body;
    if (!item || !item.name || !targetFile) {
      return res.status(400).json({ error: 'Item and target file required' });
    }

    try {
      const fullPath = path.join(missionDir, targetFile);
      const validated = safePath(path.join(srv.installDir, 'mpmissions'), fullPath);
      if (!validated) return res.status(403).json({ error: 'Access denied' });
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Target file not found' });

      const { userDefs } = loadLimits(missionDir);

      // Check for duplicate name
      const content = fs.readFileSync(fullPath, 'utf8');
      const existing = parseTypesXml(content, targetFile, userDefs);
      if (existing.some(e => e.name === item.name)) {
        return res.status(409).json({ error: `Item "${item.name}" already exists in ${targetFile}` });
      }

      // Parse all, append new item, rebuild
      item.source_file = targetFile;
      existing.push(item);

      // Backup
      const backupDir = path.join(srv.installDir, '.backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(fullPath, path.join(backupDir, `${path.basename(targetFile)}.${Date.now()}.bak`));

      const newXml = buildTypesXml(existing, content, userDefs);
      fs.writeFileSync(fullPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'types.add',
        `Added type "${item.name}" to ${targetFile} on ${srv.name}`);

      res.json({ success: true, item });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to add type item');
      res.status(500).json({ error: err.message });
    }
  });

  // Delete an item from its source file
  app.delete('/api/servers/:id/types/item', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { name, sourceFile } = req.query;
    if (!name || !sourceFile) {
      return res.status(400).json({ error: 'Item name and source file required' });
    }

    try {
      const fullPath = path.join(missionDir, sourceFile);
      const validated = safePath(path.join(srv.installDir, 'mpmissions'), fullPath);
      if (!validated) return res.status(403).json({ error: 'Access denied' });
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Source file not found' });

      const { userDefs } = loadLimits(missionDir);
      const content = fs.readFileSync(fullPath, 'utf8');
      const items = parseTypesXml(content, sourceFile, userDefs);
      const filtered = items.filter(i => i.name !== name);

      if (filtered.length === items.length) {
        return res.status(404).json({ error: `Item "${name}" not found in ${sourceFile}` });
      }

      // Backup
      const backupDir = path.join(srv.installDir, '.backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(fullPath, path.join(backupDir, `${path.basename(sourceFile)}.${Date.now()}.bak`));

      const newXml = buildTypesXml(filtered, content, userDefs);
      fs.writeFileSync(fullPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'types.delete',
        `Deleted type "${name}" from ${sourceFile} on ${srv.name}`);

      res.json({ success: true });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to delete type item');
      res.status(500).json({ error: err.message });
    }
  });
};
