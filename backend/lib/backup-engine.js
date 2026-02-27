/**
 * Backup Engine — Automated & Manual game-file backup system.
 *
 * Creates ZIP archives of configured server directories (e.g., mpmissions, profiles).
 * Ticks every 60 seconds to check if any server needs an automated backup.
 * Uses PowerShell Compress-Archive (no npm deps, Windows-only).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const ctx = require('./context');
const { loadJSON, saveJSON } = require('./data-store');
const { addLog } = require('./audit');
const { addNotification } = require('./notifications');
const { safePath } = require('./helpers');

const TICK_MS = 60_000; // 60 seconds

const DEFAULT_CONFIG = {
  enabled: false,
  backupAtStartup: false,
  intervalMinutes: 60,
  maxKeepDays: 7,
  paths: ['mpmissions', 'profiles'],
  lastBackupAt: null,
};

// ─── Config Helpers ──────────────────────────────────────

function getBackupConfig(serverId) {
  const state = ctx.serverStates[serverId];
  if (state?.backup?.config) return state.backup.config;
  return loadJSON(ctx.CONFIG.dataDir, `backup-${serverId}.json`, { ...DEFAULT_CONFIG });
}

function saveBackupConfig(serverId, config) {
  saveJSON(ctx.CONFIG.dataDir, `backup-${serverId}.json`, config);
  const state = ctx.serverStates[serverId];
  if (state?.backup) state.backup.config = config;
}

// ─── Create Backup ───────────────────────────────────────

/**
 * Create a ZIP backup of configured paths.
 * @param {string} serverId
 * @param {'automated'|'manual'} type
 * @returns {Promise<{filename:string, size:number, createdAt:string}|null>}
 */
