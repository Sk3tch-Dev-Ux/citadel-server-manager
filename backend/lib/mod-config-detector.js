/**
 * Mod Config Detector — Auto-detect installed mods and locate their config files.
 *
 * Scans a server's mod directories (@ModName) and matches them against known
 * mod schemas to determine which configs are available for editing.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const logger = require('./logger');

/**
 * Known mod identifiers — maps Workshop IDs and directory name patterns
 * to our internal schema IDs. This allows detection even if the mod folder
 * is renamed or the workshopId is missing from meta.cpp.
 */
const MOD_IDENTIFIERS = {
  // Expansion (Bundle or Licensed — not @CF which is just Community Framework)
  'expansion': {
    schemaId: 'expansion',
    workshopIds: ['2572331007', '2116157322', '2291785308', '2792983762'],
    dirPatterns: [/^@.*expansion/i, /^@dayzexpansion/i],
  },
  // TraderPlus
  'traderplus': {
    schemaId: 'traderplus',
    workshopIds: ['2458896948'],
    dirPatterns: [/^@traderplus/i],
  },
  // Dr. Jones / Trader
  'drjones-trader': {
    schemaId: 'drjones-trader',
    workshopIds: ['1590841260'],
    dirPatterns: [/^@trader$/i, /^@drjones/i],
  },
  // Dabs Framework
  'dabs-framework': {
    schemaId: 'dabs-framework',
    workshopIds: ['2545327648'],
    dirPatterns: [/^@dabs/i, /^@dabsframework/i],
  },
  // Banking
  'banking': {
    schemaId: 'banking',
    workshopIds: ['2569522069'],
    dirPatterns: [/^@banking/i],
  },
  // Base Building Plus
  'bbp': {
    schemaId: 'bbp',
    workshopIds: ['1710977250'],
    dirPatterns: [/^@bbp/i, /^@basebuildingplus/i],
  },
};

/**
 * Detect installed mods that have config schemas available.
 *
 * @param {string} serverId - Server ID to check
 * @returns {Array<{ schemaId, modName, workshopId, configDir }>} Detected mods with schema support
 */
function detectModConfigs(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return [];

  const state = ctx.serverStates[serverId];
  const modList = state?.modList || [];
  const installDir = srv.installDir;
  const detected = [];
  const seenSchemaIds = new Set(); // Deduplicate — only one entry per schema

  for (const mod of modList) {
    const modDir = path.join(installDir, mod.name);
    if (!fs.existsSync(modDir)) continue;

    // Try to match this mod to a known schema
    for (const [, identifier] of Object.entries(MOD_IDENTIFIERS)) {
      // Skip if we already detected this schema from another mod folder
      if (seenSchemaIds.has(identifier.schemaId)) continue;

      let matched = false;

      // Match by workshop ID
      if (mod.workshopId && identifier.workshopIds.includes(mod.workshopId)) {
        matched = true;
      }

      // Match by directory name pattern
      if (!matched) {
        for (const pattern of identifier.dirPatterns) {
          if (pattern.test(mod.name)) {
            matched = true;
            break;
          }
        }
      }

      if (matched) {
        seenSchemaIds.add(identifier.schemaId);
        detected.push({
          schemaId: identifier.schemaId,
          modName: mod.name,
          workshopId: mod.workshopId || '',
          modDir,
        });
        break; // Don't match the same mod to multiple schemas
      }
    }
  }

  return detected;
}

/**
 * Find config files for a specific mod on a server.
 * Searches common config locations:
 *   1. Server profile directory (e.g., profiles/ExpansionMod/)
 *   2. Mod directory itself
 *   3. Mission folder
 *
 * @param {object} srv - Server config object
 * @param {string} modDir - Mod directory path
 * @param {Array<string>} configFileNames - List of config file names to look for
 * @returns {Object<string, string>} Map of configFileName -> fullPath
 */
function findModConfigFiles(srv, modDir, configFileNames) {
  const found = {};
  const profileDir = srv.profileDir
    ? path.resolve(srv.installDir, srv.profileDir)
    : path.join(srv.installDir, 'profiles');

  for (const fileName of configFileNames) {
    // Search locations in priority order
    // fileName may be a relative path like "ExpansionMod/Settings/GeneralSettings.json"
    // or just a filename like "config.json"
    const candidates = [];

    // Profile root + relative path (most common — e.g. profiles/ExpansionMod/Settings/GeneralSettings.json)
    candidates.push(path.join(profileDir, fileName));

    // Server install root + relative path
    candidates.push(path.join(srv.installDir, fileName));

    // Mod directory + relative path
    candidates.push(path.join(modDir, fileName));

    // Also try just the basename in common locations (for simple filenames)
    const baseName = path.basename(fileName);
    if (baseName !== fileName) {
      // Profile subdirectories with just the basename
      if (fs.existsSync(profileDir)) {
        try {
          const profileSubdirs = fs.readdirSync(profileDir, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name);
          for (const sub of profileSubdirs) {
            candidates.push(path.join(profileDir, sub, baseName));
          }
        } catch { /* ignore */ }
      }
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        found[fileName] = candidate;
        break;
      }
    }
  }

  return found;
}

module.exports = {
  MOD_IDENTIFIERS,
  detectModConfigs,
  findModConfigFiles,
};
