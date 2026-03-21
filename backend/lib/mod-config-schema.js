/**
 * Mod Config Schema Registry — Loads and manages JSON schemas for mod configs.
 *
 * Each mod has a manifest.json in backend/schemas/<schemaId>/ that defines:
 *   - modName: Human-readable mod name
 *   - workshopId: Primary Steam Workshop ID
 *   - configFiles: Array of { fileName, displayName, description, schemaFile? }
 *
 * If a schemaFile is specified, the corresponding .schema.json is loaded from
 * the same directory and used for form-based editing. Without a schema, the
 * config falls back to raw JSON editing.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

// In-memory cache of loaded manifests and schemas
const _manifestCache = {};
const _schemaCache = {};

/**
 * Load a mod's manifest from disk.
 *
 * @param {string} schemaId - Schema directory name (e.g., 'expansion')
 * @returns {object|null} Manifest object or null if not found
 */
function loadManifest(schemaId) {
  if (_manifestCache[schemaId]) return _manifestCache[schemaId];

  const manifestPath = path.join(SCHEMAS_DIR, schemaId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);
    manifest.schemaId = schemaId;
    _manifestCache[schemaId] = manifest;
    return manifest;
  } catch (err) {
    logger.warn({ err: err.message, schemaId }, 'Failed to load mod schema manifest');
    return null;
  }
}

/**
 * Load a JSON Schema file for a specific config.
 *
 * @param {string} schemaId - Schema directory name
 * @param {string} schemaFile - Schema file name (e.g., 'TraderConfig.schema.json')
 * @returns {object|null} JSON Schema object or null
 */
function loadSchema(schemaId, schemaFile) {
  const cacheKey = `${schemaId}/${schemaFile}`;
  if (_schemaCache[cacheKey]) return _schemaCache[cacheKey];

  const schemaPath = path.join(SCHEMAS_DIR, schemaId, schemaFile);
  if (!fs.existsSync(schemaPath)) return null;

  try {
    const content = fs.readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(content);
    _schemaCache[cacheKey] = schema;
    return schema;
  } catch (err) {
    logger.warn({ err: err.message, schemaId, schemaFile }, 'Failed to load JSON schema');
    return null;
  }
}

/**
 * List all available mod schemas (from the schemas/ directory).
 *
 * @returns {Array<object>} Array of manifest objects
 */
function listAvailableSchemas() {
  if (!fs.existsSync(SCHEMAS_DIR)) return [];

  const schemas = [];
  try {
    const entries = fs.readdirSync(SCHEMAS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = loadManifest(entry.name);
      if (manifest) schemas.push(manifest);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to list mod schemas');
  }
  return schemas;
}

/**
 * Get a specific mod's manifest and all its schemas.
 *
 * @param {string} schemaId - Schema directory name
 * @returns {{ manifest, schemas: Object<string, object> }|null}
 */
function getModSchemaBundle(schemaId) {
  const manifest = loadManifest(schemaId);
  if (!manifest) return null;

  const schemas = {};
  for (const cfg of (manifest.configFiles || [])) {
    if (cfg.schemaFile) {
      const schema = loadSchema(schemaId, cfg.schemaFile);
      if (schema) schemas[cfg.fileName] = schema;
    }
  }

  return { manifest, schemas };
}

/**
 * Clear all cached schemas (useful for development/hot-reload).
 */
function clearCache() {
  Object.keys(_manifestCache).forEach(k => delete _manifestCache[k]);
  Object.keys(_schemaCache).forEach(k => delete _schemaCache[k]);
}

module.exports = {
  SCHEMAS_DIR,
  loadManifest,
  loadSchema,
  listAvailableSchemas,
  getModSchemaBundle,
  clearCache,
};
