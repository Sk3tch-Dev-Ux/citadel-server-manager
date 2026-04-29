/**
 * Locate the Citadel install directory from the desktop process.
 *
 * The desktop runs from $INSTDIR/desktop/ in production (NSIS installer
 * places it there), or from the source tree in dev (`npm run dev`). The
 * backend runs from $INSTDIR/ and writes to $INSTDIR/data/. The desktop
 * needs to find that data dir to:
 *
 *   - Drop telemetry events into a file the backend will pick up on its
 *     next flush (we can't always go through the local HTTP API — the
 *     backend may be stopped during the update flow).
 *   - Write the "update in progress" marker so the new backend version,
 *     after restart, knows whether to emit update.completed or update.failed.
 *
 * Resolution order:
 *   1. CITADEL_INSTALL_DIR env var (used in dev / overrides).
 *   2. Windows registry: HKLM\SOFTWARE\Citadel\InstallDir (set by
 *      installer/citadel.nsi line 116 on production installs).
 *   3. Fall back to walking up from process.execPath / __dirname.
 *
 * Falls back to null if everything fails — callers handle that case
 * gracefully (telemetry just doesn't fire; not fatal).
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let _cached = undefined;

function _readRegistryInstallDir() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync('reg query "HKLM\\SOFTWARE\\Citadel" /v InstallDir', {
      timeout: 5000,
      windowsHide: true,
      encoding: 'utf-8',
    });
    // Output looks like:
    //   HKEY_LOCAL_MACHINE\SOFTWARE\Citadel
    //       InstallDir    REG_SZ    C:\Citadel
    const match = out.match(/InstallDir\s+REG_SZ\s+(.+?)\s*$/m);
    if (match) return match[1].trim();
  } catch {
    // Not installed via NSIS, or running under non-admin context where
    // HKLM read fails — fall through.
  }
  return null;
}

function _walkUpFromExecPath() {
  // process.execPath in a packaged Electron build is typically:
  //   $INSTDIR\desktop\Citadel.exe
  // ... so $INSTDIR is two levels up.
  // In `electron .` dev runs, process.execPath is electron.exe deep in
  // node_modules — that path won't have a sibling /data dir, which is
  // how we detect the dev case below.
  try {
    const execDir = path.dirname(process.execPath);
    const candidate = path.resolve(execDir, '..');
    if (fs.existsSync(path.join(candidate, 'data'))) return candidate;
  } catch {}
  return null;
}

function _walkUpFromDirname() {
  // From source tree: __dirname = .../desktop/src → repo root is two up.
  try {
    const candidate = path.resolve(__dirname, '..', '..');
    if (fs.existsSync(path.join(candidate, 'data')) || fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  } catch {}
  return null;
}

function getInstallDir() {
  if (_cached !== undefined) return _cached;

  if (process.env.CITADEL_INSTALL_DIR) {
    _cached = process.env.CITADEL_INSTALL_DIR;
    return _cached;
  }

  const fromRegistry = _readRegistryInstallDir();
  if (fromRegistry) {
    _cached = fromRegistry;
    return _cached;
  }

  const fromExec = _walkUpFromExecPath();
  if (fromExec) {
    _cached = fromExec;
    return _cached;
  }

  const fromDirname = _walkUpFromDirname();
  if (fromDirname) {
    _cached = fromDirname;
    return _cached;
  }

  _cached = null;
  return null;
}

function getDataDir() {
  const root = getInstallDir();
  return root ? path.join(root, 'data') : null;
}

module.exports = { getInstallDir, getDataDir };
