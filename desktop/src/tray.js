/**
 * System tray — "always-available" icon next to the clock.
 * Left-click opens the main window. Right-click shows a context menu.
 *
 * The tray is the only thing keeping the app alive after the main window
 * is closed, so quitting must go through the tray's "Quit" item (or the
 * File menu's equivalent).
 */
const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

function createTray({ onOpen, onQuit }) {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // Graceful fallback if the asset hasn't been generated yet —
    // Windows will show a default question-mark icon, which is still
    // interactive (the tray menu still works).
    icon = nativeImage.createEmpty();
  }

  const tray = new Tray(icon);
  tray.setToolTip(`Citadel — DayZ Server Controller (v${app.getVersion()})`);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Citadel', click: onOpen },
    { type: 'separator' },
    { label: 'Citadel', enabled: false },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: onQuit },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', onOpen);
  tray.on('double-click', onOpen);

  return tray;
}

module.exports = { createTray };
