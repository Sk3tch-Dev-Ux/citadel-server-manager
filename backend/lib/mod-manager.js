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
  let installedMods = [];
  try {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    installedMods = entries.filter(e => e.isDirectory() && e.name.startsWith('@')).map(e => e.name);
  } catch (err) {
    logger.debug({ err, installDir }, 'Failed to read install dir for mod detection');
    return;
  }

  // Build sets of active mods from both -mod= and -serverMod= params
  const params = srv.launchParams || '';
  const activeMods = new Set();
  const serverMods = new Set();
  const modMatch = params.match(/-mod=([^\s]+)/i);
  if (modMatch) {
    modMatch[1].replace(/["]/g, '').trim().split(';').forEach(m => { if (m.trim()) activeMods.add(m.trim()); });
  }
  const serverModMatch = params.match(/-serverMod=([^\s]+)/i);
  if (serverModMatch) {
    serverModMatch[1].replace(/["]/g, '').trim().split(';').forEach(m => { if (m.trim()) serverMods.add(m.trim()); });
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
 * Install a downloaded workshop mod into a server's install directory.
 * Copies content, creates meta.cpp if missing, and copies .bikey files.
 */
function installModToServer(workshopContentPath, modName, workshopId, installDir) {
  const folderName = modName.startsWith('@') ? modName : `@${modName}`;
  const safeName = folderName.replace(/[<>:"/\\|?*]/g, '').trim();
  const destPath = path.join(installDir, safeName);
  if (fs.existsSync(destPath)) fs.rmSync(destPath, { recursive: true, force: true });
  copyDirSync(workshopContentPath, destPath);
  const metaPath = path.join(destPath, 'meta.cpp');
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, `protocol = 1;\nname = "${modName}";\ntimestamp = ${Math.floor(Date.now() / 1000)};\npublishedid = ${workshopId};\n`);
  }
  const keysSource = [path.join(destPath, 'keys'), path.join(destPath, 'Keys'), path.join(destPath, 'key')].find(k => fs.existsSync(k));
  if (keysSource) {
    const serverKeysDir = path.join(installDir, 'keys');
    if (!fs.existsSync(serverKeysDir)) fs.mkdirSync(serverKeysDir, { recursive: true });
    try {
      fs.readdirSync(keysSource).filter(f => f.endsWith('.bikey')).forEach(f => {
        if (!fs.existsSync(path.join(serverKeysDir, f))) fs.copyFileSync(path.join(keysSource, f), path.join(serverKeysDir, f));
      });
    } catch (err) {
      logger.warn({ err, keysSource }, 'Failed to copy .bikey files');
    }
  }
  return safeName;
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

    // --- Update -mod= (client mods) ---
    if (clientMods) {
      if (params.match(/-mod=[^\s]+/i)) {
        params = params.replace(/-mod=[^\s]+/i, `-mod=${clientMods}`);
      } else {
        params = `${params} -mod=${clientMods}`.trim();
      }
    } else {
      params = params.replace(/\s*-mod=[^\s]+/i, '').trim();
    }

    // --- Update -serverMod= (server-only mods) ---
    if (serverOnlyMods) {
      if (params.match(/-serverMod=[^\s]+/i)) {
        params = params.replace(/-serverMod=[^\s]+/i, `-serverMod=${serverOnlyMods}`);
      } else {
        params = `${params} -serverMod=${serverOnlyMods}`.trim();
      }
    } else {
      params = params.replace(/\s*-serverMod=[^\s]+/i, '').trim();
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

module.exports = { autoDetectMods, installModToServer, updateLaunchParamsMods, reorderMods, setModType };
