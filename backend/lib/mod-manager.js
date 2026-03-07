/**
 * Mod detection, installation, reordering, type management, and launch params
 * management for DayZ servers.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const ctx = require('./context');
const { copyDirSync } = require('./helpers');
const { saveJSON } = require('./data-store');
const { addLog } = require('./audit');

/**
 * Sanitize mod folder names on disk — rename any @-prefixed directory that
 * contains spaces (DayZ's -mod= parameter uses spaces as delimiters).
 * Returns the list of sanitized folder names.
 */
function sanitizeModFolders(installDir) {
  let entries;
  try {
    entries = fs.readdirSync(installDir, { withFileTypes: true });
  } catch (err) {
    logger.debug({ err, installDir }, 'Failed to read install dir for folder sanitization');
    return [];
  }
  const modDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('@'));
  const result = [];
  for (const entry of modDirs) {
    if (/\s/.test(entry.name)) {
      const safeName = entry.name.replace(/\s/g, '');
      const oldPath = path.join(installDir, entry.name);
      const newPath = path.join(installDir, safeName);
      try {
        if (fs.existsSync(newPath)) {
          // Target already exists — remove the space-named duplicate
          fs.rmSync(oldPath, { recursive: true, force: true });
          logger.info({ from: entry.name, to: safeName }, 'Removed duplicate mod folder with spaces');
        } else {
          fs.renameSync(oldPath, newPath);
          logger.info({ from: entry.name, to: safeName }, 'Renamed mod folder to remove spaces');
        }
        result.push(safeName);
      } catch (err) {
        logger.warn({ err, from: entry.name }, 'Failed to rename mod folder');
        result.push(entry.name); // keep original if rename fails
      }
    } else {
      result.push(entry.name);
    }
  }
  return result;
}

/**
 * Extract the full value of a -mod= or -serverMod= parameter from a launch
 * params string.  Captures from the = sign up to the next recognized DayZ
 * launch parameter (-<letter>) or end of string.  Handles corrupted values
 * that may contain spaces from old folder names.
 */
