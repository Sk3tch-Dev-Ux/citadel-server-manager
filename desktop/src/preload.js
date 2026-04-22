/**
 * Preload script — runs in the renderer's privileged context and exposes a
 * minimal, vetted API to window.citadel via contextBridge.
 *
 * Everything else (Node APIs, ipcRenderer.* directly, fs, child_process) is
 * intentionally NOT exposed — the renderer is sandboxed and untrusted.
 *
 * When new native features are needed (file pickers, notifications,
 * license info, service control), add them here + in src/ipc.js (main).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('citadel', {
  // Feature flag — React code can check `window.citadel?.isDesktop` to
  // conditionally enable desktop-only UX (native menus, open-in-explorer, etc.)
  isDesktop: true,
  platform: process.platform,

  // ── Event subscriptions (main → renderer) ──
  onBackendUnavailable: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('backend:unavailable', handler);
    return () => ipcRenderer.removeListener('backend:unavailable', handler);
  },

  // ── App metadata ──
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  // ── Native file / folder dialogs ──
  // Each returns the selected path string, or null if the user cancelled.
  openDirectory: (opts) => ipcRenderer.invoke('dialog:open-directory', opts || {}),
  openFile: (opts) => ipcRenderer.invoke('dialog:open-file', opts || {}),

  // ── Windows Explorer / external browser ──
  showInExplorer: (targetPath) => ipcRenderer.invoke('shell:show-in-explorer', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // ── Native toast notifications ──
  notify: (opts) => ipcRenderer.invoke('notify', opts || {}),

  // ── License surface (stub in Phase 1; Phase 2 fills these out) ──
  // These are exposed now so the React sign-in screen can be built against
  // this contract before the network code is wired up.
  license: {
    activate: (_creds) => Promise.reject(new Error('license.activate — Phase 2')),
    verify: () => Promise.resolve({ valid: false, reason: 'not-implemented' }),
    deactivate: () => Promise.resolve({ ok: true }),
    getStatus: () => ipcRenderer.invoke('license:get-status'),
  },
});
