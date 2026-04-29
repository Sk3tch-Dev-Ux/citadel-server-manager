/**
 * Application menu (the bar across the top of the window).
 *
 * Kept deliberately thin — most functionality lives inside the web dashboard.
 * Menu items here should either be (a) native things the web UI can't do
 * (reload, devtools, external links) or (b) shortcuts the user expects to find
 * in a Windows app's menu bar (Quit, About).
 */
const { Menu } = require('electron');

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
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
