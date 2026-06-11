/**
 * Auto-update lifecycle.
 *
 * electron-updater polls our public GitHub Releases page for a `latest.yml`
 * manifest. When a newer version exists, it downloads the NSIS installer in
 * the background, then prompts the user to restart (via the `update-downloaded`
 * event). On restart we (1) gracefully stop the CitadelServer Windows service,
 * (2) schedule app.relaunch() as a relaunch fallback, and (3) call
 * autoUpdater.quitAndInstall — the NSIS installer runs silently and (when its
 * own LaunchDashboard hook fires) restarts the desktop app.
 *
 * Because the build is a custom NSIS script (not electron-builder's built-in
 * installer), `installer/build.js` generates `latest.yml` at build time and
 * publishes it alongside the .exe in the GitHub Release. The feed URL is
 * configured explicitly via `setFeedURL()` below — we don't rely on
 * `app-update.yml` being in the ASAR (since the custom installer doesn't
 * produce one).
 *
 * Events exposed to the renderer (via ipc.js + preload.js):
 *   updater:checking        — manifest poll started
 *   updater:update-available — new version found { version, releaseNotes? }
 *   updater:not-available   — on latest
 *   updater:download-progress { percent, bytesPerSecond, transferred, total }
 *   updater:update-downloaded { version } — ready to install
 *   updater:error { message }
 *
 * The renderer shows a banner + "Restart to install" button on
 * `update-downloaded`.  It can also manually trigger a check via
 * `updater:check`.
 *
 * Diagnostics: every event is also appended to %APPDATA%/Citadel/update.log
 * (rotated at 1 MB to update.log.1). The Help menu has a "Show Update Log"
 * item that opens this file. When an update fails in the wild, ask the user
 * to send this file.
 */
const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const desktopTelemetry = require('./desktop-telemetry');
const { getInstallDir } = require('./install-paths');

const execAsync = util.promisify(exec);

// GitHub repo that hosts the releases. Public repo — no token required.
const FEED_OWNER = 'Sk3tch-Dev-Ux';
const FEED_REPO = 'DayzServerController';

// Periodic check interval (6 hours). We also check once ~10 s after launch.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 10 * 1000;

// ─── Update log (P1.4) ─────────────────────────────────────────
// Persistent log of every update event so the next time something fails we
// have something to ask the customer for. Lives in %APPDATA%/Citadel/update.log
// (or equivalent on other platforms via app.getPath('userData')).
const UPDATE_LOG_NAME = 'update.log';
const UPDATE_LOG_MAX_BYTES = 1024 * 1024; // 1 MB
const SERVICE_NAME = 'CitadelServer';

let _logPathCached = null;
function updateLogPath() {
  if (_logPathCached) return _logPathCached;
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    _logPathCached = path.join(dir, UPDATE_LOG_NAME);
  } catch {
    _logPathCached = null;
  }
  return _logPathCached;
}

/** Rotate update.log → update.log.1 if it has grown past the size cap. */
function rotateUpdateLogIfNeeded() {
  const p = updateLogPath();
  if (!p) return;
  try {
    const stat = fs.statSync(p);
    if (stat.size <= UPDATE_LOG_MAX_BYTES) return;
    const rotated = `${p}.1`;
    try { fs.unlinkSync(rotated); } catch {}
    fs.renameSync(p, rotated);
  } catch {
    // No file yet, or permission error — nothing to rotate.
  }
}

function appendUpdateLog(level, parts) {
  const p = updateLogPath();
  if (!p) return;
  const line = `[${new Date().toISOString()}] [${level}] ${parts.map(String).join(' ')}\n`;
  try {
    fs.appendFileSync(p, line, 'utf-8');
  } catch {
    // Best-effort — never let logging crash the updater.
  }
}

/** Internal state cached for `updater:status` queries from the renderer. */
let lastState = {
  phase: 'idle',          // 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available'
  version: null,
  progress: null,         // { percent, transferred, total, bytesPerSecond }
  error: null,
};

let periodicTimer = null;
let initialTimer = null;
let sendToRenderer = () => {};

function log(...args) {
  appendUpdateLog('INFO', args);
  // eslint-disable-next-line no-console
  console.log('[updater]', ...args);
}

function warn(...args) {
  appendUpdateLog('WARN', args);
  // eslint-disable-next-line no-console
  console.warn('[updater]', ...args);
}

/**
 * Stop CitadelServer gracefully and wait for the underlying node.exe
 * processes to actually release file handles. Critical to call BEFORE
 * autoUpdater.quitAndInstall() — otherwise the NSIS installer overwrites
 * files while the service is still running, port 3001 stays bound, and
 * the post-update relaunch fails to reach the backend.
 *
 * Never throws — best-effort. The NSIS installer also stops the service
 * defensively (P1.2), so this is one of two safeguards.
 *
 * @param {{ timeoutMs?: number }} [opts]
 */
