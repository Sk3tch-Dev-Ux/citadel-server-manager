/**
 * Mod Config Detector — Auto-detect installed mods and locate their config files.
 *
 * Scans a server's mod directories (@ModName) and matches them against known
 * mod schemas to determine which configs are available for editing.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('./context');

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

  // Detect mission folder for configs that live there (e.g. Expansion MapSettings, BaseBuildingSettings)
  const { getMissionDir } = require('./mission-folder');
  const missionDir = getMissionDir(srv);

  for (const fileName of configFileNames) {
    // Search locations in priority order
    // fileName may be a relative path like "ExpansionMod/Settings/GeneralSettings.json"
    // or just a filename like "config.json"
    const candidates = [];

    // Profile root + relative path (most common — e.g. profiles/ExpansionMod/Settings/GeneralSettings.json)
    candidates.push(path.join(profileDir, fileName));

    // Mission folder + relative path (e.g. mpmissions/<template>/expansion/settings/MapSettings.json)
    if (missionDir) {
      candidates.push(path.join(missionDir, fileName));
      // Also try common Expansion mission-folder pattern
      const baseName = path.basename(fileName);
      candidates.push(path.join(missionDir, 'expansion', 'settings', baseName));
    }

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

/**
 * Directories under profiles/ that are handled by dedicated editors or that
 * shouldn't appear in generic mod-config auto-detection:
 *   - ExpansionMod       — has its own editor at /servers/:id/expansion
 *   - BattlEye / battleye — anti-cheat configs, not user-editable
 *   - DayZServer          — server runtime state (rpt, bans, etc.)
 *   - storage_*           — economy persistence, not config
 *   - db                  — economy persistence
 *   - `.`-prefixed         — dotfiles
 */
const AUTODETECT_IGNORE = new Set([
  'expansionmod',
  'battleye',
  'dayzserver',
  'db',
  'logs',
]);

function _isIgnored(name) {
  if (!name) return true;
  if (name.startsWith('.')) return true;
  const lower = name.toLowerCase();
  if (AUTODETECT_IGNORE.has(lower)) return true;
  if (lower.startsWith('storage_')) return true;
  return false;
}

/**
 * Resolve a server's profile dir the same way findModConfigFiles does.
 * Returns an absolute path, or null if none can be determined.
 */
function _resolveProfileDir(srv) {
  if (!srv || !srv.installDir) return null;
  const candidates = [];
  if (srv.profileDir) candidates.push(path.resolve(srv.installDir, srv.profileDir));
  candidates.push(path.join(srv.installDir, 'profiles'));
  candidates.push(path.join(srv.installDir, 'profile'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Walk a profile directory and return every `.json` config file, grouped by
 * the top-level folder (which is treated as the mod name).
 *
 * Loose JSON files directly under profiles/ (no containing folder) are grouped
 * under an "(unsorted)" bucket so they're still visible.
 *
 * Safety:
 *   - Depth-limited to 4 levels below profiles/ (plenty for any real mod)
 *   - Caps total scanned files at 2000 to prevent pathological trees
 *   - Silently skips symlinks (avoids cycles)
 *   - Skips `AUTODETECT_IGNORE` subtrees (Expansion has its own editor, etc.)
 *
 * @param {object} srv — server config
 * @returns {{ profileDir: string|null, groups: Array<{ modName: string, files: Array<{fileName, relativePath, absolutePath, size, modifiedAt}> }>, truncated: boolean }}
 */
function scanProfileForConfigs(srv) {
  const profileDir = _resolveProfileDir(srv);
  if (!profileDir) return { profileDir: null, groups: [], truncated: false };

  const MAX_DEPTH = 4;
  const MAX_FILES = 2000;
  let totalScanned = 0;
  let truncated = false;

  /** @type {Map<string, Array<{fileName, relativePath, absolutePath, size, modifiedAt}>>} */
  const byMod = new Map();

  function walk(dir, modGroup, depth) {
    if (depth > MAX_DEPTH) return;
    if (totalScanned >= MAX_FILES) { truncated = true; return; }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (totalScanned >= MAX_FILES) { truncated = true; return; }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, modGroup, depth + 1);
      } else if (entry.isFile()) {
        totalScanned++;
        if (!entry.name.toLowerCase().endsWith('.json')) continue;
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        const rel = path.relative(profileDir, full).replace(/\\/g, '/');
        const arr = byMod.get(modGroup) || [];
        arr.push({
          fileName: entry.name,
          relativePath: rel,
          absolutePath: full,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
        byMod.set(modGroup, arr);
      }
    }
  }

  // Top-level: every subdir of profileDir is a potential "mod". Loose JSONs go to (unsorted).
  let topEntries;
  try {
    topEntries = fs.readdirSync(profileDir, { withFileTypes: true });
  } catch {
    return { profileDir, groups: [], truncated: false };
  }

  for (const entry of topEntries) {
    if (totalScanned >= MAX_FILES) { truncated = true; break; }
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (_isIgnored(entry.name)) continue;
      walk(path.join(profileDir, entry.name), entry.name, 1);
    } else if (entry.isFile()) {
      totalScanned++;
      if (!entry.name.toLowerCase().endsWith('.json')) continue;
      if (_isIgnored(entry.name)) continue;
      let stat;
      try { stat = fs.statSync(path.join(profileDir, entry.name)); } catch { continue; }
      const arr = byMod.get('(unsorted)') || [];
      arr.push({
        fileName: entry.name,
        relativePath: entry.name,
        absolutePath: path.join(profileDir, entry.name),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
      byMod.set('(unsorted)', arr);
    }
  }

  // Sort files within each group by relativePath for stable display
  const groups = Array.from(byMod.entries())
    .map(([modName, files]) => ({
      modName,
      files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    }))
    .sort((a, b) => {
      // (unsorted) goes last; otherwise alphabetical
      if (a.modName === '(unsorted)') return 1;
      if (b.modName === '(unsorted)') return -1;
      return a.modName.localeCompare(b.modName);
    })
    .filter((g) => g.files.length > 0);

  return { profileDir, groups, truncated };
}

/**
 * Validate that a relative path stays inside the server's profile dir.
 * Returns the absolute path if safe, or null if traversal is attempted.
 */
function resolveDetectedConfigPath(srv, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return null;
  const profileDir = _resolveProfileDir(srv);
  if (!profileDir) return null;
  const abs = path.resolve(profileDir, relativePath);
  const rel = path.relative(profileDir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  // Reject ignored subtrees even if the caller passes them explicitly
  const topSegment = rel.split(/[\\/]/)[0];
  if (_isIgnored(topSegment)) return null;
  // Only JSON files are editable through this surface
  if (!abs.toLowerCase().endsWith('.json')) return null;
  return abs;
}

module.exports = {
  MOD_IDENTIFIERS,
  detectModConfigs,
  findModConfigFiles,
  scanProfileForConfigs,
  resolveDetectedConfigPath,
};
