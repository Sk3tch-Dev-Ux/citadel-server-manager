#!/usr/bin/env node
/**
 * Sync Citadel's Expansion schemas + manifest from a snapshot of
 * dayzexpansion.com (the snapshot lives in data/expansion-docs/source/).
 *
 * Outputs:
 *   backend/schemas/expansion/<File>.schema.json            (50 schemas)
 *   backend/schemas/expansion/manifest.json                 (rebuilt from upstream, w/ schemaFile pointers)
 *   backend/schemas/expansion/_mods.json                    (mod metadata index)
 *   backend/schemas/expansion-templates/<Template>.json     (117 skeleton configs)
 *   backend/schemas/expansion-forms/<Form>.json             (2 form layouts)
 *
 * Usage:
 *   node scripts/sync-expansion-docs/sync.js
 *   node scripts/sync-expansion-docs/sync.js --dry-run
 *   node scripts/sync-expansion-docs/sync.js --source path/to/expansion-data
 *
 * Designed to be idempotent and re-runnable on every wiki update. Pin the
 * upstream version via data/expansion-docs/source/manifest.json::wikiVersion.
 */

const fs = require('fs');
const path = require('path');
const { convertSchema } = require('./adapter');

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const SOURCE_ARG_IDX = ARGS.indexOf('--source');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_DIR = SOURCE_ARG_IDX >= 0
  ? path.resolve(ARGS[SOURCE_ARG_IDX + 1])
  : path.join(REPO_ROOT, 'data', 'expansion-docs', 'source');

const OUT_SCHEMAS = path.join(REPO_ROOT, 'backend', 'schemas', 'expansion');
const OUT_TEMPLATES = path.join(REPO_ROOT, 'backend', 'schemas', 'expansion-templates');
const OUT_FORMS = path.join(REPO_ROOT, 'backend', 'schemas', 'expansion-forms');

function log(msg) { console.log('[sync-expansion] ' + msg); }
function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJSON(p, data) {
  if (DRY_RUN) { log('would write ' + path.relative(REPO_ROOT, p)); return; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function listFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, pattern));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  log('source: ' + SOURCE_DIR);
  log('dry-run: ' + DRY_RUN);
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error('Source dir not found: ' + SOURCE_DIR);
    process.exit(1);
  }

  const sourceManifest = readJSON(path.join(SOURCE_DIR, 'manifest.json'));
  log('wiki version: ' + sourceManifest.wikiVersion + ' (generated ' + sourceManifest.generatedAt + ')');

  // ---------- 1. Schemas ----------
  const schemaFiles = listFiles(path.join(SOURCE_DIR, 'mods'), /\.schema\.json$/);
  log('found ' + schemaFiles.length + ' upstream schemas');

  const settingsByFileName = new Map();
  for (const src of schemaFiles) {
    const upstream = readJSON(src);
    const modId = upstream.linkedModId || path.basename(path.dirname(path.dirname(src)));
    const baseName = path.basename(src).replace(/\.schema\.json$/, '');
    const schema = convertSchema(upstream, { modId, displayName: upstream.name });
    const outPath = path.join(OUT_SCHEMAS, baseName + '.schema.json');
    writeJSON(outPath, schema);
    settingsByFileName.set(baseName, {
      modId,
      displayName: upstream.name,
      filePath: upstream.filePath,
      description: upstream.description,
      schemaFile: baseName + '.schema.json',
    });
  }
  log('wrote ' + settingsByFileName.size + ' draft-07 schemas');

  // ---------- 2. Mod metadata index ----------
  const modDirs = fs.readdirSync(path.join(SOURCE_DIR, 'mods'), { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);
  const mods = {};
  for (const modId of modDirs) {
    const metaPath = path.join(SOURCE_DIR, 'mods', modId, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    const m = readJSON(metaPath);
    mods[modId] = {
      id: m.id,
      name: m.name,
      shortName: m.shortName,
      version: m.version,
      modFolderName: m.modFolderName,
      workshopUrl: m.workshopUrl,
      experimentalWorkshopUrl: m.experimentalWorkshopUrl,
      isThirdParty: !!m.isThirdParty,
      includedInBundle: !!m.includedInBundle,
      description: m.description,
      dependencies: m.dependencies || [],
      conflicts: m.conflicts || [],
      linkedTools: m.linkedTools || [],
      linkedGuides: m.linkedGuides || [],
      wikiUrl: 'https://dayzexpansion.com/mods/' + m.id,
    };
  }
  writeJSON(path.join(OUT_SCHEMAS, '_mods.json'), mods);
  log('wrote mod metadata index: ' + Object.keys(mods).length + ' mods');

  // ---------- 3. Manifest ----------
  const configFiles = [];
  const entries = [...settingsByFileName].sort((a, b) => a[0].localeCompare(b[0]));
  for (const pair of entries) {
    const info = pair[1];
    const fp = info.filePath || '';
    const isMission = fp.startsWith('mpmissions/');
    let fileName = fp;
    if (isMission) fileName = fp.replace(/^mpmissions\/[^/]+\//, '');
    const entry = {
      fileName,
      displayName: info.displayName,
      description: info.description || '',
      modId: info.modId,
      schemaFile: info.schemaFile,
    };
    if (isMission) entry.location = 'mission';
    configFiles.push(entry);
  }

  const manifest = {
    modName: 'DayZ Expansion',
    description: 'The most popular DayZ mod suite — traders, territories, vehicles, AI, hardline, quests, missions, and more.',
    workshopId: '2572331007',
    dedicated: true,
    source: 'dayzexpansion.com',
    wikiVersion: sourceManifest.wikiVersion,
    syncedAt: new Date().toISOString(),
    configFiles,
  };
  writeJSON(path.join(OUT_SCHEMAS, 'manifest.json'), manifest);
  log('wrote manifest.json: ' + configFiles.length + ' config file entries');

  // ---------- 4. Templates ----------
  const tplDir = path.join(SOURCE_DIR, 'templates');
  if (fs.existsSync(tplDir)) {
    let count = 0;
    for (const f of fs.readdirSync(tplDir)) {
      if (!f.endsWith('.json')) continue;
      const data = readJSON(path.join(tplDir, f));
      writeJSON(path.join(OUT_TEMPLATES, f), data);
      count++;
    }
    log('wrote ' + count + ' templates');
  }

  // ---------- 5. Forms ----------
  const formDir = path.join(SOURCE_DIR, 'forms');
  if (fs.existsSync(formDir)) {
    let count = 0;
    for (const f of fs.readdirSync(formDir)) {
      if (!f.endsWith('.json')) continue;
      const data = readJSON(path.join(formDir, f));
      writeJSON(path.join(OUT_FORMS, f), data);
      count++;
    }
    log('wrote ' + count + ' forms');
  }

  log('sync complete');
}

main();
