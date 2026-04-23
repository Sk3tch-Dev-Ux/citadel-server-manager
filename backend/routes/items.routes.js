const { safeError } = require('../lib/http-errors');
/**
 * Item database routes — parses ALL types XML files for searchable item list.
 *
 * GET /api/servers/:id/items — returns all item classnames + categories
 * by scanning cfgeconomycore.xml for every CE folder and types file.
 *
 * This catches vanilla types.xml AND mod types:
 *   - db/types.xml (vanilla)
 *   - expansion_ce/expansion_types.xml (Expansion)
 *   - trader_ce/trader_types.xml (traders)
 *   - custom_ce/*.xml (server-specific)
 *   - etc.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { readServerConfig } = require('../lib/dayz-config');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');

// ─── Mission Folder Detection (shared pattern with dangerzone.routes) ────

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

// ─── cfgeconomycore.xml Scanner ──────────────────────────────

/**
 * Parse cfgeconomycore.xml to find ALL types XML files across all CE folders.
 *
 * Structure:
 *   <economycore>
 *     <ce folder="db">
 *       <file name="types.xml" type="types" />
 *     </ce>
 *     <ce folder="expansion_ce">
 *       <file name="expansion_types.xml" type="types" />
 *     </ce>
 *   </economycore>
 *
 * Returns array of absolute paths to all types files.
 */
function findAllTypesFiles(missionDir) {
  const typesFiles = [];
  const economyCorePath = path.join(missionDir, 'cfgeconomycore.xml');

  if (fs.existsSync(economyCorePath)) {
    try {
      const content = fs.readFileSync(economyCorePath, 'utf8');

      // Match each <ce folder="..."> block
      const ceRegex = /<ce\s+folder="([^"]+)"[^>]*>([\s\S]*?)<\/ce>/gi;
      let ceMatch;
      while ((ceMatch = ceRegex.exec(content)) !== null) {
        const folder = ceMatch[1];
        const body = ceMatch[2];

        // Find all <file name="..." type="types" /> entries within this CE block
        const fileRegex = /<file\s+[^>]*name="([^"]+)"[^>]*type="types"[^>]*\/>/gi;
        // Also match reversed attribute order: type before name
        const fileRegex2 = /<file\s+[^>]*type="types"[^>]*name="([^"]+)"[^>]*\/>/gi;

        let fileMatch;
        while ((fileMatch = fileRegex.exec(body)) !== null) {
          const filePath = path.join(missionDir, folder, fileMatch[1]);
          if (fs.existsSync(filePath)) typesFiles.push(filePath);
        }
        while ((fileMatch = fileRegex2.exec(body)) !== null) {
          const filePath = path.join(missionDir, folder, fileMatch[1]);
          if (fs.existsSync(filePath) && !typesFiles.includes(filePath)) {
            typesFiles.push(filePath);
          }
        }
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to parse cfgeconomycore.xml');
    }
  }

  // Fallback: always include db/types.xml if it exists and wasn't already found
  const defaultTypes = path.join(missionDir, 'db', 'types.xml');
  if (fs.existsSync(defaultTypes) && !typesFiles.includes(defaultTypes)) {
    typesFiles.unshift(defaultTypes);
  }

  return typesFiles;
}

// ─── types.xml Parser ────────────────────────────────────────

/**
 * Parse a types XML file with regex — no xml2js dependency needed.
 * Extracts className and category from <type name="..."><category name="..."/></type>
 */
function parseTypesXml(content) {
  const items = [];
  const typeRegex = /<type\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/type>/gi;
  let match;
  while ((match = typeRegex.exec(content)) !== null) {
    const className = match[1];
    const body = match[2];
    const catMatch = body.match(/<category\s+name="([^"]+)"/i);
    const category = catMatch ? catMatch[1] : '';
    items.push({ className, category });
  }
  return items;
}

/**
 * Collect items from ALL types files found via cfgeconomycore.xml.
 * Deduplicates by className (first occurrence wins for category).
 */
function collectAllItems(missionDir) {
  const typesFiles = findAllTypesFiles(missionDir);
  const seen = new Set();
  const allItems = [];
  let sourceCount = 0;

  for (const filePath of typesFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const items = parseTypesXml(content);
      let added = 0;
      for (const item of items) {
        if (!seen.has(item.className)) {
          seen.add(item.className);
          // Tag which source file this came from
          const source = path.basename(path.dirname(filePath)) + '/' + path.basename(filePath);
          allItems.push({ className: item.className, category: item.category, source });
          added++;
        }
      }
      if (added > 0) sourceCount++;
    } catch (err) {
      logger.warn({ err: err.message, file: filePath }, 'Failed to parse types file');
    }
  }

  // Sort alphabetically
  allItems.sort((a, b) => a.className.localeCompare(b.className));

  logger.debug({ count: allItems.length, sources: sourceCount, files: typesFiles.length },
    'Collected items from all CE types files');

  return allItems;
}

// ─── In-Memory Cache ─────────────────────────────────────────

const itemCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Route ───────────────────────────────────────────────────

module.exports = function(app) {

  app.get('/api/servers/:id/items', authForServer('server.view'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    // Check cache (bypass with ?refresh=1)
    const cached = itemCache[srv.id];
    if (cached && (Date.now() - cached.loadedAt < CACHE_TTL) && !req.query.refresh) {
      return res.json(cached.items);
    }

    const missionFolder = detectMissionFolder(srv.installDir);
    if (!missionFolder) {
      return res.status(404).json({ error: 'Mission folder not found — deploy a server first' });
    }

    const missionDir = path.join(srv.installDir, 'mpmissions', missionFolder);
    if (!fs.existsSync(missionDir)) {
      return res.status(404).json({ error: 'Mission directory not found' });
    }

    try {
      const items = collectAllItems(missionDir);

      if (items.length === 0) {
        return res.status(404).json({ error: 'No types files found — check cfgeconomycore.xml' });
      }

      // Cache result
      itemCache[srv.id] = { items, loadedAt: Date.now() };

      res.json(items);
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to collect items');
      safeError(err, req, res, { status: 500 });
    }
  });
};
