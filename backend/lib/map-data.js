/**
 * Live Map data aggregation — players, vehicles, and dynamic events.
 * Provides unified map data for the frontend Leaflet map.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const ctx = require('./context');
const { findRPTFiles } = require('./profile-resolver');

// ─── Map Configurations ─────────────────────────────────
const MAP_CONFIGS = {
  chernarusplus: { name: 'Chernarus', width: 15360, height: 15360, image: 'chernarus.jpg' },
  enoch:         { name: 'Livonia',   width: 12800, height: 12800, image: 'livonia.jpg' },
  deerisle:      { name: 'Deer Isle', width: 16384, height: 16384, image: 'deerisle.jpg' },
  namalsk:       { name: 'Namalsk',   width: 12800, height: 12800, image: 'namalsk.jpg' },
  sakhal:        { name: 'Sakhal',    width: 12800, height: 12800, image: 'sakhal.jpg' },
  takistanplus:  { name: 'Takistan',  width: 12800, height: 12800, image: 'takistan.jpg' },
};

// Template-to-map-key mapping (DayZ template names → our config keys)
const TEMPLATE_MAP = {
  'dayzoffline.chernarusplus': 'chernarusplus',
  'dayzoffline.enoch': 'enoch',
  'dayz.chernarusplus': 'chernarusplus',
  'dayz.enoch': 'enoch',
  'dayzoffline.deerisle': 'deerisle',
  'dayz.deerisle': 'deerisle',
  'dayzoffline.namalsk': 'namalsk',
  'dayz.namalsk': 'namalsk',
  'dayzoffline.sakhal': 'sakhal',
  'dayz.sakhal': 'sakhal',
  'dayzoffline.takistanplus': 'takistanplus',
  'dayz.takistanplus': 'takistanplus',
};

// ─── In-memory event cache per server ────────────────────
// Stores detected dynamic events with TTL
const serverEvents = {}; // { serverId: [{ id, type, displayName, icon, position, detectedAt, expiresAt }] }

// ─── RPT Event Detection Patterns ───────────────────────
const EVENT_PATTERNS = [
  // Helicopter crash sites
  {
    regex: /Spawning loot on[\s:]+(\S*(?:CrashSite|crash|Heli)[^\s]*)\s+at\s+pos\s*[<\[]?\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i,
    type: 'helicrash',
    displayName: 'Helicopter Crash',
    icon: 'helicopter',
    ttl: 45 * 60 * 1000, // 45 minutes
  },
  {
    regex: /(?:Dynamic event|CrashSite)\s+.*?(?:created|spawned)\s+.*?at\s+[<\[]?\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i,
    type: 'helicrash',
    displayName: 'Helicopter Crash',
    icon: 'helicopter',
    ttl: 45 * 60 * 1000,
  },
  // Airdrop events
  {
    regex: /(?:Airdrop|AirDrop)\s+.*?(?:spawned|created|landed)\s+.*?at\s+[<\[]?\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i,
    type: 'airdrop',
    displayName: 'Airdrop',
    icon: 'parachute',
    ttl: 30 * 60 * 1000,
  },
  // Contamination zones
  {
    regex: /(?:Contamination|ContaminatedArea)\s+.*?(?:triggered|activated|spawned)\s+.*?at\s+[<\[]?\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i,
    type: 'contamination',
    displayName: 'Contamination Zone',
    icon: 'biohazard',
    ttl: 60 * 60 * 1000,
  },
  // Animal herds / hordes
  {
    regex: /(?:InfectedHorde|ZombieHorde)\s+.*?(?:spawned|created)\s+.*?at\s+[<\[]?\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i,
    type: 'horde',
    displayName: 'Infected Horde',
    icon: 'skull',
    ttl: 20 * 60 * 1000,
  },
];

/**
 * Detect map key from server config template field.
 */