function createBackup(serverId, type) {
  return new Promise((resolve) => {
    const srv = ctx.servers.find(s => s.id === serverId);
    if (!srv || !srv.installDir) { resolve(null); return; }
    if (!fs.existsSync(srv.installDir)) { resolve(null); return; }

    const state = ctx.serverStates[serverId];
    if (state?.backup?.inProgress) {
      logger.debug({ serverId }, 'Backup: already in progress, skipping');
      resolve(null);
      return;
    }

    const config = getBackupConfig(serverId);
    if (!config.paths || config.paths.length === 0) {
      logger.debug({ serverId }, 'Backup: no paths configured');
      resolve(null);
      return;
    }

    // Validate paths exist
    const validPaths = [];
    for (const relPath of config.paths) {
      const full = safePath(srv.installDir, relPath);
      if (full && fs.existsSync(full)) {
        validPaths.push(full);
      } else {
        logger.debug({ serverId, path: relPath }, 'Backup: path does not exist or invalid, skipping');
      }
    }

    if (validPaths.length === 0) {
      logger.warn({ serverId }, 'Backup: all configured paths are invalid or missing');
      resolve(null);
      return;
    }

    // Set in-progress flag
    if (state?.backup) state.backup.inProgress = true;

    // Create backup directory
    const backupDir = path.join(srv.installDir, '.backups', type);
    try { fs.mkdirSync(backupDir, { recursive: true }); } catch (err) {
      logger.error({ err, serverId }, 'Backup: failed to create backup directory');
      if (state?.backup) state.backup.inProgress = false;
      resolve(null);
      return;
    }

    // Generate filename
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-${ts}.zip`;
    const zipPath = path.join(backupDir, filename);

    // Build PowerShell command
    const sources = validPaths.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
    const dest = zipPath.replace(/'/g, "''");
    const cmd = `Compress-Archive -Path ${sources} -DestinationPath '${dest}' -Force`;

    logger.info({ serverId, type, filename, pathCount: validPaths.length }, 'Backup: starting ZIP creation');

    const proc = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch (_) { /* ignore */ }
      logger.error({ serverId }, 'Backup: timed out after 5 minutes');
      if (state?.backup) state.backup.inProgress = false;
      resolve(null);
    }, 300_000); // 5 minute timeout

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (state?.backup) state.backup.inProgress = false;

      if (code !== 0) {
        logger.error({ serverId, code, stderr: stderr.slice(0, 500) }, 'Backup: PowerShell Compress-Archive failed');
        addLog(serverId, 'error', 'backup', `Backup failed: exit code ${code}`);
        resolve(null);
        return;
      }

      // Get file size
      let size = 0;
      try { size = fs.statSync(zipPath).size; } catch (_) { /* ignore */ }

      const createdAt = now.toISOString();

      // Update lastBackupAt
      config.lastBackupAt = createdAt;
      saveBackupConfig(serverId, config);

      // Log + notify
      const sizeMB = (size / 1024 / 1024).toFixed(1);
      addLog(serverId, 'info', 'backup', `${type === 'manual' ? 'Manual' : 'Automated'} backup created: ${filename} (${sizeMB} MB)`);
      addNotification(serverId, 'backup.created', 'Backup Created', `${srv.name}: ${filename} (${sizeMB} MB)`, 'info');

      if (ctx.io) {
        ctx.io.emit('backupCreated', { serverId, filename, type, size, createdAt });
      }

      logger.info({ serverId, filename, sizeMB }, 'Backup: completed successfully');
      resolve({ filename, size, createdAt, type });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (state?.backup) state.backup.inProgress = false;
      logger.error({ err, serverId }, 'Backup: spawn error');
      addLog(serverId, 'error', 'backup', `Backup failed: ${err.message}`);
      resolve(null);
    });
  });
}

// ─── Cleanup Old Backups ────────────────────────────────

function cleanupOldBackups(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv || !srv.installDir) return;

  const config = getBackupConfig(serverId);
  const maxAge = (config.maxKeepDays || 7) * 86400_000;
  const now = Date.now();

  for (const type of ['automated', 'manual']) {
    const dir = path.join(srv.installDir, '.backups', type);
    if (!fs.existsSync(dir)) continue;

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.zip')) continue;
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > maxAge) {
            fs.unlinkSync(fullPath);
            logger.info({ serverId, filename: entry, type }, 'Backup: cleaned up old backup');
            addLog(serverId, 'info', 'backup', `Cleaned up old ${type} backup: ${entry}`);
          }
        } catch (err) {
          logger.debug({ err, file: entry }, 'Backup: cleanup stat/unlink error');
        }
      }
    } catch (err) {
      logger.debug({ err, dir }, 'Backup: cleanup readdir error');
    }
  }
}

// ─── List Backups ────────────────────────────────────────

function listBackups(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv || !srv.installDir) return [];

  const results = [];

  for (const type of ['automated', 'manual']) {
    const dir = path.join(srv.installDir, '.backups', type);
    if (!fs.existsSync(dir)) continue;

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.zip')) continue;
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          results.push({
            filename: entry,
            type,
            size: stat.size,
            createdAt: stat.mtime.toISOString(),
          });
        } catch (_) { /* skip unreadable */ }
      }
    } catch (_) { /* skip unreadable dirs */ }
  }

  // Sort newest first
  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return results;
}

// ─── Delete Backup ──────────────────────────────────────

function deleteBackup(serverId, filename, type) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv || !srv.installDir) return false;

  const backupsRoot = path.join(srv.installDir, '.backups', type || 'manual');
  const fullPath = safePath(backupsRoot, filename);
  if (!fullPath) return false;
  if (!fs.existsSync(fullPath)) return false;

  try {
    fs.unlinkSync(fullPath);
    addLog(serverId, 'info', 'backup', `Deleted ${type || 'manual'} backup: ${filename}`);
    return true;
  } catch (err) {
    logger.error({ err, serverId, filename }, 'Backup: delete failed');
    return false;
  }
}

// ─── Backup Engine Tick ─────────────────────────────────

let _tickRunning = false;

async function tick() {
  if (_tickRunning) return;
  _tickRunning = true;

  try {
    for (const srv of ctx.servers) {
      const config = getBackupConfig(srv.id);
      if (!config.enabled) continue;

      const intervalMs = (config.intervalMinutes || 60) * 60_000;
      const lastBackup = config.lastBackupAt ? new Date(config.lastBackupAt).getTime() : 0;
      const elapsed = Date.now() - lastBackup;

      if (elapsed >= intervalMs) {
        await createBackup(srv.id, 'automated');
        cleanupOldBackups(srv.id);
      }
    }
  } catch (err) {
    logger.error({ err }, 'Backup engine tick error');
  } finally {
    _tickRunning = false;
  }
}

/**
 * Start the backup engine. Returns the interval ID for cleanup.
 */
function startBackupEngine() {
  logger.info('Backup engine started (60s tick)');
  return setInterval(tick, TICK_MS);
}

/**
 * Run startup backups for servers with backupAtStartup enabled.
 */
async function runStartupBackups() {
  for (const srv of ctx.servers) {
    const config = getBackupConfig(srv.id);
    if (config.enabled && config.backupAtStartup) {
      logger.info({ serverId: srv.id, name: srv.name }, 'Backup: running startup backup');
      await createBackup(srv.id, 'automated');
    }
  }
}

module.exports = {
  createBackup,
  cleanupOldBackups,
  listBackups,
  deleteBackup,
  startBackupEngine,
  runStartupBackups,
  getBackupConfig,
  saveBackupConfig,
  DEFAULT_CONFIG,
};
