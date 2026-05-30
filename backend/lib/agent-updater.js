'use strict';

/**
 * Assisted agent self-update.
 *
 * CF Architect swaps its own binary in place. Citadel historically shipped
 * update *notifications* only (see update-checker.js), deliberately avoiding
 * silent self-replacement of a running Windows service. This module closes the
 * gap with a safe middle ground: it downloads the official signed installer for
 * an available update and launches it, letting the proven NSIS installer do the
 * file replacement + service restart instead of hand-rolled swap logic.
 *
 * Safety rails:
 *   - Only downloads from the trusted release hosts (citadels.cc / GitHub).
 *   - Only accepts a .exe asset and a sane size.
 *   - Launches the installer *interactively* by default (operator stays in the
 *     loop through UAC); silent apply is opt-in.
 * Best-effort; callers get structured errors rather than throws.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ctx = require('./context');
const logger = require('./logger');
const updateChecker = require('./update-checker');

const MIN_INSTALLER_BYTES = 1_000_000;   // 1 MB — guards against truncated/error-page downloads
const MAX_INSTALLER_BYTES = 500_000_000; // 500 MB ceiling

/** Allow downloads only from the official release hosts. */
function isAllowedDownloadUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host === 'citadels.cc' ||
      host.endsWith('.citadels.cc') ||
      host === 'github.com' ||
      host.endsWith('.github.com') ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

/** Derive a safe installer filename for a version. */
function installerFilename(version) {
  const v = String(version || 'latest').replace(/[^0-9A-Za-z.\-_]/g, '');
  return `CitadelSetup-${v || 'latest'}.exe`;
}

/** Directory updates are staged into. */
function updatesDir() {
  return path.join(ctx.CONFIG.dataDir, 'updates');
}

/**
 * Download the installer for the currently-available update to the staging dir.
 * @returns {Promise<{ok:boolean, path?:string, size?:number, error?:string}>}
 */
async function downloadInstaller() {
  const state = updateChecker.getState();
  if (state.status !== 'update_available') return { ok: false, error: 'No update available' };
  if (!isAllowedDownloadUrl(state.downloadUrl)) return { ok: false, error: 'Download URL is not a trusted release host' };

  const dir = updatesDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  const dest = path.join(dir, installerFilename(state.latestVersion));

  try {
    const res = await fetch(state.downloadUrl, { redirect: 'follow' });
    if (!res.ok) return { ok: false, error: `Download failed: HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_INSTALLER_BYTES) return { ok: false, error: 'Downloaded file too small — not a valid installer' };
    if (buf.length > MAX_INSTALLER_BYTES) return { ok: false, error: 'Downloaded file exceeds size limit' };
    // MZ header sanity check for a Windows executable.
    if (buf[0] !== 0x4d || buf[1] !== 0x5a) return { ok: false, error: 'Downloaded file is not a Windows executable' };
    fs.writeFileSync(dest, buf);
    logger.info({ dest, size: buf.length, version: state.latestVersion }, 'agent-updater: installer downloaded');
    return { ok: true, path: dest, size: buf.length };
  } catch (err) {
    logger.warn({ err: err.message }, 'agent-updater: download failed');
    return { ok: false, error: err.message };
  }
}

/**
 * Launch a downloaded installer. Interactive by default; the installer stops the
 * service, replaces files and restarts. `silent` runs NSIS with /S (opt-in).
 * @returns {{ok:boolean, error?:string}}
 */
function launchInstaller(installerPath, opts = {}) {
  if (!installerPath || !fs.existsSync(installerPath)) return { ok: false, error: 'Installer not found' };
  if (!installerPath.toLowerCase().endsWith('.exe')) return { ok: false, error: 'Not an executable' };
  try {
    const args = opts.silent ? ['/S'] : [];
    const child = spawn(installerPath, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    logger.info({ installerPath, silent: !!opts.silent }, 'agent-updater: installer launched');
    return { ok: true };
  } catch (err) {
    logger.warn({ err: err.message }, 'agent-updater: launch failed');
    return { ok: false, error: err.message };
  }
}

/**
 * Download (if needed) and launch the installer for an available update.
 * @returns {Promise<{ok:boolean, path?:string, error?:string}>}
 */
async function applyUpdate(opts = {}) {
  const dl = await downloadInstaller();
  if (!dl.ok) return dl;
  const launch = launchInstaller(dl.path, opts);
  if (!launch.ok) return { ok: false, path: dl.path, error: launch.error };
  return { ok: true, path: dl.path };
}

module.exports = {
  isAllowedDownloadUrl, installerFilename, updatesDir,
  downloadInstaller, launchInstaller, applyUpdate,
};