function extractParamValue(params, paramName) {
  // Match -paramName= then everything up to the next " -letter" or end of string
  const re = new RegExp(`-${paramName}=(.*?)(?=\\s+-[a-zA-Z]|$)`, 'i');
  const m = params.match(re);
  if (!m) return '';
  return m[1].replace(/["]/g, '').trim();
}

/**
 * Auto-detect installed mods by scanning for @-prefixed directories.
 * Parses meta.cpp for workshop IDs and checks launchParams for active mods.
 * Preserves existing `type` field if the mod was already in the list.
 */
function autoDetectMods(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return;
  const state = ctx.serverStates[serverId];
  if (!state) return;
  const installDir = srv.installDir;

  // Sanitize folder names first (rename any with spaces)
  const installedMods = sanitizeModFolders(installDir);
  if (!installedMods.length) return;

  // Build sets of active mods from both -mod= and -serverMod= params
  const params = srv.launchParams || '';
  const activeMods = new Set();
  const serverMods = new Set();
  const modValue = extractParamValue(params, 'mod');
  if (modValue) {
    modValue.split(';').forEach(m => { const t = m.trim(); if (t) activeMods.add(t); });
  }
  const serverModValue = extractParamValue(params, 'serverMod');
  if (serverModValue) {
    serverModValue.split(';').forEach(m => { const t = m.trim(); if (t) serverMods.add(t); });
  }

  // Build a lookup of existing modList entries to preserve type
  const existingByName = {};
  if (state.modList) {
    for (const m of state.modList) {
      existingByName[m.name] = m;
    }
  }

  state.modList = installedMods.map((name, index) => {
    let workshopId = '';
    try {
      const metaPath = path.join(installDir, name, 'meta.cpp');
      if (fs.existsSync(metaPath)) { const meta = fs.readFileSync(metaPath, 'utf8'); const m = meta.match(/publishedid\s*=\s*(\d+)/i); if (m) workshopId = m[1]; }
    } catch (err) {
      logger.debug({ err, mod: name }, 'Failed to read meta.cpp');
    }
    const existing = existingByName[name];
    // Determine type: if it appears in -serverMod=, mark as server; preserve existing; default to client
    let type = 'client';
    if (serverMods.has(name)) {
      type = 'server';
    } else if (existing && existing.type) {
      type = existing.type;
    }
    const enabled = (activeMods.size === 0 && serverMods.size === 0) ? true : (activeMods.has(name) || serverMods.has(name));
    return { name, workshopId, enabled, order: index, type };
  });
  if (ctx.io) ctx.io.emit('mods', { serverId, mods: state.modList });
}

/**
 * Validate that a mod installation is complete and healthy.
 * Checks for key signature files, non-empty directory, reasonable file count.
 * Returns { valid: boolean, error?: string }
 */
function validateModInstallation(modPath, workshopId) {
  try {
    // Check mod directory exists and is not empty
    const entries = fs.readdirSync(modPath);
    if (entries.length === 0) {
      return { valid: false, error: 'Mod directory is empty' };
    }

    // Check for at least one key signature file: meta.cpp, config.cpp, or .bikey files
    const hasMeta = fs.existsSync(path.join(modPath, 'meta.cpp'));
    const hasConfig = fs.existsSync(path.join(modPath, 'config.cpp'));
    const keysDir = [path.join(modPath, 'keys'), path.join(modPath, 'Keys'), path.join(modPath, 'key')]
      .find(k => fs.existsSync(k));
    const hasBikeys = keysDir && fs.readdirSync(keysDir).some(f => f.endsWith('.bikey'));

    if (!hasMeta && !hasConfig && !hasBikeys) {
      return { valid: false, error: 'Mod missing key signature files (meta.cpp, config.cpp, or .bikey files)' };
    }

    // Check file count is reasonable (not a partial copy)
    const fileCount = entries.length;
    if (fileCount < 2) {
      return { valid: false, error: `Mod has very few files (${fileCount}) — likely incomplete` };
    }

    logger.debug({ modPath, workshopId, fileCount }, 'Mod validation passed');
    return { valid: true };
  } catch (err) {
    logger.warn({ err, modPath, workshopId }, 'Mod validation check failed');
    return { valid: false, error: `Validation error: ${err.message}` };
  }
}

/**
 * Install a downloaded workshop mod into a server's install directory.
 * Implements atomic install pattern: stage -> verify -> swap -> cleanup.
 *
 * Pattern:
 *   1. Copy mod to temporary staging directory (_staging_@modid)
 *   2. Validate staged mod is complete
 *   3. If target exists, rename to backup (_backup_@modid)
 *   4. Atomically rename staging dir to final location
 *   5. Delete backup on success, restore on failure
 *
 * @param {string} workshopContentPath - Path to downloaded mod content
 * @param {string} modName - Human-readable mod name
 * @param {string} workshopId - Steam Workshop ID
 * @param {string} installDir - Server installation directory
 * @returns {{ safeName: string, error?: string }}
 */
function installModToServer(workshopContentPath, modName, workshopId, installDir) {
  const folderName = modName.startsWith('@') ? modName : `@${modName}`;
  // Remove special chars AND spaces — DayZ -mod= parameter can't handle spaces
  const safeName = folderName.replace(/[<>:"/\\|?*\s]/g, '').trim();
  const destPath = path.join(installDir, safeName);

  // Stage 1: Prepare staging directory
  const stagingDir = path.join(installDir, `_staging_${safeName}`);
  const backupDir = path.join(installDir, `_backup_${safeName}`);

  try {
    // Clean up any leftover staging/backup directories from failed prior attempts
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      logger.debug({ stagingDir }, 'Cleaned up stale staging directory');
    }
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
      logger.debug({ backupDir }, 'Cleaned up stale backup directory');
    }

    // Stage 2: Copy mod to staging directory
    logger.debug({ workshopId, source: workshopContentPath, staging: stagingDir }, 'Staging mod installation');
    copyDirSync(workshopContentPath, stagingDir);

    // Stage 3: Validate staged mod
    const validation = validateModInstallation(stagingDir, workshopId);
    if (!validation.valid) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      logger.error({ workshopId, modName, error: validation.error }, 'Mod validation failed after staging');
      return { safeName, error: validation.error };
    }

    // Stage 4: Create meta.cpp if missing
    const metaPath = path.join(stagingDir, 'meta.cpp');
    if (!fs.existsSync(metaPath)) {
      fs.writeFileSync(metaPath, `protocol = 1;\nname = "${modName}";\ntimestamp = ${Math.floor(Date.now() / 1000)};\npublishedid = ${workshopId};\n`);
      logger.debug({ workshopId, metaPath }, 'Created meta.cpp');
    }

    // Stage 5: Copy .bikey files
    const keysSource = [path.join(stagingDir, 'keys'), path.join(stagingDir, 'Keys'), path.join(stagingDir, 'key')]
      .find(k => fs.existsSync(k));
    let bikeyCopyError = null;
    if (keysSource) {
      const serverKeysDir = path.join(installDir, 'keys');
      if (!fs.existsSync(serverKeysDir)) fs.mkdirSync(serverKeysDir, { recursive: true });
      try {
        fs.readdirSync(keysSource)
          .filter(f => f.endsWith('.bikey'))
          .forEach(f => {
            const src = path.join(keysSource, f);
            const dst = path.join(serverKeysDir, f);
            if (!fs.existsSync(dst)) {
              fs.copyFileSync(src, dst);
            }
          });
        logger.debug({ workshopId, keysSource }, 'Copied .bikey files to server keys directory');
      } catch (err) {
        logger.warn({ err, keysSource }, 'Failed to copy .bikey files (continuing with install)');
        bikeyCopyError = err;
      }
    }

    // Stage 6: Atomic swap — backup existing if present, then rename staging to final
    if (fs.existsSync(destPath)) {
      try {
        fs.renameSync(destPath, backupDir);
        logger.debug({ workshopId, backup: backupDir }, 'Created backup of existing mod');
      } catch (err) {
        // If backup fails, abort the entire operation
        fs.rmSync(stagingDir, { recursive: true, force: true });
        logger.error({ err, workshopId, destPath }, 'Failed to backup existing mod — aborting install');
        return { safeName, error: `Failed to backup existing mod: ${err.message}` };
      }
    }

    // Perform atomic rename of staging to destination
    try {
      fs.renameSync(stagingDir, destPath);
      logger.info({ workshopId, modName, destPath }, 'Mod installation completed (staging -> final)');
    } catch (err) {
      // Rename failed — restore backup if it exists
      if (fs.existsSync(backupDir)) {
        try {
          fs.renameSync(backupDir, destPath);
          logger.warn({ err, workshopId }, 'Staging rename failed — restored backup');
        } catch (restoreErr) {
          logger.error({ restoreErr, workshopId }, 'Failed to restore backup after failed rename');
        }
      }
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return { safeName, error: `Failed to finalize mod installation: ${err.message}` };
    }

    // Stage 7: Delete backup on success
    if (fs.existsSync(backupDir)) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
        logger.debug({ workshopId, backup: backupDir }, 'Deleted backup (install successful)');
      } catch (err) {
        logger.warn({ err, backupDir }, 'Failed to delete backup directory (non-fatal)');
      }
    }

    return { safeName };
  } catch (err) {
    // Ensure cleanup on any unexpected error
    try {
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch { /* best effort */ }
    logger.error({ err, workshopId, modName }, 'Unexpected error during mod installation');
    return { safeName, error: err.message };
  }
}

