/**
 * Auto-update lifecycle.
 *
 * electron-updater polls our public GitHub Releases page for a `latest.yml`
 * manifest. When a newer version exists, it downloads the NSIS installer in
 * the background, then prompts the user to restart (via the `update-downloaded`
 * event). On restart the new installer runs silently and relaunches the app.
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
 */
const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// GitHub repo that hosts the releases. Public repo — no token required.
const FEED_OWNER = 'Sk3tch-Dev-Ux';
const FEED_REPO = 'DayzServerController';

// Periodic check interval (6 hours). We also check once ~10 s after launch.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 10 * 1000;

// ── File-based debug log ──────────────────────────────────
// Writes to <installDir>/data/updater.log so users can share the log when
// reporting update issues. We keep it small — only key lifecycle events.
const LOG_FILE = (() => {
  try {
    // In production the exe is at <installDir>/desktop/Citadel.exe
    // → data/ is at <installDir>/data/
    const exeDir = path.dirname(app.getPath('exe'));
    const installDir = path.dirname(exeDir);
    const dataDir = path.join(installDir, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    return path.join(dataDir, 'updater.log');
  } catch {
    return null;
  }
})();

function fileLog(level, msg) {
  if (!LOG_FILE) return;
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `${ts} [${level}] ${msg}\n`);
    // Keep the log file from growing unbounded — truncate if > 500 KB
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 512 * 1024) {
      const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n');
      fs.writeFileSync(LOG_FILE, lines.slice(-200).join('\n'), 'utf-8');
    }
  } catch { /* best-effort */ }
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
  // eslint-disable-next-line no-console
  console.log('[updater]', ...args);
  fileLog('INFO', args.join(' '));
}

function warn(...args) {
  // eslint-disable-next-line no-console
  console.warn('[updater]', ...args);
  fileLog('WARN', args.join(' '));
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
 * Called by the renderer when the user clicks "Restart to install". This
 * immediately quits the app and runs the new installer.
 */
function installNow() {
  if (lastState.phase !== 'downloaded') {
    warn('installNow called but no update is downloaded');
    return { ok: false, reason: 'no-update-downloaded' };
  }
  log('installing update — quitting app and running installer...');

  // CRITICAL: Set app.isQuiting BEFORE quitAndInstall(). The main window's
  // 'close' handler hides to tray unless this flag is true. Without it,
  // quitAndInstall's internal app.quit() call just hides the window and
  // the app never actually exits — so the installer can't overwrite files.
  app.isQuiting = true;

  // isSilent=true → runs the NSIS /S switch → no UI, just elevation prompt
  // isForceRunAfter=true → hints that the app should relaunch after install
  // Our NSIS .onInstSuccess callback handles the actual relaunch in /S mode.
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
};
