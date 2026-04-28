/**
 * Shared mission folder detection for DayZ economy editors.
 * Extracted from types-editor.routes.js for reuse across all economy editors.
 */
const fs = require('fs');
const path = require('path');
const { readServerConfig } = require('./dayz-config');

const TEMPLATE_TO_FOLDER = {
  'dayzoffline.chernarusplus': 'dayzOffline.chernarusplus',
  'chernarusplus': 'dayzOffline.chernarusplus',
  'chernarus': 'dayzOffline.chernarusplus',
  'dayzoffline.enoch': 'dayzOffline.enoch',
  'enoch': 'dayzOffline.enoch',
  'livonia': 'dayzOffline.enoch',
  'dayzoffline.sakhal': 'dayzOffline.sakhal',
  'sakhal': 'dayzOffline.sakhal',
  'deerisle': 'deerisle',
  'deer_isle': 'deerisle',
  'namalsk': 'namalsk',
  'namalskisland': 'namalsk',
  'takistanplus': 'takistanplus',
  'takistan': 'takistanplus',
  'banov': 'banov',
  'esseker': 'esseker',
  'rostow': 'rostow',
  'alteria': 'alteria',
  'pripyat': 'pripyat',
};

/**
 * Detect the mission folder name from the server's install directory.
 * Tries template matching from serverDZ.cfg, then falls back to directory scanning.
 *
 * @param {string} installDir - Server install directory
 * @returns {string|null} Mission folder name or null
 */
function detectMissionFolder(installDir) {
  const mpDir = path.join(installDir, 'mpmissions');
  if (!fs.existsSync(mpDir)) return null;
  const cfg = readServerConfig(installDir);
  const template = (cfg.template || '').toLowerCase();
  if (template && TEMPLATE_TO_FOLDER[template]) {
    const candidate = path.join(mpDir, TEMPLATE_TO_FOLDER[template]);
    if (fs.existsSync(candidate)) return TEMPLATE_TO_FOLDER[template];
  }
  try {
    const entries = fs.readdirSync(mpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (template && entry.name.toLowerCase().includes(template)) return entry.name;
    }
    const dirs = entries.filter(e => e.isDirectory());
    if (dirs.length > 0) return dirs[0].name;
  } catch { /* ignore */ }
  return null;
}

/**
 * Get the full mission directory path for a server.
 *
 * @param {object} srv - Server config object (must have installDir)
 * @returns {string|null} Full mission directory path or null
 */
function getMissionDir(srv) {
  const missionFolder = detectMissionFolder(srv.installDir);
  if (!missionFolder) return null;
  const missionDir = path.join(srv.installDir, 'mpmissions', missionFolder);
  return fs.existsSync(missionDir) ? missionDir : null;
}

/**
 * Create a backup of a file before editing.
 *
 * @param {string} installDir - Server install directory
 * @param {string} fullPath - Full path to the file being backed up
 * @param {string} fileName - File name for the backup
 */
function createBackup(installDir, fullPath, fileName) {
  const backupDir = path.join(installDir, '.backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(fullPath, path.join(backupDir, `${fileName}.${Date.now()}.bak`));
}

module.exports = {
  TEMPLATE_TO_FOLDER,
  detectMissionFolder,
  getMissionDir,
  createBackup,
};
