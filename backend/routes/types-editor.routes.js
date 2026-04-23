const { safeError } = require('../lib/http-errors');
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
const { safePath } = require('../lib/helpers');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');
const {
  parseLimitsDefinition,
  parseUserDefinitions,
  parseTypesXml,
  buildTypesXml,
  parseEconomyCore,
} = require('../lib/types-xml-parser');

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
//
// cfglimitsdefinition.xml and its user variant rarely change, but used to be
// re-read + re-parsed on every editor request (GET, save, etc). On a large
// mission folder each parse is ~50-100ms of sync I/O + regex. We cache the
// parsed result per-path and invalidate when the file's mtime changes.

/** @type {Map<string, { mtimeMs: number, value: object }>} */
const _limitsCache = new Map();

function _cachedParse(filePath, parseFn) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  const cached = _limitsCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;
  try {
    const value = parseFn(fs.readFileSync(filePath, 'utf8'));
    _limitsCache.set(filePath, { mtimeMs: stat.mtimeMs, value });
    return value;
  } catch (err) {
    logger.warn({ err: err.message, filePath }, 'Failed to parse limits XML');
    return null;
  }
}

function loadLimits(missionDir) {
  let limits = { categories: [], usages: [], values: [], tags: [] };
  let userDefs = {};

  // cfglimitsdefinition.xml — check mission root first, then db/
  const limitsCandidates = [
    path.join(missionDir, 'cfglimitsdefinition.xml'),
    path.join(missionDir, 'db', 'cfglimitsdefinition.xml'),
  ];
  const limitsPath = limitsCandidates.find(p => fs.existsSync(p));
  const cachedLimits = _cachedParse(limitsPath, parseLimitsDefinition);
  if (cachedLimits) limits = cachedLimits;

  // cfglimitsdefinitionuser.xml — check mission root first, then db/
  const userCandidates = [
    path.join(missionDir, 'cfglimitsdefinitionuser.xml'),
    path.join(missionDir, 'db', 'cfglimitsdefinitionuser.xml'),
  ];
  const userPath = userCandidates.find(p => fs.existsSync(p));
  const cachedUser = _cachedParse(userPath, parseUserDefinitions);
  if (cachedUser) userDefs = cachedUser;

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
      safeError(err, req, res, { status: 500 });
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
      safeError(err, req, res, { status: 500 });
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
      safeError(err, req, res, { status: 500 });
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
        createBackup(srv.installDir, fullPath, path.basename(relPath));

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
      safeError(err, req, res, { status: 500 });
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
      createBackup(srv.installDir, fullPath, path.basename(targetFile));

      const newXml = buildTypesXml(existing, content, userDefs);
      fs.writeFileSync(fullPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'types.add',
        `Added type "${item.name}" to ${targetFile} on ${srv.name}`);

      res.json({ success: true, item });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to add type item');
      safeError(err, req, res, { status: 500 });
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
      createBackup(srv.installDir, fullPath, path.basename(sourceFile));

      const newXml = buildTypesXml(filtered, content, userDefs);
      fs.writeFileSync(fullPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'types.delete',
        `Deleted type "${name}" from ${sourceFile} on ${srv.name}`);

      res.json({ success: true });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to delete type item');
      safeError(err, req, res, { status: 500 });
    }
  });

  // Export all items as JSON or CSV
  app.get('/api/servers/:id/types/export', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const format = (req.query.format || 'json').toLowerCase();
    if (format !== 'json' && format !== 'csv') {
      return res.status(400).json({ error: 'Format must be json or csv' });
    }

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
          logger.warn({ err: err.message, file: relPath }, 'Failed to parse types file during export');
        }
      }

      if (format === 'csv') {
        const csvHeaders = ['name', 'nominal', 'lifetime', 'restock', 'min', 'quantmin', 'quantmax', 'cost', 'category', 'usage', 'value', 'source_file'];
        const csvLines = [csvHeaders.join(',')];
        for (const item of allItems) {
          const row = [
            item.name || '',
            item.nominal ?? 0,
            item.lifetime ?? 0,
            item.restock ?? 0,
            item.min ?? 0,
            item.quantmin ?? -1,
            item.quantmax ?? -1,
            item.cost ?? 100,
            item.category || '',
            (item.usage || []).join(';'),
            (item.value || []).join(';'),
            item.source_file || '',
          ];
          csvLines.push(row.join(','));
        }
        const csvContent = csvLines.join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="types-export.csv"');
        return res.send(csvContent);
      }

      // JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="types-export.json"');
      res.json(allItems);
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to export types');
      safeError(err, req, res, { status: 500 });
    }
  });

  // Import items into a target types file
  app.post('/api/servers/:id/types/import', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const { items, targetFile, mode } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }
    if (!targetFile) {
      return res.status(400).json({ error: 'Target file is required' });
    }
    if (mode !== 'merge' && mode !== 'replace') {
      return res.status(400).json({ error: 'Mode must be merge or replace' });
    }

    try {
      const fullPath = path.join(missionDir, targetFile);
      const validated = safePath(path.join(srv.installDir, 'mpmissions'), fullPath);
      if (!validated) return res.status(403).json({ error: 'Access denied' });
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Target file not found' });

      const { userDefs } = loadLimits(missionDir);
      const originalContent = fs.readFileSync(fullPath, 'utf8');
      const existingItems = parseTypesXml(originalContent, targetFile, userDefs);

      // Create backup before writing
      createBackup(srv.installDir, fullPath, path.basename(targetFile));

      let finalItems;
      let added = 0;
      let updated = 0;

      if (mode === 'replace') {
        // Replace entire file contents with imported items
        finalItems = items.map(item => ({ ...item, source_file: targetFile }));
        added = finalItems.length;
      } else {
        // Merge: update existing by name, add new ones
        const existingMap = {};
        for (const item of existingItems) existingMap[item.name] = item;

        for (const importItem of items) {
          if (existingMap[importItem.name]) {
            // Update existing item
            existingMap[importItem.name] = { ...existingMap[importItem.name], ...importItem, source_file: targetFile };
            updated++;
          } else {
            // Add new item
            existingMap[importItem.name] = { ...importItem, source_file: targetFile };
            added++;
          }
        }
        finalItems = Object.values(existingMap);
      }

      const newXml = buildTypesXml(finalItems, originalContent, userDefs);
      fs.writeFileSync(fullPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'types.import',
        `Imported ${items.length} type items (mode: ${mode}) into ${targetFile} on ${srv.name}`);

      res.json({ success: true, imported: items.length, updated, added });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to import types');
      safeError(err, req, res, { status: 500 });
    }
  });
};