function detectMapKey(server) {
  const template = server.template || '';
  // Direct template mapping
  for (const [tmpl, key] of Object.entries(TEMPLATE_MAP)) {
    if (template.toLowerCase().includes(tmpl.toLowerCase())) return key;
  }
  // Try to match from mpmissions folder name
  const installDir = server.installDir;
  if (installDir) {
    try {
      const mpDir = path.join(installDir, 'mpmissions');
      if (fs.existsSync(mpDir)) {
        const dirs = fs.readdirSync(mpDir).filter(d =>
          fs.statSync(path.join(mpDir, d)).isDirectory()
        );
        for (const dir of dirs) {
          const lower = dir.toLowerCase();
          for (const key of Object.keys(MAP_CONFIGS)) {
            if (lower.includes(key)) return key;
          }
        }
      }
    } catch { /* ignore */ }
  }
  return 'chernarusplus'; // default
}

/**
 * Get map configuration for a server.
 */
function getMapConfig(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return null;

  const mapKey = detectMapKey(srv);
  const config = MAP_CONFIGS[mapKey] || MAP_CONFIGS.chernarusplus;

  return {
    mapKey,
    ...config,
    imagePath: `/maps/${config.image}`,
    bounds: [[0, 0], [config.height, config.width]],
  };
}

/**
 * Get player data formatted for the live map.
 * Uses already-fetched player data from the server state.
 */
function getMapPlayers(serverId) {
  const state = ctx.serverStates[serverId];
  if (!state) return [];

  return (state.players || [])
    .filter(p => p.position)
    .map(p => ({
      id: p.id || p.steamId,
      name: p.name,
      steamId: p.steamId,
      position: {
        x: p.position.x || 0,
        z: p.position.z || p.position.y || 0, // Z is north-south in DayZ
        y: p.position.y || 0, // Y is altitude
      },
      ping: p.ping || 0,
      loaded: p.loaded !== false,
    }));
}

/**
 * Get vehicle data from state cache (populated by sidecar polling or custom API).
 */
function getMapVehicles(serverId) {
  const state = ctx.serverStates[serverId];
  if (!state || !state.vehicles) return [];

  return (state.vehicles || []).map(v => ({
    id: v.id,
    className: v.className,
    displayName: v.displayName || prettifyClassName(v.className),
    vehicleType: v.vehicleType || 'car',
    icon: v.icon || 'car',
    position: {
      x: v.position?.x || v.position?.[0] || 0,
      z: v.position?.z || v.position?.[2] || 0,
      y: v.position?.y || v.position?.[1] || 0,
    },
    health: v.health || 0,
    speed: v.speed || 0,
  }));
}

/**
 * Get dynamic events (from RPT parsing + manual cache).
 */
function getMapEvents(serverId) {
  if (!serverEvents[serverId]) serverEvents[serverId] = [];

  // Purge expired events
  const now = Date.now();
  serverEvents[serverId] = serverEvents[serverId].filter(e => e.expiresAt > now);

  return serverEvents[serverId].map(e => ({
    id: e.id,
    type: e.type,
    displayName: e.displayName,
    icon: e.icon,
    position: e.position,
    detectedAt: e.detectedAt,
    expiresAt: e.expiresAt,
    age: Math.round((now - e.detectedAt) / 60000), // minutes ago
  }));
}

/**
 * Parse RPT log for dynamic events.
 * Called during polling to detect new events.
 */
