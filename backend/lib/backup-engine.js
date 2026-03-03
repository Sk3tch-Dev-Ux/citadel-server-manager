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

// ─── Wildcard Path Expansion ────────────────────────────

/**
 * Convert a simple wildcard pattern (using * only) to a RegExp.
 * E.g. "*.ADM" → /^.*\.ADM$/
 */
function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$');
}

/**
 * Expand a relative path that may contain a `*` wildcard into concrete paths.
 * - If the path has no wildcard, it behaves like before (returns the full path if it exists).
 * - If the last segment contains `*`, the parent dir is listed and entries matching
 *   the wildcard are returned.
 * E.g. "mpmissions/*" → all entries inside mpmissions/
 * E.g. "profiles/*.ADM" → all .ADM files inside profiles/
 * @param {string} installDir - absolute base directory
 * @param {string} relPath - relative path, possibly with wildcard in the last segment
 * @returns {string[]} array of resolved absolute paths
 */
function expandWildcardPath(installDir, relPath) {
  // Normalize separators
  const normalized = relPath.replace(/\\/g, '/');

  // If no wildcard, fall back to original behavior
  if (!normalized.includes('*')) {
    const full = safePath(installDir, normalized);
    if (full && fs.existsSync(full)) return [full];
    return [];
  }

  // Split into parent dir + wildcard segment
  const lastSlash = normalized.lastIndexOf('/');
  const parentRel = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '.';
  const pattern = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

  const parentFull = safePath(installDir, parentRel);
  if (!parentFull || !fs.existsSync(parentFull)) return [];

  try {
    const regex = wildcardToRegex(pattern);
    const entries = fs.readdirSync(parentFull);
    const matches = [];
    for (const entry of entries) {
      if (regex.test(entry)) {
        const entryFull = path.join(parentFull, entry);
        matches.push(entryFull);
      }
    }
    return matches;
  } catch (err) {
    logger.debug({ err, relPath }, 'Backup: wildcard expansion failed');
    return [];
  }
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

    // Validate paths (with wildcard expansion)
    const validPaths = [];
    for (const relPath of config.paths) {
      const expanded = expandWildcardPath(srv.installDir, relPath);
      for (const full of expanded) {
        if (!validPaths.includes(full)) validPaths.push(full);
      }
      if (expanded.length === 0) {
        logger.debug({ serverId, path: relPath }, 'Backup: path does not exist, invalid, or no wildcard matches, skipping');
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

    // DayZ holds file locks while running, so Compress-Archive fails silently on
    // locked files (exits 0 but creates no ZIP). Solution: use robocopy to stage
    // files to a temp dir first (handles locked files with /R:0 /W:0), then ZIP.
    const stagingDir = path.join(backupDir, `_staging_${ts}`);

    // Build PowerShell script: robocopy each source → staging, then Compress-Archive
    const robocopySteps = validPaths.map(p => {
      const name = path.basename(p);
      const escaped = p.replace(/'/g, "''");
      const destDir = path.join(stagingDir, name).replace(/'/g, "''");
      // robocopy exit codes 0-7 are success; /E = include subdirs; /R:0 /W:0 = skip locked files
      return `robocopy '${escaped}' '${destDir}' /E /R:0 /W:0 /NP /NJH /NJS /NDL /NFL; if ($LASTEXITCODE -ge 8) { Write-Warning "robocopy failed for ${name}: exit $LASTEXITCODE" }`;
    }).join('; ');

    const escapedStaging = stagingDir.replace(/'/g, "''");
    const escapedDest = zipPath.replace(/'/g, "''");
    const cmd = [
      `New-Item -ItemType Directory -Path '${escapedStaging}' -Force | Out-Null`,
      robocopySteps,
      `Compress-Archive -Path '${escapedStaging}\\*' -DestinationPath '${escapedDest}' -Force`,
      `Remove-Item '${escapedStaging}' -Recurse -Force -ErrorAction SilentlyContinue`,
    ].join('; ');

    logger.info({ serverId, type, filename, pathCount: validPaths.length }, 'Backup: starting (robocopy + ZIP)');

    const proc = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch (_) { /* ignore */ }
      // Clean up staging dir if it exists
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      logger.error({ serverId }, 'Backup: timed out after 5 minutes');
      if (state?.backup) state.backup.inProgress = false;
      resolve(null);
    }, 300_000); // 5 minute timeout

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (state?.backup) state.backup.inProgress = false;

      // Clean up staging dir if PowerShell didn't
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }

      // Verify the ZIP file was actually created
      if (!fs.existsSync(zipPath)) {
        logger.error({ serverId, code, stderr: stderr.slice(0, 500) }, 'Backup: ZIP file was not created');
        addLog(serverId, 'error', 'backup', `Backup failed: ZIP not created (code ${code})${stderr ? ' — ' + stderr.slice(0, 200) : ''}`);
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
      const skipped = stderr.includes('robocopy failed') ? ' (some locked files skipped)' : '';
      addLog(serverId, 'info', 'backup', `${type === 'manual' ? 'Manual' : 'Automated'} backup created: ${filename} (${sizeMB} MB)${skipped}`);
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
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
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

// ─── Restore Backup ─────────────────────────────────────

/**
 * Resolve a backup filename + type to its absolute path.
 * Searches both automated and manual dirs if type is not specified.
 * @param {string} serverId
 * @param {string} filename
 * @param {string} [type] - 'automated' or 'manual'. If omitted, searches both.
 * @returns {{ zipPath: string, type: string } | null}
 */
function findBackupFile(serverId, filename, type) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv || !srv.installDir) return null;

  const typesToCheck = type ? [type] : ['manual', 'automated'];
  for (const t of typesToCheck) {
    const backupsRoot = path.join(srv.installDir, '.backups', t);
    const fullPath = safePath(backupsRoot, filename);
    if (fullPath && fs.existsSync(fullPath)) {
      return { zipPath: fullPath, type: t };
    }
  }
  return null;
}

/**
 * Restore a backup ZIP to the server's install directory.
 * Creates a safety backup before restoring. Requires the server to be stopped.
 * @param {string} serverId
 * @param {string} filename
 * @param {string} [type] - 'automated' or 'manual'
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
function restoreBackup(serverId, filename, type) {
  return new Promise(async (resolve) => {
    const srv = ctx.servers.find(s => s.id === serverId);
    if (!srv || !srv.installDir) {
      return resolve({ success: false, error: 'Server not found or missing installDir' });
    }

    // Check server is stopped
    const state = ctx.serverStates[serverId];
    if (state && state.status && state.status !== 'stopped' && state.status !== 'offline') {
      return resolve({ success: false, error: `Server must be stopped before restoring (current status: ${state.status})` });
    }

    // Find the backup file
    const found = findBackupFile(serverId, filename, type);
    if (!found) {
      return resolve({ success: false, error: `Backup file not found: ${filename}` });
    }
    const { zipPath } = found;

    // Emit progress: starting
    if (ctx.io) {
      ctx.io.emit('backupRestore', { serverId, status: 'starting', filename });
    }

    logger.info({ serverId, filename }, 'Backup Restore: starting');

    // Create safety backup before restoring
    try {
      const safetyTs = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safetyFilename = `pre-restore-${safetyTs}.zip`;
      const safetyDir = path.join(srv.installDir, '.backups', 'manual');
      try { fs.mkdirSync(safetyDir, { recursive: true }); } catch (_) { /* ignore */ }
      const safetyZipPath = path.join(safetyDir, safetyFilename);

      // Get the current backup config paths to know what to back up
      const config = getBackupConfig(serverId);
      const safetySources = [];
      for (const relPath of (config.paths || [])) {
        const expanded = expandWildcardPath(srv.installDir, relPath);
        for (const p of expanded) {
          if (!safetySources.includes(p)) safetySources.push(p);
        }
      }

      if (safetySources.length > 0) {
        const sources = safetySources.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
        const dest = safetyZipPath.replace(/'/g, "''");
        const safetyCmd = `Compress-Archive -Path ${sources} -DestinationPath '${dest}' -Force`;

        logger.info({ serverId, safetyFilename }, 'Backup Restore: creating safety backup');

        await new Promise((res) => {
          const proc = spawn('powershell', [
            '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', safetyCmd,
          ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

          let stderr = '';
          proc.stderr.on('data', (data) => { stderr += data.toString(); });

          const timeout = setTimeout(() => {
            try { proc.kill(); } catch (_) { /* ignore */ }
            res(false);
          }, 300_000);

          proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
              logger.warn({ serverId, code, stderr: stderr.slice(0, 500) }, 'Backup Restore: safety backup failed, proceeding anyway');
            } else {
              logger.info({ serverId, safetyFilename }, 'Backup Restore: safety backup created');
              addLog(serverId, 'info', 'backup', `Safety backup created before restore: ${safetyFilename}`);
            }
            res(true);
          });

          proc.on('error', () => {
            clearTimeout(timeout);
            res(false);
          });
        });
      } else {
        logger.info({ serverId }, 'Backup Restore: no backup paths configured, skipping safety backup');
      }
    } catch (err) {
      logger.warn({ err, serverId }, 'Backup Restore: safety backup failed, proceeding with restore');
    }

    // Extract the backup ZIP to installDir
    const escapedZip = zipPath.replace(/'/g, "''");
    const escapedDest = srv.installDir.replace(/'/g, "''");
    const restoreCmd = `Expand-Archive -Path '${escapedZip}' -DestinationPath '${escapedDest}' -Force`;

    logger.info({ serverId, filename, installDir: srv.installDir }, 'Backup Restore: extracting ZIP');

    const proc = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', restoreCmd,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch (_) { /* ignore */ }
      logger.error({ serverId }, 'Backup Restore: timed out after 10 minutes');
      if (ctx.io) {
        ctx.io.emit('backupRestore', { serverId, status: 'error', filename, error: 'Restore timed out after 10 minutes' });
      }
      resolve({ success: false, error: 'Restore timed out after 10 minutes' });
    }, 600_000); // 10 minute timeout for restore

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        const errMsg = `Restore failed: PowerShell exit code ${code}`;
        logger.error({ serverId, code, stderr: stderr.slice(0, 500) }, 'Backup Restore: Expand-Archive failed');
        addLog(serverId, 'error', 'backup', `Restore failed for ${filename}: exit code ${code}`);
        if (ctx.io) {
          ctx.io.emit('backupRestore', { serverId, status: 'error', filename, error: errMsg });
        }
        resolve({ success: false, error: errMsg });
        return;
      }

      addLog(serverId, 'info', 'backup', `Backup restored: ${filename}`);
      addNotification(serverId, 'backup.restored', 'Backup Restored', `${srv.name}: restored from ${filename}`, 'info');

      if (ctx.io) {
        ctx.io.emit('backupRestore', { serverId, status: 'complete', filename });
      }

      logger.info({ serverId, filename }, 'Backup Restore: completed successfully');
      resolve({ success: true });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      const errMsg = `Restore failed: ${err.message}`;
      logger.error({ err, serverId }, 'Backup Restore: spawn error');
      addLog(serverId, 'error', 'backup', errMsg);
      if (ctx.io) {
        ctx.io.emit('backupRestore', { serverId, status: 'error', filename, error: errMsg });
      }
      resolve({ success: false, error: errMsg });
    });
  });
}

