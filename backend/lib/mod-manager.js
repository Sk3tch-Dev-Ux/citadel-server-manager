/**
 * Mod detection, installation, and batch file management for DayZ servers.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const ctx = require('./context');
const { copyDirSync } = require('./helpers');

/**
 * Auto-detect installed mods by scanning for @-prefixed directories.
 * Parses meta.cpp for workshop IDs and checks .bat for active mods.
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
  if (srv.startBat) {
    try {
      const batContent = fs.readFileSync(path.join(installDir, srv.startBat), 'utf8');
      const modMatch = batContent.match(/["\s]-mod=([^"\n]+)/i) || batContent.match(/-mod=([^\s]+)/i);
      if (modMatch) modMatch[1].replace(/["]/g, '').trim().split(';').forEach(m => { if (m.trim()) activeMods.add(m.trim()); });
    } catch (err) {
      logger.debug({ err }, 'Failed to read start bat for mod detection');
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
 * Update the server's start .bat file with the current enabled mod list.
 * Creates a timestamped backup before modifying.
 */
function updateStartBatMods(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const state = ctx.serverStates[serverId];
  if (!srv || !state || !srv.startBat) return;
  const batPath = path.join(srv.installDir, srv.startBat);
  if (!fs.existsSync(batPath)) return;
  try {
    let content = fs.readFileSync(batPath, 'utf8');
    const enabledMods = state.modList.filter(m => m.enabled).map(m => m.name).join(';');
    const backupDir = path.join(srv.installDir, '.backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(batPath, path.join(backupDir, `${srv.startBat}.${Date.now()}.bak`));
    if (content.match(/"-mod=[^"]*"/i)) content = content.replace(/"-mod=[^"]*"/i, `"-mod=${enabledMods}"`);
    else if (content.match(/-mod=[^\s"]+/i)) content = content.replace(/-mod=[^\s"]+/i, `-mod=${enabledMods}`);
    fs.writeFileSync(batPath, content);
  } catch (err) {
    logger.error({ err, serverId }, 'Failed to update start bat mods');
  }
}

module.exports = { autoDetectMods, installModToServer, updateStartBatMods };
