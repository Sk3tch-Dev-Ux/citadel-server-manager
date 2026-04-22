/**
 * Citadel Desktop — main process entry.
 *
 * Design:
 *   The desktop app is a thin native wrapper around the web dashboard served
 *   by the Citadel Windows service on localhost:3001. On launch we show a
 *   splash page, poll the backend's /api/health/ping, and swap the window
 *   to the dashboard URL as soon as the service responds.
 *
 *   The window is kept alive in the tray when the user clicks the close
 *   button — quitting only happens via tray menu or app menu. This matches
 *   the UX of Discord / Slack / Notion for always-running local tools.
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { waitForBackend } = require('./service-manager');
const { createTray } = require('./tray');
const { buildMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc');

const DEV = process.argv.includes('--dev') || process.env.CITADEL_DEV === '1';
const BACKEND_URL = process.env.CITADEL_URL || 'http://localhost:3001';
const BACKEND_TIMEOUT_MS = Number(process.env.CITADEL_WAIT_TIMEOUT_MS || 60000);

// Enforce single-instance — opening a second installer focuses the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f172a',
    title: 'Citadel',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Show splash while we wait for the backend to come up.
  mainWindow.loadFile(path.join(__dirname, '..', 'splash', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Poll the backend; swap to the dashboard when it responds.
  waitForBackend(BACKEND_URL, BACKEND_TIMEOUT_MS).then((ready) => {
    if (!mainWindow) return;
    if (ready) {
      mainWindow.loadURL(BACKEND_URL);
    } else {
      // Backend never responded — tell the splash to show the error state
      mainWindow.webContents.send('backend:unavailable');
    }
  });

  // External links open in the default browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(BACKEND_URL) && !url.startsWith('about:') && !url.startsWith('devtools://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Intercept window close — hide to tray instead of quitting.
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (!mainWindow) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  registerIpcHandlers({ getMainWindow: () => mainWindow });

  buildMenu({
    openExternal: (url) => shell.openExternal(url),
    quit: () => {
      app.isQuiting = true;
      app.quit();
    },
    reload: () => mainWindow && mainWindow.reload(),
    toggleDevTools: () => mainWindow && mainWindow.webContents.toggleDevTools(),
  });

  createWindow();

  tray = createTray({
    onOpen: () => {
      if (!mainWindow) createWindow();
      else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onQuit: () => {
      app.isQuiting = true;
      app.quit();
    },
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('before-quit', () => {
  app.isQuiting = true;
});

// Don't quit when all windows close — stay resident in the tray.
// Tray "Quit" is the only path that actually exits.
app.on('window-all-closed', () => {
  // no-op on Windows for this app
});

if (DEV) {
  // eslint-disable-next-line no-console
  console.log(`[citadel-desktop] dev mode — backend URL: ${BACKEND_URL}`);
}
