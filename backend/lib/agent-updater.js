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
 *   - Only downloads from the trusted release hosts (citadel-hub.com / citadels.cc / GitHub). Both Citadel hosts are accepted during the citadels.cc → citadel-hub.com cutover so un-updated agents and new ones both work.
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

// Only this repo's release assets are accepted — not "any github.com path".
const RELEASE_PATH_PREFIX = '/Sk3tch-Dev-Ux/citadel-server-manager/releases/download/';
// If set, a signed installer's certificate subject must contain this string for
// a SILENT install to be allowed (e.g. the code-signing CN once releases are
// signed). Unset → silent requires a Valid signature of any publisher.
const EXPECTED_PUBLISHER = process.env.CITADEL_UPDATE_PUBLISHER || '';

/**
 * Allow downloads only from this repo's release assets / Citadel Cloud's
 * downloads path. The previous version accepted any github.com URL, which (if
 * the update feed were influenced) let an arbitrary attacker-hosted release be
 * downloaded and launched as the service.
 *
 * Host scoping is the load-bearing security control. The `.exe` extension is
 * enforced ONLY for GitHub release-asset URLs (which always carry the asset
 * filename, e.g. CitadelSetup-2.21.9.exe, per .github/workflows/release.yml).
 * The Citadel Cloud downloads endpoint serves the installer from a clean,
 * extension-less path (/downloads/installer), so requiring `.exe` there would
 * (and did) reject every cloud-driven self-update. The downloaded bytes are
 * still validated by the MZ-header + size checks in downloadInstaller(), and
 * the Authenticode signature is verified before any silent launch — so an
 * extension-less cloud path does not weaken the executable-integrity gate.
 */
function isAllowedDownloadUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    const p = u.pathname;
    const isExe = p.toLowerCase().endsWith('.exe');
    if (host === 'github.com') return isExe && p.startsWith(RELEASE_PATH_PREFIX);
    // GitHub serves release assets from this CDN (the redirect target).
    if (host.endsWith('.githubusercontent.com')) return isExe;
    // Citadel Cloud: scope to the /downloads/ path; the endpoint streams the
    // signed installer from an extension-less URL, so don't require `.exe` here.
    // Both Citadel-owned hosts are trusted during the citadels.cc → citadel-hub.com
    // migration (keep citadels.cc so already-deployed agents keep updating).
    if (host === 'citadel-hub.com' || host.endsWith('.citadel-hub.com')) return p.startsWith('/downloads/');
    if (host === 'citadels.cc' || host.endsWith('.citadels.cc')) return p.startsWith('/downloads/');
    return false;
  } catch {
    return false;
  }
}

/**
 * Verify the Authenticode signature of a downloaded installer via PowerShell.
 * Best-effort: if PowerShell is unavailable or errors, returns status 'unknown'
 * (which is treated as untrusted for silent installs).
 * @returns {{status:string, subject:string}}
 */
function verifyAuthenticode(filePath) {
  try {
    const { execFileSync } = require('child_process');
    const safe = filePath.replace(/'/g, "''");
    const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${safe}'; Write-Output $s.Status; Write-Output $s.SignerCertificate.Subject`;
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 20000, windowsHide: true }).toString();
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return { status: lines[0] || 'unknown', subject: lines[1] || '' };
  } catch (err) {
    return { status: 'unknown', subject: '', error: err.message };
  }
}

/** Whether a signature is trusted enough to permit a SILENT (unattended) install. */
function isTrustedForSilent(sig) {
  return sig.status === 'Valid' && (!EXPECTED_PUBLISHER || sig.subject.includes(EXPECTED_PUBLISHER));
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

  const baseDir = updatesDir();
  try { fs.mkdirSync(baseDir, { recursive: true }); } catch { /* exists */ }
  // Clean prior staging dirs, then stage into a fresh unique dir so the
  // download path isn't predictable (mitigates a TOCTOU swap before launch).
  try {
    for (const e of fs.readdirSync(baseDir)) {
      if (e.startsWith('u-')) fs.rmSync(path.join(baseDir, e), { recursive: true, force: true });
    }
  } catch { /* best effort */ }
  const dir = fs.mkdtempSync(path.join(baseDir, 'u-'));
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
  // Verify the signature right before launch. A SILENT (unattended) install is
  // only allowed for a Valid, expected-publisher signature — otherwise the
  // operator must run it interactively so Windows SmartScreen/UAC is in the
  // loop. This blocks an attacker-supplied unsigned binary from being installed
  // headlessly as the (often admin) service.
  const sig = verifyAuthenticode(installerPath);
  if (opts.silent && !isTrustedForSilent(sig)) {
    return { ok: false, signature: sig.status, error: `Refusing silent install of an unverified installer (signature: ${sig.status}). Apply interactively to confirm.` };
  }
  try {
    const args = opts.silent ? ['/S'] : [];
    const child = spawn(installerPath, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    logger.info({ installerPath, silent: !!opts.silent, signature: sig.status }, 'agent-updater: installer launched');
    return { ok: true, signature: sig.status };
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
  verifyAuthenticode, isTrustedForSilent,
  downloadInstaller, launchInstaller, applyUpdate,
};