async function stopServiceGracefully({ timeoutMs = 20000 } = {}) {
  log('stopping CitadelServer before install');

  // 1. Ask NSSM to stop the service. nssm.exe is NOT on PATH — it lives at
  //    <install>/runtime/nssm.exe. Calling bare `nssm` fails with "'nssm' is
  //    not recognized", so the service never stopped and the install ran
  //    against locked files. Resolve the real path (fall back to bare `nssm`
  //    only if the install dir can't be found). NSSM has its own graceful-
  //    shutdown timeout configured in service-installer.js; the timeout here
  //    is just for the exec() call returning, not for the service to stop.
  let nssmCmd = 'nssm';
  try {
    const installDir = getInstallDir();
    const nssmPath = installDir && path.join(installDir, 'runtime', 'nssm.exe');
    if (nssmPath && fs.existsSync(nssmPath)) nssmCmd = `"${nssmPath}"`;
  } catch { /* fall back to bare nssm */ }
  try {
    await execAsync(`${nssmCmd} stop ${SERVICE_NAME}`, { timeout: timeoutMs, windowsHide: true });
    log('nssm stop returned cleanly');
  } catch (err) {
    // Stop is allowed to "fail" if the service was already stopped, or if
    // nssm.exe isn't resolvable (we'll fall through to PowerShell + the
    // node.exe-exit poll below).
    warn('nssm stop returned non-zero (may already be stopped):', err.message);
  }

  // 2. Wait for node.exe to actually exit. NSSM returning doesn't mean the
  //    child process is gone — it just means the SCM accepted the stop.
  //    The PowerShell check below counts node processes; we poll until
  //    zero or the timeout hits.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execAsync(
        'powershell -NoProfile -WindowStyle Hidden -Command "(Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count"',
        { windowsHide: true, timeout: 5000 }
      );
      const count = Number((stdout || '').trim());
      if (Number.isFinite(count) && count === 0) {
        log('node.exe processes have exited');
        return;
      }
    } catch {
      // PowerShell not available or returned junk — fall through, retry.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  warn(`timed out (${timeoutMs}ms) waiting for node.exe to exit — installing anyway`);
}

function emit(channel, payload) {
  try {
    sendToRenderer(channel, payload);
  } catch (err) {
    warn('failed to forward event to renderer:', err?.message);
  }
}

/**
 * Initialize the auto-updater.  Call once from main.js after `app.whenReady()`.
 *
 * @param {object} opts
 * @param {() => Electron.BrowserWindow | null} opts.getMainWindow
 */
function initAutoUpdater({ getMainWindow }) {
  // Rotate the on-disk log if it's grown unwieldy. Cheap, runs once at boot.
  rotateUpdateLogIfNeeded();
  log(`auto-updater initialized (app version: ${app.getVersion()}, log: ${updateLogPath() || 'disabled'})`);

  sendToRenderer = (channel, payload) => {
    const win = getMainWindow && getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  log(`auto-updater init — app version: ${app.getVersion()}, feed: ${FEED_OWNER}/${FEED_REPO}`);

  // Config — point at our public GitHub releases. Keeps the logic out of
  // app-update.yml (which our custom NSIS installer doesn't generate).
  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: FEED_OWNER,
      repo: FEED_REPO,
    });
  } catch (err) {
    warn('setFeedURL failed (offline or bad config):', err?.message);
  }

  // We show our own UI — don't auto-download without telling the user. But
  // for now, auto-download is fine because the user can still opt to skip
  // installing. Makes updates feel instant when they click "Restart".
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;  // Renderer-triggered only

  // ─── Event wiring ──────────────────────────────────────
  autoUpdater.on('checking-for-update', () => {
    log('checking for updates…');
    lastState = { ...lastState, phase: 'checking', error: null };
    emit('updater:checking', {});
  });

  autoUpdater.on('update-available', (info) => {
    log('update available:', info?.version);
    lastState = {
      ...lastState,
      phase: 'available',
      version: info?.version || null,
      error: null,
    };
    emit('updater:update-available', {
      version: info?.version || null,
      releaseName: info?.releaseName || null,
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : null,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log('no update — current version is latest:', info?.version);
    lastState = {
      ...lastState,
      phase: 'not-available',
      version: info?.version || null,
      error: null,
    };
    emit('updater:not-available', { version: info?.version || null });
  });

  autoUpdater.on('download-progress', (progress) => {
    const p = {
      percent: Math.round(progress?.percent || 0),
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
      bytesPerSecond: progress?.bytesPerSecond || 0,
    };
    lastState = { ...lastState, phase: 'downloading', progress: p };
    emit('updater:download-progress', p);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log('update downloaded, ready to install:', info?.version);
    lastState = {
      ...lastState,
      phase: 'downloaded',
      version: info?.version || lastState.version,
      error: null,
    };
    emit('updater:update-downloaded', { version: info?.version || null });
    // P3.11 — fire telemetry: user has been shown the "restart to install"
    // prompt. Lets us measure update-prompt-to-restart conversion across
    // the install base.
    try {
      desktopTelemetry.reportEvent('update.prompt-shown', {
        fromVersion: app.getVersion(),
        toVersion: info?.version || null,
      });
    } catch {}
  });

  autoUpdater.on('error', (err) => {
    const msg = err?.message || String(err);
    warn('error:', msg);
    lastState = { ...lastState, phase: 'error', error: msg };
    emit('updater:error', { message: msg });
  });

  // ─── Trigger the first check shortly after launch ──────
  initialTimer = setTimeout(() => {
    check({ silent: true });
  }, INITIAL_CHECK_DELAY_MS);

  // ─── Recur every 6 h so long-running installs catch updates ─
  periodicTimer = setInterval(() => {
    check({ silent: true });
  }, CHECK_INTERVAL_MS);
}

/**
 * Manually trigger a check. Returns the lastState so the renderer can
 * update its UI synchronously based on what we knew before + will get
 * async events as the check progresses.
 *
 * @param {{ silent?: boolean }} [opts]
 */
async function check(_opts = {}) {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // checkForUpdates already emits an 'error' event; we just swallow here
    // so unhandled rejections don't show up in logs.
    warn('checkForUpdates threw:', err?.message);
  }
  return lastState;
}