/**
 * Update the server's launchParams with the current enabled mod list.
 * Builds BOTH -mod= (client mods) and -serverMod= (server-only mods) from typed mod lists.
 * Persists the change to servers.json.
 */
function updateLaunchParamsMods(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const state = ctx.serverStates[serverId];
  if (!srv || !state) return;
  try {
    const enabledMods = state.modList.filter(m => m.enabled);
    const clientMods = enabledMods.filter(m => (m.type || 'client') === 'client').map(m => m.name).join(';');
    const serverOnlyMods = enabledMods.filter(m => m.type === 'server').map(m => m.name).join(';');

    let params = srv.launchParams || '';

    // Strip ALL existing -mod= and -serverMod= values (handles corrupted/duplicated entries)
    // Pattern: -param=<everything up to next " -letter" or end of string>
    params = params.replace(/\s*-mod=.*?(?=\s+-[a-zA-Z]|$)/gi, '').trim();
    params = params.replace(/\s*-serverMod=.*?(?=\s+-[a-zA-Z]|$)/gi, '').trim();

    // Append clean values
    if (clientMods) {
      params = `${params} -mod=${clientMods}`.trim();
    }
    if (serverOnlyMods) {
      params = `${params} -serverMod=${serverOnlyMods}`.trim();
    }

    srv.launchParams = params;
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
  } catch (err) {
    logger.error({ err, serverId }, 'Failed to update launch params mods');
  }
}

/**
 * Reorder the mod list for a server.
 * Accepts an array of mod folder names in the desired load order.
 * Reorders state.modList to match, rebuilds launch params, and emits update.
 *
 * @param {string} serverId
 * @param {string[]} orderedModNames - Array of mod folder names in desired order
 */
function reorderMods(serverId, orderedModNames) {
  const state = ctx.serverStates[serverId];
  if (!state || !state.modList) return;

  // Build a lookup by name for quick access
  const modByName = {};
  for (const mod of state.modList) {
    modByName[mod.name] = mod;
  }

  // Reorder: put requested mods first in given order, then append any remaining
  const reordered = [];
  const placed = new Set();
  for (const name of orderedModNames) {
    if (modByName[name]) {
      reordered.push({ ...modByName[name], order: reordered.length });
      placed.add(name);
    }
  }
  // Append any mods that weren't in the ordered list (preserves them at the end)
  for (const mod of state.modList) {
    if (!placed.has(mod.name)) {
      reordered.push({ ...mod, order: reordered.length });
    }
  }

  state.modList = reordered;
  updateLaunchParamsMods(serverId);
  if (ctx.io) ctx.io.emit('mods', { serverId, mods: state.modList });
  logger.info({ serverId, count: reordered.length }, 'Mods reordered');
}

/**
 * Set the type of a mod (client or server).
 * Rebuilds launch params automatically after changing the type.
 *
 * @param {string} serverId
 * @param {string} modName - The mod folder name (e.g. '@CF')
 * @param {'client'|'server'} type
 * @returns {object|null} The updated mod object, or null if not found
 */
function setModType(serverId, modName, type) {
  const state = ctx.serverStates[serverId];
  if (!state || !state.modList) return null;
  const mod = state.modList.find(m => m.name === modName);
  if (!mod) return null;

  mod.type = type;
  updateLaunchParamsMods(serverId);
  if (ctx.io) ctx.io.emit('mods', { serverId, mods: state.modList });
  logger.info({ serverId, modName, type }, 'Mod type changed');
  return mod;
}

module.exports = { autoDetectMods, installModToServer, updateLaunchParamsMods, reorderMods, setModType, validateModInstallation };