// ─── List Backup Contents ───────────────────────────────

/**
 * List the contents of a backup ZIP file without extracting.
 * Uses PowerShell to read the ZIP entries.
 * @param {string} serverId
 * @param {string} filename
 * @param {string} [type] - 'automated' or 'manual'
 * @returns {Promise<{ entries: Array<{ name: string, size: number, compressedSize: number }>, error?: string }>}
 */
function listBackupContents(serverId, filename, type) {
  return new Promise((resolve) => {
    const found = findBackupFile(serverId, filename, type);
    if (!found) {
      return resolve({ entries: [], error: 'Backup file not found' });
    }
    const { zipPath } = found;

    const escapedZip = zipPath.replace(/'/g, "''");
    // Use .NET ZipFile to read entries and output as JSON
    const cmd = [
      `Add-Type -AssemblyName System.IO.Compression.FileSystem;`,
      `$zip = [System.IO.Compression.ZipFile]::OpenRead('${escapedZip}');`,
      `$entries = $zip.Entries | Select-Object FullName, Length, CompressedLength;`,
      `$zip.Dispose();`,
      `$entries | ConvertTo-Json -Compress`,
    ].join(' ');

    const proc = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch (_) { /* ignore */ }
      resolve({ entries: [], error: 'Listing timed out' });
    }, 30_000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        logger.error({ serverId, code, stderr: stderr.slice(0, 300) }, 'Backup Contents: failed to list');
        return resolve({ entries: [], error: 'Failed to read backup contents' });
      }

      try {
        let parsed = JSON.parse(stdout);
        // PowerShell returns a single object (not array) if there's only one entry
        if (!Array.isArray(parsed)) parsed = [parsed];
        const entries = parsed.map(e => ({
          name: e.FullName,
          size: e.Length || 0,
          compressedSize: e.CompressedLength || 0,
        }));
        resolve({ entries });
      } catch (err) {
        logger.debug({ err, stdout: stdout.slice(0, 300) }, 'Backup Contents: JSON parse failed');
        resolve({ entries: [], error: 'Failed to parse backup contents' });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ entries: [], error: err.message });
    });
  });
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
  restoreBackup,
  findBackupFile,
  listBackupContents,
  startBackupEngine,
  runStartupBackups,
  getBackupConfig,
  saveBackupConfig,
  DEFAULT_CONFIG,
};
