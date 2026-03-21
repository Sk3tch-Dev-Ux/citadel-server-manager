/**
 * Mod Config Routes — Generic API for reading/writing mod configuration files.
 *
 * Works with any mod that has a schema in backend/schemas/<schemaId>/.
 * Falls back to raw JSON editing for mods without schemas.
 *
 * GET  /api/servers/:id/mod-configs              — List detected mods with schema availability
 * GET  /api/servers/:id/mod-configs/:schemaId     — Read a mod's config files
 * PUT  /api/servers/:id/mod-configs/:schemaId     — Save modified config
 * POST /api/servers/:id/mod-configs/:schemaId/reset — Reset config to schema defaults
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { createBackup } = require('../lib/mission-folder');
const { detectModConfigs, findModConfigFiles } = require('../lib/mod-config-detector');
const { listAvailableSchemas, getModSchemaBundle, loadManifest } = require('../lib/mod-config-schema');

module.exports = function(app) {

  /**
   * List all detected mods on a server with their schema availability.
   * Returns both detected (installed) mods and available schemas.
   */
  app.get('/api/servers/:id/mod-configs', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    try {
      const detected = detectModConfigs(req.params.id);
      const availableSchemas = listAvailableSchemas();

      // Build result: merge detected mods with their schema info
      const mods = detected.map(det => {
        const manifest = loadManifest(det.schemaId);
        return {
          schemaId: det.schemaId,
          modName: det.modName,
          workshopId: det.workshopId,
          displayName: manifest?.modName || det.modName,
          description: manifest?.description || '',
          configFileCount: manifest?.configFiles?.length || 0,
          hasSchema: !!manifest,
        };
      });

      // Also include available schemas that aren't detected (for reference)
      const detectedSchemaIds = new Set(detected.map(d => d.schemaId));
      const uninstalled = availableSchemas
        .filter(s => !detectedSchemaIds.has(s.schemaId))
        .map(s => ({
          schemaId: s.schemaId,
          modName: null,
          workshopId: s.workshopId || '',
          displayName: s.modName,
          description: s.description || '',
          configFileCount: s.configFiles?.length || 0,
          hasSchema: true,
          installed: false,
        }));

      res.json({
        installed: mods,
        available: uninstalled,
      });
    } catch (err) {
      logger.error({ err, serverId: req.params.id }, 'Failed to detect mod configs');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Read a specific mod's config files.
   * Returns the file contents (parsed JSON) and schemas if available.
   */
  app.get('/api/servers/:id/mod-configs/:schemaId', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { schemaId } = req.params;

    try {
      // Get the schema bundle (manifest + schemas)
      const bundle = getModSchemaBundle(schemaId);
      if (!bundle) return res.status(404).json({ error: `No schema found for mod: ${schemaId}` });

      const { manifest, schemas } = bundle;

      // Detect this mod on the server
      const detected = detectModConfigs(req.params.id);
      const modInfo = detected.find(d => d.schemaId === schemaId);

      if (!modInfo) {
        return res.status(404).json({ error: `Mod ${schemaId} not detected on this server` });
      }

      // Find and read config files
      const configFileNames = manifest.configFiles.map(c => c.fileName);
      const filePaths = findModConfigFiles(srv, modInfo.modDir, configFileNames);

      const configs = {};
      for (const cfg of manifest.configFiles) {
        const filePath = filePaths[cfg.fileName];
        if (filePath) {
          try {
            const raw = fs.readFileSync(filePath, 'utf8');
            // Try parsing as JSON (most mod configs are JSON)
            try {
              configs[cfg.fileName] = {
                data: JSON.parse(raw),
                path: filePath,
                found: true,
                schema: schemas[cfg.fileName] || null,
                displayName: cfg.displayName || cfg.fileName,
                description: cfg.description || '',
              };
            } catch {
              // Not valid JSON — return raw content for text editing
              configs[cfg.fileName] = {
                data: null,
                raw,
                path: filePath,
                found: true,
                schema: null,
                displayName: cfg.displayName || cfg.fileName,
                description: cfg.description || '',
                parseError: 'File is not valid JSON',
              };
            }
          } catch (err) {
            configs[cfg.fileName] = {
              data: null,
              path: filePath,
              found: true,
              readError: err.message,
              displayName: cfg.displayName || cfg.fileName,
              description: cfg.description || '',
            };
          }
        } else {
          configs[cfg.fileName] = {
            data: null,
            found: false,
            displayName: cfg.displayName || cfg.fileName,
            description: cfg.description || '',
          };
        }
      }

      res.json({
        schemaId,
        modName: manifest.modName,
        modDir: modInfo.modName,
        configs,
      });
    } catch (err) {
      logger.error({ err, serverId: req.params.id, schemaId }, 'Failed to read mod configs');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Save a modified mod config file.
   * Body: { fileName: string, data: object }
   */
  app.put('/api/servers/:id/mod-configs/:schemaId', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { schemaId } = req.params;
    const { fileName, data } = req.body;

    if (!fileName || data === undefined) {
      return res.status(400).json({ error: 'fileName and data are required' });
    }

    try {
      const manifest = loadManifest(schemaId);
      if (!manifest) return res.status(404).json({ error: `No schema found for mod: ${schemaId}` });

      // Verify this fileName is in the manifest
      const cfgDef = manifest.configFiles.find(c => c.fileName === fileName);
      if (!cfgDef) return res.status(400).json({ error: `Unknown config file: ${fileName}` });

      // Find the actual file path
      const detected = detectModConfigs(req.params.id);
      const modInfo = detected.find(d => d.schemaId === schemaId);
      if (!modInfo) return res.status(404).json({ error: `Mod ${schemaId} not detected on this server` });

      const filePaths = findModConfigFiles(srv, modInfo.modDir, [fileName]);
      const filePath = filePaths[fileName];
      if (!filePath) return res.status(404).json({ error: `Config file not found: ${fileName}` });

      // Create backup
      createBackup(srv.installDir, filePath, path.basename(fileName));

      // Write the new content
      const content = typeof data === 'string' ? data : JSON.stringify(data, null, 4);
      fs.writeFileSync(filePath, content, 'utf8');

      addAudit(req.user.id, req.user.username, 'modconfig.save',
        `Saved ${fileName} for ${manifest.modName} on ${srv.name}`);

      res.json({ success: true, fileName });
    } catch (err) {
      logger.error({ err, serverId: req.params.id, schemaId }, 'Failed to save mod config');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Reset a config file to its schema defaults (if defaults are defined in the schema).
   */
  app.post('/api/servers/:id/mod-configs/:schemaId/reset', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { schemaId } = req.params;
    const { fileName } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });

    try {
      const bundle = getModSchemaBundle(schemaId);
      if (!bundle) return res.status(404).json({ error: `No schema found for mod: ${schemaId}` });

      const schema = bundle.schemas[fileName];
      if (!schema) return res.status(400).json({ error: `No schema available for ${fileName}` });

      // Build defaults from schema
      const defaults = buildDefaultsFromSchema(schema);
      if (!defaults) return res.status(400).json({ error: 'Schema does not define defaults' });

      // Find the file
      const detected = detectModConfigs(req.params.id);
      const modInfo = detected.find(d => d.schemaId === schemaId);
      if (!modInfo) return res.status(404).json({ error: `Mod ${schemaId} not detected on this server` });

      const filePaths = findModConfigFiles(srv, modInfo.modDir, [fileName]);
      const filePath = filePaths[fileName];
      if (!filePath) return res.status(404).json({ error: `Config file not found: ${fileName}` });

      // Backup before reset
      createBackup(srv.installDir, filePath, path.basename(fileName));

      fs.writeFileSync(filePath, JSON.stringify(defaults, null, 4), 'utf8');

      addAudit(req.user.id, req.user.username, 'modconfig.reset',
        `Reset ${fileName} for ${bundle.manifest.modName} on ${srv.name}`);

      res.json({ success: true, defaults });
    } catch (err) {
      logger.error({ err, serverId: req.params.id, schemaId }, 'Failed to reset mod config');
      res.status(500).json({ error: err.message });
    }
  });
};

/**
 * Build a default config object from a JSON Schema's `default` properties.
 * Recursively walks the schema to extract defaults.
 */
function buildDefaultsFromSchema(schema) {
  if (!schema || schema.type !== 'object') return null;

  const result = {};
  const props = schema.properties || {};

  for (const [key, def] of Object.entries(props)) {
    if (def.default !== undefined) {
      result[key] = JSON.parse(JSON.stringify(def.default));
    } else if (def.type === 'object' && def.properties) {
      result[key] = buildDefaultsFromSchema(def) || {};
    } else if (def.type === 'array') {
      result[key] = def.default || [];
    } else if (def.type === 'string') {
      result[key] = '';
    } else if (def.type === 'number' || def.type === 'integer') {
      result[key] = 0;
    } else if (def.type === 'boolean') {
      result[key] = false;
    }
  }

  return result;
}
