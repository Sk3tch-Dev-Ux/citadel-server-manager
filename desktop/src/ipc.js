/**
 * IPC handlers — native operations the renderer can request from main.
 *
 * Each handler is registered on a specific channel. The renderer calls them
 * via the `window.citadel.*` surface exposed in preload.js.
 *
 * Keep handlers narrow and well-typed. Never expose raw fs/child_process/shell
 * to the renderer — every native capability must go through a vetted handler
 * here so it can be reasoned about and audited.
 */
const { ipcMain, dialog, shell, Notification, app } = require('electron');
const path = require('path');
const licenseClient = require('./license-client');

function registerIpcHandlers({ getMainWindow }) {
  // ── License client (stub in Phase 1; Phase 2 wires real network calls) ──
  ipcMain.handle('license:get-status', async () => licenseClient.getStatus());
  // ── Native file / folder pickers ───────────────────────────
  ipcMain.handle('dialog:open-directory', async (_evt, opts = {}) => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      title: opts.title || 'Select Folder',
      defaultPath: opts.defaultPath,
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:open-file', async (_evt, opts = {}) => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      title: opts.title || 'Select File',
      defaultPath: opts.defaultPath,
      filters: opts.filters,
      properties: ['openFile', 'dontAddToRecent'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // ── Open a file or folder in Windows Explorer ──────────────
  ipcMain.handle('shell:show-in-explorer', async (_evt, targetPath) => {
    if (typeof targetPath !== 'string' || !targetPath) return false;
    shell.showItemInFolder(path.normalize(targetPath));
    return true;
  });

  ipcMain.handle('shell:open-external', async (_evt, url) => {
    if (typeof url !== 'string') return false;
    // Guard against file:// or exotic protocols — only http/https allowed
    if (!/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  // ── Native notifications (toasts) ──────────────────────────
  ipcMain.handle('notify', async (_evt, { title, body, silent }) => {
    if (!Notification.isSupported()) return false;
    const n = new Notification({
      title: String(title || 'Citadel').slice(0, 100),
      body: String(body || '').slice(0, 500),
      silent: Boolean(silent),
    });
    n.show();
    return true;
  });

  // ── App info ───────────────────────────────────────────────
  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
  }));
}

module.exports = { registerIpcHandlers };
