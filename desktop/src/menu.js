/**
 * Application menu (the bar across the top of the window).
 *
 * Kept deliberately thin — most functionality lives inside the web dashboard.
 * Menu items here should either be (a) native things the web UI can't do
 * (reload, devtools, external links, update check) or (b) shortcuts the user
 * expects to find in a Windows app's menu bar (Quit, About).
 */
const { Menu, dialog, app } = require('electron');
const autoUpdaterModule = require('./auto-updater');

function buildMenu({ openExternal, quit, reload, toggleDevTools, getMainWindow }) {
  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'Reload Dashboard', accelerator: 'CmdOrCtrl+R', click: reload },
        { type: 'separator' },
        { label: 'Quit Citadel', accelerator: 'CmdOrCtrl+Q', click: quit },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: toggleDevTools },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Documentation', click: () => openExternal('https://citadels.cc/docs') },
        { label: 'Pricing & Account', click: () => openExternal('https://citadels.cc/account') },
        { label: 'Discord', click: () => openExternal('https://citadels.cc/discord') },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          // Run a manual update check right now instead of waiting for the
          // 6-hour periodic poll. Shows a native dialog with the result so
          // users get feedback (otherwise it's silent and they don't know
          // anything happened).
          click: async () => {
            const win = getMainWindow && getMainWindow();
            const status = autoUpdaterModule.getStatus();
            if (status.phase === 'downloading') {
              dialog.showMessageBox(win, {
                type: 'info',
                title: 'Update in progress',
                message: `Downloading update (${status.progress?.percent || 0}%)…`,
                buttons: ['OK'],
              });
              return;
            }
            if (status.phase === 'downloaded') {
              const choice = dialog.showMessageBoxSync(win, {
                type: 'question',
                title: 'Update ready',
                message: `Update ${status.version ? 'v' + status.version + ' ' : ''}is downloaded and ready to install.`,
                detail: 'Restart now to complete the install?',
                buttons: ['Restart & Install', 'Later'],
                defaultId: 0,
                cancelId: 1,
              });
              if (choice === 0) autoUpdaterModule.installNow();
              return;
            }
            // Trigger a fresh check
            const result = await autoUpdaterModule.check();
            // Give the event loop a tick to let the updater's event handlers
            // update state, then inspect it.
            setTimeout(() => {
              const after = autoUpdaterModule.getStatus();
              if (after.phase === 'available' || after.phase === 'downloading') {
                dialog.showMessageBox(win, {
                  type: 'info',
                  title: 'Update available',
                  message: `Citadel ${after.version ? 'v' + after.version : ''} is available.`,
                  detail: 'It will download in the background. You\'ll see a "Restart & Install" banner when it\'s ready.',
                  buttons: ['OK'],
                });
              } else if (after.phase === 'error') {
                dialog.showMessageBox(win, {
                  type: 'warning',
                  title: 'Update check failed',
                  message: 'Could not check for updates.',
                  detail: after.error || 'Unknown error',
                  buttons: ['OK'],
                });
              } else {
                // not-available or still-checking — tell the user they're on latest
                dialog.showMessageBox(win, {
                  type: 'info',
                  title: 'Up to date',
                  message: `You're on the latest version of Citadel (v${app.getVersion()}).`,
                  buttons: ['OK'],
                });
              }
            }, 1500);
            return result;
          },
        },
        { type: 'separator' },
        { label: 'Report an Issue', click: () => openExternal('https://github.com/Sk3tch-Dev-Ux/DayzServerController/issues') },
        {
          label: 'About Citadel',
          click: () => {
            const win = getMainWindow && getMainWindow();
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About Citadel',
              message: `Citadel DayZ Manager v${app.getVersion()}`,
              detail: `Electron: ${process.versions.electron}\nNode: ${process.versions.node}\nChromium: ${process.versions.chrome}\n\nhttps://citadels.cc`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
