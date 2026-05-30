'use strict';

/**
 * Mod & game-build integrity engine.
 *
 * Two jobs, both modeled on what CF Architect does and Citadel previously lacked:
 *
 *  1. Mod PBO integrity snapshots + drift detection.
 *     After a mod installs/updates we snapshot a SHA-256 of every .pbo in its
 *     folder. On server start we recompute and compare — if the bytes on disk no
 *     longer match the snapshot (silent corruption, a manual edit, a partial
 *     Steam sync, tampering) we flag drift via log + notification + webhook.
 *     Hashing runs in the background so it never delays a start.
 *
 *  2. Installed game-build tracking.
 *     We read the build id the deployment is actually on from its Steam
 *     appmanifest, persist it, and surface when it changes. This complements the
 *     existing "remote build available" poll in polling.js: that says a newer
 *     build exists upstream; this says which build *this install* is running.
 *
 * Snapshots persist to data/integrity.json so they survive restarts. Everything
 * here is best-effort and never throws into a caller.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ctx = require('./context');
const logger = require('./logger');
const { loadJSON, saveJSON } = require('./data-store');
const { addLog } = require('./audit');
const { addNotification, fireWebhooks } = require('./notifications');

const STORE_FILE = 'integrity.json';

// In-memory mirror of the persisted store:
//   { [serverId]: {
//       mods:  { [folder]: { hash, pboCount, bytes, at } },
//       build: { id, at },
//       lastCheck: { at, ok, drifted:[], missing:[] }
//   } }
let _store = null;
function _load() {
  if (!_store) _store = loadJSON(ctx.CONFIG.dataDir, STORE_FILE, {}) || {};
  return _store;
}
function _save() {
  try { saveJSON(ctx.CONFIG.dataDir, STORE_FILE, _load()); } catch (err) {
    logger.debug({ err: err.message }, 'integrity: save failed');
  }
}
function _server(serverId) {
  const s = _load();
  if (!s[serverId]) s[serverId] = { mods: {}, build: null, lastCheck: null };
  if (!s[serverId].mods) s[serverId].mods = {};
  return s[serverId];
}

/** Recursively collect every .pbo path under a directory (relative paths). */
function _findPbos(rootDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pbo')) out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

/** SHA-256 of a file's contents, streamed so large PBOs don't buffer in RAM. */
function _hashFile(file) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (d) => h.update(d));
    stream.on('end', () => resolve(h.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

/**
 * Compute the integrity fingerprint of one mod folder: a SHA-256 over every
 * .pbo's (relative path + size + content hash), order-independent.
 * @returns {Promise<{hash:string, pboCount:number, bytes:number}|null>}
 */
async function fingerprintFolder(modFolderPath) {
  if (!fs.existsSync(modFolderPath)) return null;
  const pbos = _findPbos(modFolderPath);
  if (pbos.length === 0) return { hash: 'no-pbo', pboCount: 0, bytes: 0 };
  const parts = [];
  let bytes = 0;
  for (const pbo of pbos.sort()) {
    let size = 0;
    try { size = fs.statSync(pbo).size; } catch { /* ignore */ }
    bytes += size;
    const fileHash = await _hashFile(pbo);
    const rel = path.relative(modFolderPath, pbo).replace(/\\/g, '/');
    parts.push(`${rel}\0${size}\0${fileHash || 'err'}`);
  }
  const hash = crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
  return { hash, pboCount: pbos.length, bytes };
}

/**
 * Snapshot one installed mod folder for a server and persist it as the trusted
 * baseline. Called after a successful install/update.
 * @returns {Promise<object|null>} the snapshot, or null if it couldn't be taken
 */
async function snapshotMod(serverId, folderName) {
  const srv = ctx.servers.find((s) => s.id === serverId);
  if (!srv || !folderName) return null;
  const modPath = path.join(srv.installDir, folderName);
  const fp = await fingerprintFolder(modPath);
  if (!fp) return null;
  const rec = _server(serverId);
  rec.mods[folderName] = { ...fp, at: new Date().toISOString() };
  _save();
  logger.debug({ serverId, folderName, pboCount: fp.pboCount }, 'integrity: mod snapshot taken');
  return rec.mods[folderName];
}

/** Drop a mod's snapshot (after uninstall). */
function forgetMod(serverId, folderName) {
  const rec = _server(serverId);
  if (rec.mods[folderName]) { delete rec.mods[folderName]; _save(); }
}

/**
 * Snapshot every enabled mod for a server — establishes/refreshes the full
 * baseline (used by the manual "re-snapshot" action and to seed servers that
 * have no baseline yet).
 * @returns {Promise<{count:number}>}
 */
async function snapshotServer(serverId) {
  const state = ctx.serverStates[serverId];
  const mods = state?.modList || [];
  let count = 0;
  for (const mod of mods) {
    if (mod.enabled === false) continue;
    if (await snapshotMod(serverId, mod.name)) count++;
  }
  return { count };
}

/**
 * Recompute fingerprints for the server's enabled mods and compare to the
 * stored baseline. Flags drift (changed bytes) and missing folders. Mods with
 * no baseline yet are reported as "unsnapshotted" and auto-snapshotted so the
 * next start has something to compare against.
 *
 * @param {string} serverId
 * @param {{notify?:boolean}} [opts] - whether to emit log/notification/webhook on drift
 * @returns {Promise<{ok:boolean, drifted:string[], missing:string[], unsnapshotted:string[]}>}
 */
async function checkServerDrift(serverId, opts = {}) {
  const notify = opts.notify !== false;
  const srv = ctx.servers.find((s) => s.id === serverId);
  const state = ctx.serverStates[serverId];
  const result = { ok: true, drifted: [], missing: [], unsnapshotted: [] };
  if (!srv || !state?.modList) return result;

  const rec = _server(serverId);
  for (const mod of state.modList) {
    if (mod.enabled === false) continue;
    const folder = mod.name;
    const baseline = rec.mods[folder];
    const modPath = path.join(srv.installDir, folder);
    if (!fs.existsSync(modPath)) { result.missing.push(folder); continue; }
    const fp = await fingerprintFolder(modPath);
    if (!fp) { result.missing.push(folder); continue; }
    if (!baseline) {
      // No trusted baseline yet — adopt the current state as trusted.
      rec.mods[folder] = { ...fp, at: new Date().toISOString() };
      result.unsnapshotted.push(folder);
      continue;
    }
    if (baseline.hash !== fp.hash) result.drifted.push(folder);
  }

  result.ok = result.drifted.length === 0 && result.missing.length === 0;
  rec.lastCheck = { at: new Date().toISOString(), ok: result.ok, drifted: result.drifted, missing: result.missing };
  _save();

  if (notify && (result.drifted.length || result.missing.length)) {
    const bits = [];
    if (result.drifted.length) bits.push(`changed on disk: ${result.drifted.join(', ')}`);
    if (result.missing.length) bits.push(`missing: ${result.missing.join(', ')}`);
    const msg = `Mod integrity drift detected — ${bits.join('; ')}`;
    addLog(serverId, 'warn', 'integrity', msg);
    addNotification(serverId, 'integrity.drift', 'Mod Integrity Drift', `${srv.name}: ${msg}`, 'warning');
    fireWebhooks('integrity.drift', { serverId, serverName: srv.name, drifted: result.drifted, missing: result.missing });
  }
  return result;
}

/** Read the build id a deployment is installed at from its Steam appmanifest. */
function readInstalledBuildId(srv) {
  if (!srv?.installDir) return null;
  const appId = srv.gameTitle === 'DayZ, PC (Experimental)' ? '1042420' : '223350';
  const manifest = path.join(srv.installDir, 'steamapps', `appmanifest_${appId}.acf`);
  try {
    const txt = fs.readFileSync(manifest, 'utf8');
    const m = txt.match(/"buildid"\s+"(\d+)"/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Record the installed game build for a server, detecting when it changes
 * (e.g. after a server update completes). Emits an info log on change.
 * @returns {{id:string|null, changed:boolean}}
 */
function recordInstalledBuild(serverId) {
  const srv = ctx.servers.find((s) => s.id === serverId);
  if (!srv) return { id: null, changed: false };
  const id = readInstalledBuildId(srv);
  if (!id) return { id: null, changed: false };
  const rec = _server(serverId);
  const prev = rec.build?.id || null;
  const changed = prev !== null && prev !== id;
  rec.build = { id, at: new Date().toISOString() };
  _save();
  if (changed) {
    addLog(serverId, 'info', 'integrity', `Installed game build changed (${prev} -> ${id})`);
    addNotification(serverId, 'integrity.build', 'Game Build Changed', `${srv.name} is now on build ${id}`, 'info');
  }
  return { id, changed };
}

/** Full integrity report for a server (snapshot baseline + last check + build). */
function getReport(serverId) {
  const rec = _server(serverId);
  return {
    mods: rec.mods,
    build: rec.build,
    lastCheck: rec.lastCheck,
    installedBuild: readInstalledBuildId(ctx.servers.find((s) => s.id === serverId)),
  };
}

module.exports = {
  fingerprintFolder,
  snapshotMod,
  forgetMod,
  snapshotServer,
  checkServerDrift,
  recordInstalledBuild,
  readInstalledBuildId,
  getReport,
};
