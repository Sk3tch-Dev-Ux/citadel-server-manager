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
const { safePath } = require('../lib/helpers');

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
let _fieldIndexCache = null;

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

/**
 * Build a flat field index across every template file. Powers the Cmd+K
 * Config Search modal — "what file holds the BaseBuildingRaidMode field?"
 * Audit N9.
 *
 * Each entry: { field, file, parent }
 *   - field:  the JSON property name as it appears in the template
 *   - file:   the template's basename (e.g. "RaidSettings")
 *   - parent: when the field lives inside a nested object, the parent
 *             property name (e.g. "Schedule"); otherwise null
 *
 * We index:
 *   - all top-level keys of the parsed template
 *   - one level deep into object values and array-of-object element shapes
 *
 * Skipped:
 *   - boilerplate keys (`m_Version`, `Version`)
 *   - arrays of primitives (nothing useful to index inside them)
 *
 * The index is built once and cached. Memory footprint at ~100 templates ×
 * ~30 fields each = ~3000 entries × ~80 bytes ≈ 250 KB. Acceptable.
 */
const FIELD_BLACKLIST = new Set(['m_Version', 'Version']);

function indexFieldsFromValue(file, parent, value, out) {
  if (value === null || value === undefined) return;
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const k of Object.keys(value)) {
      if (FIELD_BLACKLIST.has(k)) continue;
      out.push({ field: k, file, parent });
    }
  } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && !Array.isArray(value[0])) {
    // Array of objects — index the element-shape keys under the parent name.
    for (const k of Object.keys(value[0])) {
      if (FIELD_BLACKLIST.has(k)) continue;
      out.push({ field: k, file, parent });
    }
  }
}

function getFieldIndex() {
  if (_fieldIndexCache) return _fieldIndexCache;
  if (!fs.existsSync(TEMPLATES_DIR)) {
    _fieldIndexCache = [];
    return _fieldIndexCache;
  }
  const out = [];
  for (const f of fs.readdirSync(TEMPLATES_DIR)) {
    if (!f.endsWith('.json') || f === '_index.json') continue;
    let tpl;
    try { tpl = readJSON(path.join(TEMPLATES_DIR, f)); } catch { continue; }
    if (!tpl || typeof tpl.template !== 'string') continue;
    let parsed;
    try { parsed = JSON.parse(tpl.template); } catch { continue; }
    const file = f.replace(/\.json$/, '');
    // Top-level keys
    indexFieldsFromValue(file, null, parsed, out);
    // One level deep
    if (parsed && typeof parsed === 'object') {
      for (const topKey of Object.keys(parsed)) {
        if (FIELD_BLACKLIST.has(topKey)) continue;
        indexFieldsFromValue(file, topKey, parsed[topKey], out);
      }
    }
  }
  _fieldIndexCache = out;
  return _fieldIndexCache;
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
    // Audit N10 (2026-05-19): route the path build through safePath() so we
    // get the same case-insensitive traversal check used elsewhere, instead
    // of an ad-hoc startsWith() that could drift on case-insensitive FSes.
    const fpath = safePath(TEMPLATES_DIR, name + '.json');
    if (!fpath) {
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

  // Audit N9 — flat field index for the Cmd+K Config Search modal.
  // Built lazily on first request and cached for the process lifetime.
  app.get('/api/expansion-docs/field-index', auth(), (req, res) => {
    try {
      res.json(getFieldIndex());
    } catch (err) {
      safeError(res, err, 'Failed to build field index');
    }
  });
};
