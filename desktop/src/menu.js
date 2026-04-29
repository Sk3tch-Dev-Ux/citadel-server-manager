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

function buildMenu({ openExternal, quit, reload, toggleDevTools, showUpdateLog }) {
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
        { label: 'Citadel Cloud Account', click: () => openExternal('https://citadels.cc/account') },
        { label: 'Discord', click: () => openExternal('https://citadels.cc/discord') },
        { type: 'separator' },
        // P1.5 — surfaces %APPDATA%/Citadel/update.log in the user's default
        // text editor. Lets us tell a customer "send me your update log" in
        // one sentence instead of explaining where the file lives.
        { label: 'Show Update Log', click: () => showUpdateLog && showUpdateLog() },
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
