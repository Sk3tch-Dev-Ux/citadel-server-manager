const { safeError } = require('../lib/http-errors');
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
const { detectModConfigs, findModConfigFiles, scanProfileForConfigs, resolveDetectedConfigPath } = require('../lib/mod-config-detector');
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
      safeError(err, req, res, { status: 500 });
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
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * GET — lightweight manifest: config file list with schemas + an "exists on
   * disk" flag per file. Returns NO file content, so it's fast (under 50 KB
   * even for Expansion's 32 files).
   *
   * The frontend uses this to render the sidebar + decide which sections to
   * disable (missing files), then lazily fetches each file's content via
   * `/file?fileName=...` only when the user opens that section.
   *
   * Matches the response shape of the full endpoint but with empty `data` —
   * callers that previously used the whole response can populate `data` via
   * `/file?...` calls and everything else just works.
   */
  app.get('/api/servers/:id/mod-configs/:schemaId/meta', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { schemaId } = req.params;
    try {
      const bundle = getModSchemaBundle(schemaId);
      if (!bundle) return res.status(404).json({ error: `No schema found for mod: ${schemaId}` });
      const detected = detectModConfigs(req.params.id);
      const modInfo = detected.find((d) => d.schemaId === schemaId);
      if (!modInfo) return res.status(404).json({ error: `Mod ${schemaId} not detected on this server` });

      const fileNames = bundle.manifest.configFiles.map((c) => c.fileName);
      const filePaths = findModConfigFiles(srv, modInfo.modDir, fileNames);

      const configs = {};
      for (const cfg of bundle.manifest.configFiles) {
        configs[cfg.fileName] = {
          // data intentionally omitted — fetch via /file?fileName=…
          data: null,
          path: filePaths[cfg.fileName] || null,
          found: !!filePaths[cfg.fileName],
          schema: bundle.schemas[cfg.fileName] || null,
          displayName: cfg.displayName || cfg.fileName,
          description: cfg.description || '',
        };
      }

      res.json({
        schemaId,
        modName: bundle.manifest.modName,
        modDir: modInfo.modName,
        configs,
      });
    } catch (err) {
      logger.error({ err, serverId: req.params.id, schemaId }, 'Failed to read mod config meta');
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * GET — single config file content (lazy-load for the Expansion editor).
   * Query: ?fileName=ExpansionMod/Settings/GeneralSettings.json
   *
   * Response matches the shape of a single entry in the big GET endpoint's
   * `configs` map, so the frontend can slot it directly into state.
   */
  app.get('/api/servers/:id/mod-configs/:schemaId/file', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { schemaId } = req.params;
    const fileName = typeof req.query.fileName === 'string' ? req.query.fileName : '';
    if (!fileName) return res.status(400).json({ error: 'fileName required' });

    try {
      const bundle = getModSchemaBundle(schemaId);
      if (!bundle) return res.status(404).json({ error: `No schema found for mod: ${schemaId}` });
      // Validate fileName is in the manifest — prevents arbitrary file reads
      const cfg = bundle.manifest.configFiles.find((c) => c.fileName === fileName);
      if (!cfg) return res.status(400).json({ error: `Unknown config file: ${fileName}` });

      const detected = detectModConfigs(req.params.id);
      const modInfo = detected.find((d) => d.schemaId === schemaId);
      if (!modInfo) return res.status(404).json({ error: `Mod ${schemaId} not detected on this server` });

      const filePaths = findModConfigFiles(srv, modInfo.modDir, [fileName]);
      const filePath = filePaths[fileName];
      if (!filePath) {
        return res.json({
          fileName,
          data: null,
          path: null,
          found: false,
          schema: bundle.schemas[fileName] || null,
          displayName: cfg.displayName || fileName,
          description: cfg.description || '',
        });
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      let data = null, parseError = null, rawOut;
      try { data = JSON.parse(raw); } catch (e) { parseError = e.message; rawOut = raw; }

      res.json({
        fileName,
        data,
        raw: parseError ? rawOut : undefined,
        path: filePath,
        found: true,
        schema: bundle.schemas[fileName] || null,
        displayName: cfg.displayName || fileName,
        description: cfg.description || '',
        parseError: parseError ? 'File is not valid JSON' : undefined,
      });
    } catch (err) {
      logger.error({ err, serverId: req.params.id, schemaId, fileName }, 'Failed to read mod config file');
      safeError(err, req, res, { status: 500 });
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
      safeError(err, req, res, { status: 500 });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //   Auto-detected generic mod configs
  //   Walks the server's profile dir for *.json files (no schema needed) and
  //   exposes them for raw JSON editing. Any mod that drops config files into
  //   profiles/<ModName>/ gets first-class UI without us having to write a
  //   manifest. Expansion's subtree + runtime/anti-cheat state are excluded.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * GET — list every auto-detected JSON config under the profile dir,
   * grouped by top-level folder.
   */
  app.get('/api/servers/:id/mod-configs/detected', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      const result = scanProfileForConfigs(srv);
      if (!result.profileDir) {
        return res.json({
          profileDir: null,
          groups: [],
          truncated: false,
          message: 'No profile directory configured or found for this server.',
        });
      }
      res.json(result);
    } catch (err) {
      logger.error({ err, serverId: req.params.id }, 'Failed to scan profile configs');
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * GET — read a detected JSON config file. Query: ?path=<relativePath>
   * The relative path is resolved against the server's profile dir and
   * traversal is blocked.
   */
  app.get('/api/servers/:id/mod-configs/detected/content', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const abs = resolveDetectedConfigPath(srv, relPath);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    try {
      if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File not found' });
      const raw = fs.readFileSync(abs, 'utf-8');
      let parsed = null;
      let parseError = null;
      try { parsed = JSON.parse(raw); } catch (e) { parseError = e.message; }
      const stat = fs.statSync(abs);
      res.json({
        path: relPath,
        content: raw,
        parsed,
        parseError,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (err) {
      logger.error({ err, serverId: req.params.id, path: relPath }, 'Failed to read detected config');
      safeError(err, req, res, { status: 500 });
    }
  });

  /**
   * PUT — save an auto-detected JSON config. Body: { path, content }
   * `content` must be a string (the raw JSON text) — we validate it's
   * parseable before writing so we don't corrupt a working config.
   * A timestamped backup is written to the standard backup location first.
   */
  app.put('/api/servers/:id/mod-configs/detected/content', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const { path: relPath, content } = req.body || {};
    const abs = resolveDetectedConfigPath(srv, relPath);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string (raw JSON)' });
    }
    // Guard against corrupt writes — refuse to save if the content doesn't parse
    try {
      JSON.parse(content);
    } catch (e) {
      return res.status(400).json({ error: `Invalid JSON: ${e.message}` });
    }
    try {
      if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File not found' });
      createBackup(srv.installDir, abs, path.basename(abs));
      fs.writeFileSync(abs, content, 'utf-8');
      addAudit(req.user.id, req.user.username, 'modconfig.detected.save',
        `Saved auto-detected config ${relPath} on ${srv.name}`);
      res.json({ ok: true, path: relPath });
    } catch (err) {
      logger.error({ err, serverId: req.params.id, path: relPath }, 'Failed to save detected config');
      safeError(err, req, res, { status: 500 });
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
      safeError(err, req, res, { status: 500 });
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