function scrapeRPTForEvents(server) {
  try {
    const files = findRPTFiles(server);
    if (files.length === 0) return;

    const rptPath = files[0].fullPath;
    const stat = fs.statSync(rptPath);
    // Read last 64KB to catch recent events
    const readSize = Math.min(stat.size, 64 * 1024);
    const fd = fs.openSync(rptPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    const content = buf.toString('utf8');

    if (!serverEvents[server.id]) serverEvents[server.id] = [];
    const existing = new Set(serverEvents[server.id].map(e => e.id));

    for (const pattern of EVENT_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags + 'g');
      while ((match = regex.exec(content)) !== null) {
        // Extract position — pattern groups vary, find the 3 numbers
        let x, y, z;
        const nums = match.slice(1).filter(g => g && /^[\d.]+$/.test(g));
        if (nums.length >= 3) {
          x = parseFloat(nums[0]);
          y = parseFloat(nums[1]);
          z = parseFloat(nums[2]);
        } else if (nums.length >= 2) {
          x = parseFloat(nums[0]);
          z = parseFloat(nums[1]);
          y = 0;
        } else {
          continue;
        }

        // Generate unique ID from type + approximate position (rounded to 100m grid)
        const gridX = Math.round(x / 100);
        const gridZ = Math.round(z / 100);
        const eventId = `${pattern.type}_${gridX}_${gridZ}`;

        if (!existing.has(eventId)) {
          existing.add(eventId);
          serverEvents[server.id].push({
            id: eventId,
            type: pattern.type,
            displayName: pattern.displayName,
            icon: pattern.icon,
            position: { x, y, z },
            detectedAt: Date.now(),
            expiresAt: Date.now() + pattern.ttl,
          });
          logger.info({ serverId: server.id, event: pattern.type, x, z }, 'Dynamic event detected from RPT');
        }
      }
    }
  } catch (err) {
    logger.debug({ err: err.message, serverId: server.id }, 'RPT event scrape failed');
  }
}

/**
 * Get combined map data for a server.
 */
function getMapData(serverId) {
  return {
    players: getMapPlayers(serverId),
    vehicles: getMapVehicles(serverId),
    events: getMapEvents(serverId),
    timestamp: Date.now(),
  };
}

/**
 * Add a manual event (e.g., from external API or admin action).
 */
function addMapEvent(serverId, event) {
  if (!serverEvents[serverId]) serverEvents[serverId] = [];
  serverEvents[serverId].push({
    id: event.id || `manual_${Date.now()}`,
    type: event.type || 'custom',
    displayName: event.displayName || event.type,
    icon: event.icon || 'marker',
    position: event.position,
    detectedAt: Date.now(),
    expiresAt: Date.now() + (event.ttl || 30 * 60 * 1000),
  });
}

/**
 * Replace the event cache for a server with mod-sourced world events.
 * The mod provides a full snapshot every ~10s, so we REPLACE (not append).
 * Uses a 60-minute TTL for mod-sourced events.
 *
 * @param {string} serverId
 * @param {Array} modEvents - [{id, className, displayName, icon, position: {x,y,z}}]
 */
function updateWorldEventsFromMod(serverId, modEvents) {
  if (!Array.isArray(modEvents)) return;

  const MOD_EVENT_TTL = 60 * 60 * 1000; // 60 minutes
  const now = Date.now();

  serverEvents[serverId] = modEvents.map(e => ({
    id: e.id || `mod_${e.className}_${now}`,
    type: e.className,
    displayName: e.displayName || e.className,
    icon: e.icon || 'marker',
    position: e.position || { x: 0, y: 0, z: 0 },
    detectedAt: now,
    expiresAt: now + MOD_EVENT_TTL,
  }));

  logger.debug({ serverId, count: modEvents.length }, 'World events updated from mod');
}

/**
 * Clear all events for a server.
 */
function clearMapEvents(serverId) {
  serverEvents[serverId] = [];
}

/**
 * Prettify a DayZ class name for display.
 * e.g., "OffroadHatchback_White" → "Offroad Hatchback (White)"
 */
function prettifyClassName(className) {
  if (!className) return 'Unknown';
  // Split on underscores and camelCase
  const parts = className
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return parts;
}

module.exports = {
  MAP_CONFIGS,
  getMapConfig,
  getMapData,
  getMapPlayers,
  getMapVehicles,
  getMapEvents,
  scrapeRPTForEvents,
  addMapEvent,
  updateWorldEventsFromMod,
  clearMapEvents,
  detectMapKey,
  prettifyClassName,
};
