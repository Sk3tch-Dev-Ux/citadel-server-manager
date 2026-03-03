/**
 * Mod detection, installation, and launch params management for DayZ servers.
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
  let activeMods = new Set();
  const params = srv.launchParams || '';
  const modMatch = params.match(/-mod=([^\s]+)/i);
  if (modMatch) {
    modMatch[1].replace(/["]/g, '').trim().split(';').forEach(m => { if (m.trim()) activeMods.add(m.trim()); });
  }
  state.modList = installedMods.map((name, index) => {
    let workshopId = '';
    try {
      const metaPath = path.join(installDir, name, 'meta.cpp');
      if (fs.existsSync(metaPath)) { const meta = fs.readFileSync(metaPath, 'utf8'); const m = meta.match(/publishedid\s*=\s*(\d+)/i); if (m) workshopId = m[1]; }
    } catch (err) {
      logger.debug({ err, mod: name }, 'Failed to read meta.cpp');
    }
    return { name, workshopId, enabled: activeMods.size === 0 ? true : activeMods.has(name), order: index };
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
 * Persists the change to servers.json.
 */
function updateLaunchParamsMods(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const state = ctx.serverStates[serverId];
  if (!srv || !state) return;
  try {
    const enabledMods = state.modList.filter(m => m.enabled).map(m => m.name).join(';');
    let params = srv.launchParams || '';
    if (enabledMods) {
      if (params.match(/-mod=[^\s]+/i)) {
        params = params.replace(/-mod=[^\s]+/i, `-mod=${enabledMods}`);
      } else {
        params = `${params} -mod=${enabledMods}`.trim();
      }
    } else {
      params = params.replace(/\s*-mod=[^\s]+/i, '').trim();
    }
    srv.launchParams = params;
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
  } catch (err) {
    logger.error({ err, serverId }, 'Failed to update launch params mods');
  }
}

module.exports = { autoDetectMods, installModToServer, updateLaunchParamsMods };