/**
 * Called by the renderer when the user clicks "Restart to install".
 *
 * Sequence:
 *   1. Verify an update is actually downloaded.
 *   2. Stop the CitadelServer Windows service and wait for node.exe to
 *      release file handles. This is the fix for the v2.7.0 bug where
 *      the install ran while the service was still bound to :3001 and
 *      holding files open. (P1.1)
 *   3. Schedule app.relaunch() *before* quitAndInstall — even if NSIS
 *      doesn't trigger LaunchDashboard() (which it skips on silent
 *      installs), Electron's own relaunch will bring the app back. (P1.1)
 *   4. Trigger quitAndInstall. NSIS runs silently, re-registers the
 *      service via service-installer.js, and starts it.
 *
 * Returns immediately on validation failure; otherwise returns once the
 * service stop has completed and quitAndInstall has been invoked.
 */
async function installNow() {
  if (lastState.phase !== 'downloaded') {
    warn('installNow called but no update is downloaded');
    return { ok: false, reason: 'no-update-downloaded' };
  }

  const fromVersion = app.getVersion();
  const toVersion = lastState.version || 'unknown';
  log(`installNow: starting update flow (${fromVersion} → ${toVersion})`);

  // P3.11 — telemetry. Fire install-clicked BEFORE we stop the service
  // (which writes to the same data dir the backend's flush loop reads).
  try {
    desktopTelemetry.reportEvent('update.install-clicked', { fromVersion, toVersion });
  } catch {}

  // P3.11 — write the update-in-progress marker. The next backend boot
  // (post-install) reads this file and emits update.completed if the
  // running version matches toVersion, or update.failed if it doesn't.
  try {
    const ok = desktopTelemetry.writeUpdateMarker({ fromVersion, toVersion });
    log(`update marker ${ok ? 'written' : 'NOT written (data dir not found)'}`);
  } catch (err) {
    warn('update marker write failed:', err?.message);
  }

  try {
    await stopServiceGracefully();
  } catch (err) {
    // stopServiceGracefully is meant to be no-throw; this is paranoia.
    warn('stopServiceGracefully threw unexpectedly:', err?.message);
  }

  // Deliberately NO app.relaunch() here. Electron relaunches the moment the
  // app exits — i.e. BEFORE the elevated NSIS installer copies files — so the
  // old build came back up, held $INSTDIR\desktop\* locked, and the desktop
  // app silently stayed on the previous version while everything else
  // updated (the v2.24.1 self-update bug). The installer now owns the
  // relaunch: it taskkills any lingering Citadel.exe before copying and
  // starts the NEW build at the end of its silent section.
  log('calling quitAndInstall(silent=true, forceRunAfter=true)');
  // isSilent=true → runs the NSIS /S switch → no UI, just elevation prompt
  autoUpdater.quitAndInstall(true, true);
  return { ok: true };
}

function getStatus() {
  return { ...lastState };
}

function dispose() {
  if (initialTimer) clearTimeout(initialTimer);
  if (periodicTimer) clearInterval(periodicTimer);
  initialTimer = null;
  periodicTimer = null;
}

module.exports = {
  initAutoUpdater,
  check,
  installNow,
  getStatus,
  dispose,
  // Exposed for the menu's "Show Update Log" item (P1.5)
  getUpdateLogPath: updateLogPath,
};
