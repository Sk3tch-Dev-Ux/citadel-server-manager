/**
 * Expansion Docs Routes — serves the static reference data synced from
 * dayzexpansion.com (templates, mod metadata index).
 *
 * Source of truth: backend/schemas/expansion-templates/ and
 *                  backend/schemas/expansion/_mods.json
 *
 * Refresh by running: node scripts/sync-expansion-docs/sync.js
 *
 * GET  /api/expansion-docs/mods                    — Mod metadata index (24 mods)
 * GET  /api/expansion-docs/templates               — Template index (name + description)
 * GET  /api/expansion-docs/templates/:name         — Fetch one template by file basename
 * GET  /api/expansion-docs/forms                   — Form layouts
 * GET  /api/expansion-docs/version                 — Wiki version + sync timestamp
 */
const fs = require('fs');
const path = require('path');
const { auth } = require('../middleware/auth');
const { safeError } = require('../lib/http-errors');

const SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');
const MODS_INDEX = path.join(SCHEMAS_DIR, 'expansion', '_mods.json');
const MANIFEST = path.join(SCHEMAS_DIR, 'expansion', 'manifest.json');
const TEMPLATES_DIR = path.join(SCHEMAS_DIR, 'expansion-templates');
const FORMS_DIR = path.join(SCHEMAS_DIR, 'expansion-forms');

// Templates are read-only static data; cache them in memory.
let _modsCache = null;
let _templatesIndexCache = null;
let _formsCache = null;
let _versionCache = null;

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function getMods() {
  if (_modsCache) return _modsCache;
  if (!fs.existsSync(MODS_INDEX)) return {};
  _modsCache = readJSON(MODS_INDEX);
  return _modsCache;
}

function getTemplatesIndex() {
  if (_templatesIndexCache) return _templatesIndexCache;
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(TEMPLATES_DIR)) {
    if (!f.endsWith('.json') || f === '_index.json') continue;
    out.push({ name: f.replace(/\.json$/, ''), file: f });
  }
  _templatesIndexCache = out.sort((a, b) => a.name.localeCompare(b.name));
  return _templatesIndexCache;
}

function getForms() {
  if (_formsCache) return _formsCache;
  if (!fs.existsSync(FORMS_DIR)) return {};
  const out = {};
  for (const f of fs.readdirSync(FORMS_DIR)) {
    if (!f.endsWith('.json')) continue;
    out[f.replace(/\.json$/, '')] = readJSON(path.join(FORMS_DIR, f));
  }
  _formsCache = out;
  return _formsCache;
}

function getVersion() {
  if (_versionCache) return _versionCache;
  if (!fs.existsSync(MANIFEST)) return null;
  const m = readJSON(MANIFEST);
  _versionCache = {
    wikiVersion: m.wikiVersion,
    syncedAt: m.syncedAt,
    source: m.source,
    configFileCount: m.configFiles?.length || 0,
    modCount: Object.keys(getMods()).length,
    templateCount: getTemplatesIndex().length,
  };
  return _versionCache;
}

/** Reject obviously unsafe basenames before any disk access. */
function isSafeBasename(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]+$/.test(name);
}

module.exports = function(app) {

  app.get('/api/expansion-docs/version', auth(), (req, res) => {
    try {
      const v = getVersion();
      if (!v) return res.status(404).json({ error: 'Expansion docs not synced. Run scripts/sync-expansion-docs/sync.js.' });
      res.json(v);
    } catch (err) {
      safeError(res, err, 'Failed to read expansion docs version');
    }
  });

  app.get('/api/expansion-docs/mods', auth(), (req, res) => {
    try {
      res.json(getMods());
    } catch (err) {
      safeError(res, err, 'Failed to read mod metadata index');
    }
  });

  app.get('/api/expansion-docs/templates', auth(), (req, res) => {
    try {
      res.json(getTemplatesIndex());
    } catch (err) {
      safeError(res, err, 'Failed to read template index');
    }
  });

  app.get('/api/expansion-docs/templates/:name', auth(), (req, res) => {
    const { name } = req.params;
    if (!isSafeBasename(name)) {
      return res.status(400).json({ error: 'Invalid template name' });
    }
    const fpath = path.join(TEMPLATES_DIR, name + '.json');
    if (!fpath.startsWith(TEMPLATES_DIR + path.sep)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(fpath)) {
      return res.status(404).json({ error: 'Template not found' });
    }
    try {
      res.json(readJSON(fpath));
    } catch (err) {
      safeError(res, err, 'Failed to read template');
    }
  });

  app.get('/api/expansion-docs/forms', auth(), (req, res) => {
    try {
      res.json(getForms());
    } catch (err) {
      safeError(res, err, 'Failed to read forms');
    }
  });
};
