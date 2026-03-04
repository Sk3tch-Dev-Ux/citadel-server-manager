/**
 * Item database routes — parses types.xml for searchable item list.
 *
 * GET /api/servers/:id/items — returns all item classnames + categories
 * from the server's types.xml in its mission folder.
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

// ─── types.xml Parser ────────────────────────────────────────

/**
 * Parse types.xml with regex — no xml2js dependency needed.
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
  // Sort alphabetically for consistent display
  items.sort((a, b) => a.className.localeCompare(b.className));
  return items;
}

// ─── In-Memory Cache ─────────────────────────────────────────

const itemCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Route ───────────────────────────────────────────────────

module.exports = function(app) {

  app.get('/api/servers/:id/items', authForServer('server.view'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    // Check cache
    const cached = itemCache[srv.id];
    if (cached && (Date.now() - cached.loadedAt < CACHE_TTL)) {
      return res.json(cached.items);
    }

    const missionFolder = detectMissionFolder(srv.installDir);
    if (!missionFolder) {
      return res.status(404).json({ error: 'Mission folder not found — deploy a server first' });
    }

    const typesPath = path.join(srv.installDir, 'mpmissions', missionFolder, 'db', 'types.xml');
    if (!fs.existsSync(typesPath)) {
      return res.status(404).json({ error: 'types.xml not found at ' + typesPath });
    }

    try {
      const content = fs.readFileSync(typesPath, 'utf8');
      const items = parseTypesXml(content);

      // Cache result
      itemCache[srv.id] = { items, loadedAt: Date.now() };

      logger.debug({ serverId: srv.id, count: items.length }, 'Parsed types.xml for item list');
      res.json(items);
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to parse types.xml');
      res.status(500).json({ error: err.message });
    }
  });
};
