/**
 * Dangerzone routes — Wipe presets, log cleanup, and server replication.
 *
 * All routes require 'server.rebuild' permission (destructive operations).
 * Every destructive action: stops server if running, creates backup first.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const ctx = require('../lib/context');
const { readServerConfig } = require('../lib/dayz-config');
const { killProcess } = require('../lib/process-manager');
const { createBackup } = require('../lib/backup-engine');
const { addAudit, addLog } = require('../lib/audit');
const { addNotification } = require('../lib/notifications');
const { safePath, getDirSize, formatBytes, copyDirSync } = require('../lib/helpers');
const { authForServer } = require('../middleware/auth');

// ─── Map Detection ──────────────────────────────────────────

const TEMPLATE_TO_FOLDER = {
  'dayzoffline.chernarusplus': 'dayzOffline.chernarusplus',
  'chernarusplus': 'dayzOffline.chernarusplus',
  'dayzoffline.enoch': 'dayzOffline.enoch',
  'enoch': 'dayzOffline.enoch',
  'deerisle': 'deerisle',
  'namalsk': 'namalsk',
};

/**
 * Detect the mpmissions folder name for this server.
 * Scans actual directory and cross-references with serverDZ.cfg template.
 */
function detectMissionFolder(installDir) {
  const mpDir = path.join(installDir, 'mpmissions');
  if (!fs.existsSync(mpDir)) return null;

  const cfg = readServerConfig(installDir);
  const template = (cfg.template || '').toLowerCase();

  // Try known mapping first
  if (template && TEMPLATE_TO_FOLDER[template]) {
    const candidate = path.join(mpDir, TEMPLATE_TO_FOLDER[template]);
    if (fs.existsSync(candidate)) return TEMPLATE_TO_FOLDER[template];
  }

  // Scan for directories that match template or contain storage_1
  try {
    const entries = fs.readdirSync(mpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Match by template name (case-insensitive partial)
      if (template && entry.name.toLowerCase().includes(template)) return entry.name;
    }
    // Fallback: first directory containing storage_1
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (fs.existsSync(path.join(mpDir, entry.name, 'storage_1'))) return entry.name;
    }
    // Last fallback: first directory
    const dirs = entries.filter(e => e.isDirectory());
    if (dirs.length > 0) return dirs[0].name;
  } catch { /* ignore */ }

  return null;
}

/**
 * Get all scan directories for a server (installDir + profileDir if different).
 */
function getScanDirs(srv) {
  const dirs = [path.resolve(srv.installDir)];
  if (srv.profileDir) {
    // Resolve profileDir relative to installDir (profileDir is typically "profiles")
    const profileResolved = path.resolve(srv.installDir, srv.profileDir);
    if (profileResolved !== dirs[0] && fs.existsSync(profileResolved)) {
      dirs.push(profileResolved);
    }
  }
  return dirs;
}

// ─── Wipe Preset Definitions ────────────────────────────────

function getWipePresets(installDir, missionFolder) {
  const mpBase = missionFolder ? `mpmissions/${missionFolder}` : null;

  return [
    {
      id: 'economy',
      name: 'Economy / Loot Reset',
      description: 'Resets all loot spawns, vehicle positions, and dynamic event states. Player characters are preserved but may lose inventory. World persistence (bases, stashes) is cleared.',
      severity: 'warning',
      icon: 'RefreshCw',
      paths: mpBase ? [`${mpBase}/storage_1`] : [],
    },
    {
      id: 'players',
      name: 'Player Data Wipe',
      description: 'Clears all player character save files. Every player will spawn as a fresh character. World state (bases, vehicles, loot) is preserved.',
      severity: 'danger',
      icon: 'Users',
      // Player data: .ADM files and player DB in profiles
      scanForFiles: true,
      filePatterns: [/\.ADM$/i],
      paths: mpBase ? [`${mpBase}/storage_1/data`, `${mpBase}/storage_1/players`] : [],
    },
    {
      id: 'full',
      name: 'Full Persistence Wipe',
      description: 'Deletes ALL persistence data. Everything resets: player characters, loot, vehicles, bases, stashes. This is a complete fresh start.',
      severity: 'critical',
      icon: 'Flame',
      paths: mpBase ? [`${mpBase}/storage_1`] : [],
      // Also include player data directories
      additionalPaths: mpBase ? [] : [],
      includePlayerFiles: true,
    },
  ];
}

// ─── Concurrency Guard ──────────────────────────────────────

function isDangerzoneActive(serverId) {
  return ctx.serverStates[serverId]?.dangerzoneInProgress === true;
}

function setDangerzoneActive(serverId, active) {
  if (ctx.serverStates[serverId]) {
    ctx.serverStates[serverId].dangerzoneInProgress = active;
  }
}

// ─── Shared: Stop Server + Backup ───────────────────────────

async function stopServerIfRunning(serverId, srv) {
  const state = ctx.serverStates[serverId];
  if (state && state.pid) {
    logger.info({ serverId }, 'Dangerzone: stopping server before operation');
    ctx.io.emit('dangerzoneProgress', { serverId, status: 'stopping', message: 'Stopping server...' });
    await killProcess(state.pid, srv.executable);
    state.status = 'stopped';
    state.pid = null;
    state.players = [];
    state.startedAt = null;
    ctx.io.emit('serverStatus', { serverId, status: 'stopped' });
  }
}

async function createPreOpBackup(serverId) {
  ctx.io.emit('dangerzoneProgress', { serverId, status: 'backing-up', message: 'Creating safety backup...' });
  const result = await createBackup(serverId, 'manual');
  if (result) {
    const sizeMB = (result.size / 1024 / 1024).toFixed(1);
    ctx.io.emit('dangerzoneProgress', { serverId, status: 'backed-up', message: `Backup created: ${result.filename} (${sizeMB} MB)` });
  } else {
    ctx.io.emit('dangerzoneProgress', { serverId, status: 'backup-warning', message: 'Backup could not be created (no configured paths or empty). Proceeding...' });
  }
  return result;
}

// ─── Routes ─────────────────────────────────────────────────

module.exports = function (app) {

  // ── GET Wipe Presets ────────────────────────────────────
  app.get('/api/servers/:id/dangerzone/wipe-presets', authForServer('server.rebuild'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const installDir = path.resolve(srv.installDir);
    if (!fs.existsSync(installDir)) {
      return res.json({ presets: [], missionFolder: null, error: 'Install directory not found' });
    }

    const missionFolder = detectMissionFolder(installDir);
    const presets = getWipePresets(installDir, missionFolder);

    // Calculate sizes and availability
    const result = presets.map(preset => {
      let totalSize = 0;
      let available = false;
      const resolvedPaths = [];

      for (const relPath of preset.paths) {
        const fullPath = safePath(installDir, relPath);
        if (fullPath && fs.existsSync(fullPath)) {
          const size = getDirSize(fullPath);
          totalSize += size;
          available = true;
          resolvedPaths.push({ path: relPath, size, exists: true });
        } else {
          resolvedPaths.push({ path: relPath, size: 0, exists: false });
        }
      }

      // For player preset, also scan for .ADM files
      if (preset.scanForFiles) {
        const scanDirs = getScanDirs(srv);
        for (const dir of scanDirs) {
          try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
              for (const pattern of preset.filePatterns) {
                if (pattern.test(file)) {
                  const fp = path.join(dir, file);
                  try {
                    totalSize += fs.statSync(fp).size;
                    available = true;
                  } catch { /* skip */ }
                }
              }
            }
          } catch { /* skip */ }
        }
      }

      return {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        severity: preset.severity,
        icon: preset.icon,
        sizeBytes: totalSize,
        sizeFormatted: formatBytes(totalSize),
        available,
        paths: resolvedPaths,
      };
    });

    res.json({ presets: result, missionFolder });
  });

  // ── POST Execute Wipe ───────────────────────────────────
  app.post('/api/servers/:id/dangerzone/wipe', authForServer('server.rebuild'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { preset: presetId, confirmName } = req.body;
    if (!presetId) return res.status(400).json({ error: 'Preset ID required' });
    if (!confirmName || confirmName !== srv.name) {
      return res.status(400).json({ error: 'Server name confirmation does not match' });
    }

    if (isDangerzoneActive(srv.id)) {
      return res.status(409).json({ error: 'A dangerzone operation is already in progress' });
    }

    const installDir = path.resolve(srv.installDir);
    const missionFolder = detectMissionFolder(installDir);
    const presets = getWipePresets(installDir, missionFolder);
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return res.status(400).json({ error: 'Invalid preset ID' });

    addAudit(req.user.id, req.user.username, 'server.wipe', `Starting ${preset.name} on ${srv.name}`);
    setDangerzoneActive(srv.id, true);
    ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'starting', message: `Starting ${preset.name}...`, preset: presetId });
    res.json({ message: `${preset.name} initiated` });

    // Run async
    try {
      await stopServerIfRunning(srv.id, srv);
      await createPreOpBackup(srv.id);

      ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'wiping', message: `Wiping: ${preset.name}...` });

      // Delete preset paths
      let deletedCount = 0;
      for (const relPath of preset.paths) {
        const fullPath = safePath(installDir, relPath);
        if (fullPath && fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          deletedCount++;
          logger.info({ serverId: srv.id, path: relPath }, 'Dangerzone: deleted path');
        }
      }

      // For player or full wipe, also delete .ADM files
      if (preset.scanForFiles || preset.includePlayerFiles) {
        const scanDirs = getScanDirs(srv);
        for (const dir of scanDirs) {
          try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
              if (/\.ADM$/i.test(file)) {
                const fp = safePath(dir, file);
                if (fp && fs.existsSync(fp)) {
                  fs.unlinkSync(fp);
                  deletedCount++;
                }
              }
            }
          } catch { /* skip */ }
        }
      }

      ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'complete', message: `${preset.name} complete! ${deletedCount} item(s) removed.` });
      addLog(srv.id, 'info', 'dangerzone', `${preset.name} completed by ${req.user.username}`);
      addNotification(srv.id, 'server.wipe', 'Server Wiped', `${srv.name}: ${preset.name} completed`, 'danger');
      addAudit(req.user.id, req.user.username, 'server.wipe', `Completed ${preset.name} on ${srv.name} (${deletedCount} items removed)`);
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Dangerzone: wipe failed');
      ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'error', message: `Wipe failed: ${err.message}` });
      addAudit(req.user.id, req.user.username, 'server.wipe', `Wipe failed on ${srv.name}: ${err.message}`);
    } finally {
      setDangerzoneActive(srv.id, false);
    }
  });

  // ── GET Log Storage Scan ────────────────────────────────
  app.get('/api/servers/:id/dangerzone/logs-scan', authForServer('server.rebuild'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const scanDirs = getScanDirs(srv);
    const categories = [
      { id: 'rpt', name: 'RPT Logs', pattern: /\.RPT$/i, files: [], sizeBytes: 0 },
      { id: 'adm', name: 'ADM Logs', pattern: /\.ADM$/i, files: [], sizeBytes: 0 },
      { id: 'script', name: 'Script Logs', pattern: /^script.*\.log$/i, files: [], sizeBytes: 0 },
      { id: 'crash', name: 'Crash Dumps', pattern: /\.(mdmp|dmp)$/i, files: [], sizeBytes: 0 },
      { id: 'battleye', name: 'BattlEye Logs', pattern: /\.log$/i, subdir: 'BattlEye', files: [], sizeBytes: 0 },
    ];

    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) continue;

      // Scan top-level files
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fp = path.join(dir, file);
          let stat;
          try { stat = fs.statSync(fp); } catch { continue; }
          if (!stat.isFile()) continue;

          for (const cat of categories) {
            if (cat.subdir) continue; // handled separately
            if (cat.pattern.test(file)) {
              cat.files.push({ name: file, dir, size: stat.size, modified: stat.mtime.toISOString() });
              cat.sizeBytes += stat.size;
              break;
            }
          }
        }
      } catch { /* skip */ }

      // Scan BattlEye subdirectory
      const beDir = path.join(dir, 'BattlEye');
      if (fs.existsSync(beDir)) {
        try {
          const files = fs.readdirSync(beDir);
          const beCat = categories.find(c => c.id === 'battleye');
          for (const file of files) {
            if (!beCat.pattern.test(file)) continue;
            const fp = path.join(beDir, file);
            let stat;
            try { stat = fs.statSync(fp); } catch { continue; }
            if (!stat.isFile()) continue;
            beCat.files.push({ name: file, dir: beDir, size: stat.size, modified: stat.mtime.toISOString() });
            beCat.sizeBytes += stat.size;
          }
        } catch { /* skip */ }
      }
    }

    const totalSizeBytes = categories.reduce((sum, c) => sum + c.sizeBytes, 0);

    res.json({
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        fileCount: c.files.length,
        sizeBytes: c.sizeBytes,
        sizeFormatted: formatBytes(c.sizeBytes),
        files: c.files.map(f => ({ name: f.name, size: f.size, modified: f.modified })),
      })),
      totalSizeBytes,
      totalSizeFormatted: formatBytes(totalSizeBytes),
    });
  });

  // ── POST Clear Logs ─────────────────────────────────────
  app.post('/api/servers/:id/dangerzone/clear-logs', authForServer('server.rebuild'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { categories: selectedIds } = req.body;
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
      return res.status(400).json({ error: 'At least one category must be selected' });
    }

    const validIds = ['rpt', 'adm', 'script', 'crash', 'battleye'];
    for (const id of selectedIds) {
      if (!validIds.includes(id)) return res.status(400).json({ error: `Invalid category: ${id}` });
    }

    const scanDirs = getScanDirs(srv);
    const categoryDefs = [
      { id: 'rpt', pattern: /\.RPT$/i },
      { id: 'adm', pattern: /\.ADM$/i },
      { id: 'script', pattern: /^script.*\.log$/i },
      { id: 'crash', pattern: /\.(mdmp|dmp)$/i },
      { id: 'battleye', pattern: /\.log$/i, subdir: 'BattlEye' },
    ];

    let deletedCount = 0;
    let freedBytes = 0;

    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) continue;

      for (const cat of categoryDefs) {
        if (!selectedIds.includes(cat.id)) continue;

        const targetDir = cat.subdir ? path.join(dir, cat.subdir) : dir;
        if (!fs.existsSync(targetDir)) continue;

        try {
          const files = fs.readdirSync(targetDir);
          for (const file of files) {
            if (!cat.pattern.test(file)) continue;
            const fp = safePath(targetDir, file);
            if (!fp) continue;
            try {
              const stat = fs.statSync(fp);
              if (!stat.isFile()) continue;
              fs.unlinkSync(fp);
              deletedCount++;
              freedBytes += stat.size;
            } catch { /* skip locked files */ }
          }
        } catch { /* skip */ }
      }
    }

    addAudit(req.user.id, req.user.username, 'server.clear-logs', `Cleared ${deletedCount} log files from ${srv.name} (${formatBytes(freedBytes)} freed)`);
    addLog(srv.id, 'info', 'dangerzone', `Log cleanup: ${deletedCount} files removed (${formatBytes(freedBytes)})`);

    res.json({
      message: `Cleared ${deletedCount} files`,
      deletedCount,
      freedBytes,
      freedFormatted: formatBytes(freedBytes),
    });
  });

  // ── POST Replicate Preview ──────────────────────────────
  app.post('/api/servers/:id/dangerzone/replicate-preview', authForServer('server.rebuild'), (req, res) => {
    const targetSrv = ctx.servers.find(s => s.id === req.params.id);
    if (!targetSrv) return res.status(404).json({ error: 'Target server not found' });

    const { sourceServerId, components } = req.body;
    if (!sourceServerId) return res.status(400).json({ error: 'Source server ID required' });
    if (!Array.isArray(components) || components.length === 0) {
      return res.status(400).json({ error: 'At least one component must be selected' });
    }

    const sourceSrv = ctx.servers.find(s => s.id === sourceServerId);
    if (!sourceSrv) return res.status(404).json({ error: 'Source server not found' });
    if (sourceSrv.id === targetSrv.id) return res.status(400).json({ error: 'Source and target cannot be the same server' });

    const srcDir = path.resolve(sourceSrv.installDir);
    const destDir = path.resolve(targetSrv.installDir);
    if (!fs.existsSync(srcDir)) return res.status(400).json({ error: 'Source install directory not found' });

    const srcMission = detectMissionFolder(srcDir);
    const destMission = detectMissionFolder(destDir);

    const validComponents = ['config', 'mpmissions', 'mods', 'profiles'];
    const preview = [];

    for (const compId of components) {
      if (!validComponents.includes(compId)) continue;

      const comp = { id: compId, sourceExists: false, targetExists: false, sizeBytes: 0, sizeFormatted: '0 B', willOverwrite: false, details: '' };

      switch (compId) {
        case 'config': {
          const srcCfg = path.join(srcDir, 'serverDZ.cfg');
          const destCfg = path.join(destDir, 'serverDZ.cfg');
          comp.name = 'Server Configuration';
          comp.sourceExists = fs.existsSync(srcCfg);
          comp.targetExists = fs.existsSync(destCfg);
          comp.willOverwrite = comp.targetExists;
          if (comp.sourceExists) {
            try { comp.sizeBytes = fs.statSync(srcCfg).size; } catch { /* skip */ }
          }
          comp.sizeFormatted = formatBytes(comp.sizeBytes);
          comp.details = 'serverDZ.cfg (hostname will be preserved on target)';
          break;
        }
        case 'mpmissions': {
          comp.name = 'Mission Files (CE XMLs)';
          if (srcMission) {
            const srcMpDir = path.join(srcDir, 'mpmissions', srcMission);
            comp.sourceExists = fs.existsSync(srcMpDir);
            if (comp.sourceExists) {
              // Calculate size excluding storage_1
              let size = 0;
              try {
                const entries = fs.readdirSync(srcMpDir, { withFileTypes: true });
                for (const entry of entries) {
                  if (entry.name === 'storage_1') continue;
                  const fp = path.join(srcMpDir, entry.name);
                  size += entry.isDirectory() ? getDirSize(fp) : ((() => { try { return fs.statSync(fp).size; } catch { return 0; } })());
                }
              } catch { /* skip */ }
              comp.sizeBytes = size;
            }
          }
          if (destMission) {
            comp.targetExists = fs.existsSync(path.join(destDir, 'mpmissions', destMission));
            comp.willOverwrite = comp.targetExists;
          }
          comp.sizeFormatted = formatBytes(comp.sizeBytes);
          comp.details = `Mission folder${srcMission ? ` (${srcMission})` : ''} — excludes storage_1/ persistence`;
          break;
        }
        case 'mods': {
          comp.name = 'Mods & Keys';
          let modCount = 0;
          let totalSize = 0;
          try {
            const entries = fs.readdirSync(srcDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory() && entry.name.startsWith('@')) {
                modCount++;
                totalSize += getDirSize(path.join(srcDir, entry.name));
              }
            }
          } catch { /* skip */ }
          comp.sourceExists = modCount > 0;
          comp.sizeBytes = totalSize;
          comp.sizeFormatted = formatBytes(totalSize);

          // Check target mods
          let targetModCount = 0;
          try {
            const entries = fs.readdirSync(destDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory() && entry.name.startsWith('@')) targetModCount++;
            }
          } catch { /* skip */ }
          comp.targetExists = targetModCount > 0;
          comp.willOverwrite = comp.targetExists;
          comp.details = `${modCount} mod(s) from source` + (targetModCount > 0 ? ` — target has ${targetModCount} mod(s) that will be replaced` : '');
          break;
        }
        case 'profiles': {
          comp.name = 'Profile Configuration';
          const srcProfile = sourceSrv.profileDir ? path.resolve(sourceSrv.profileDir) : path.join(srcDir, 'profiles');
          comp.sourceExists = fs.existsSync(srcProfile);
          if (comp.sourceExists) {
            // Size excluding logs
            let size = 0;
            try {
              const entries = fs.readdirSync(srcProfile, { withFileTypes: true });
              for (const entry of entries) {
                if (/\.(RPT|ADM|log|mdmp|dmp)$/i.test(entry.name)) continue;
                const fp = path.join(srcProfile, entry.name);
                size += entry.isDirectory() ? getDirSize(fp) : ((() => { try { return fs.statSync(fp).size; } catch { return 0; } })());
              }
            } catch { /* skip */ }
            comp.sizeBytes = size;
          }
          const destProfile = targetSrv.profileDir ? path.resolve(targetSrv.profileDir) : path.join(destDir, 'profiles');
          comp.targetExists = fs.existsSync(destProfile);
          comp.willOverwrite = comp.targetExists;
          comp.sizeFormatted = formatBytes(comp.sizeBytes);
          comp.details = 'BattlEye config, ban lists, etc. (excludes log files)';
          break;
        }
      }

      preview.push(comp);
    }

    const totalSizeBytes = preview.reduce((sum, c) => sum + c.sizeBytes, 0);

    res.json({
      sourceServer: { id: sourceSrv.id, name: sourceSrv.name },
      targetServer: { id: targetSrv.id, name: targetSrv.name },
      components: preview,
      totalSizeBytes,
      totalSizeFormatted: formatBytes(totalSizeBytes),
    });
  });

  // ── POST Execute Replicate ──────────────────────────────
  app.post('/api/servers/:id/dangerzone/replicate', authForServer('server.rebuild'), async (req, res) => {
    const targetSrv = ctx.servers.find(s => s.id === req.params.id);
    if (!targetSrv) return res.status(404).json({ error: 'Target server not found' });

    const { sourceServerId, components, confirmName } = req.body;
    if (!sourceServerId) return res.status(400).json({ error: 'Source server ID required' });
    if (!confirmName || confirmName !== targetSrv.name) {
      return res.status(400).json({ error: 'Server name confirmation does not match' });
    }
    if (!Array.isArray(components) || components.length === 0) {
      return res.status(400).json({ error: 'At least one component must be selected' });
    }

    const sourceSrv = ctx.servers.find(s => s.id === sourceServerId);
    if (!sourceSrv) return res.status(404).json({ error: 'Source server not found' });
    if (sourceSrv.id === targetSrv.id) return res.status(400).json({ error: 'Source and target cannot be the same server' });

    if (isDangerzoneActive(targetSrv.id)) {
      return res.status(409).json({ error: 'A dangerzone operation is already in progress' });
    }

    const srcDir = path.resolve(sourceSrv.installDir);
    const destDir = path.resolve(targetSrv.installDir);

    addAudit(req.user.id, req.user.username, 'server.replicate', `Replicating ${components.join(', ')} from ${sourceSrv.name} to ${targetSrv.name}`);
    setDangerzoneActive(targetSrv.id, true);
    ctx.io.emit('dangerzoneProgress', { serverId: targetSrv.id, status: 'starting', message: `Starting replication from ${sourceSrv.name}...` });
    res.json({ message: 'Replication initiated' });

    try {
      await stopServerIfRunning(targetSrv.id, targetSrv);
      await createPreOpBackup(targetSrv.id);

      const srcMission = detectMissionFolder(srcDir);
      const destMission = detectMissionFolder(destDir);
      let copiedCount = 0;

      for (const compId of components) {
        ctx.io.emit('dangerzoneProgress', { serverId: targetSrv.id, status: 'replicating', message: `Copying ${compId}...` });

        switch (compId) {
          case 'config': {
            const srcCfg = path.join(srcDir, 'serverDZ.cfg');
            const destCfg = path.join(destDir, 'serverDZ.cfg');
            if (fs.existsSync(srcCfg)) {
              // Read source config, preserve target hostname
              let content = fs.readFileSync(srcCfg, 'utf8');
              content = content.replace(
                /^(\s*hostname\s*=\s*).+?(;.*$)/m,
                `$1"${targetSrv.name}"$2`
              );
              fs.writeFileSync(destCfg, content, 'utf8');
              copiedCount++;
            }
            break;
          }
          case 'mpmissions': {
            if (srcMission) {
              const srcMpDir = path.join(srcDir, 'mpmissions', srcMission);
              const destMpBase = path.join(destDir, 'mpmissions');
              const destMpDir = path.join(destMpBase, destMission || srcMission);

              if (fs.existsSync(srcMpDir)) {
                // Ensure destination mpmissions exists
                if (!fs.existsSync(destMpBase)) fs.mkdirSync(destMpBase, { recursive: true });

                // Copy everything except storage_1
                const entries = fs.readdirSync(srcMpDir, { withFileTypes: true });
                if (!fs.existsSync(destMpDir)) fs.mkdirSync(destMpDir, { recursive: true });

                for (const entry of entries) {
                  if (entry.name === 'storage_1') continue;
                  const srcPath = path.join(srcMpDir, entry.name);
                  const destPath = path.join(destMpDir, entry.name);
                  if (entry.isDirectory()) {
                    if (fs.existsSync(destPath)) fs.rmSync(destPath, { recursive: true, force: true });
                    copyDirSync(srcPath, destPath);
                  } else {
                    fs.copyFileSync(srcPath, destPath);
                  }
                  copiedCount++;
                }
              }
            }
            break;
          }
          case 'mods': {
            // Remove existing @-mods from target
            try {
              const destEntries = fs.readdirSync(destDir, { withFileTypes: true });
              for (const entry of destEntries) {
                if (entry.isDirectory() && entry.name.startsWith('@')) {
                  fs.rmSync(path.join(destDir, entry.name), { recursive: true, force: true });
                }
              }
            } catch { /* skip */ }

            // Copy @-mods from source
            try {
              const srcEntries = fs.readdirSync(srcDir, { withFileTypes: true });
              for (const entry of srcEntries) {
                if (entry.isDirectory() && entry.name.startsWith('@')) {
                  copyDirSync(path.join(srcDir, entry.name), path.join(destDir, entry.name));
                  copiedCount++;
                }
              }
            } catch { /* skip */ }

            // Copy keys
            const srcKeys = path.join(srcDir, 'keys');
            const destKeys = path.join(destDir, 'keys');
            if (fs.existsSync(srcKeys)) {
              if (!fs.existsSync(destKeys)) fs.mkdirSync(destKeys, { recursive: true });
              try {
                const keyFiles = fs.readdirSync(srcKeys);
                for (const kf of keyFiles) {
                  if (kf.endsWith('.bikey')) {
                    fs.copyFileSync(path.join(srcKeys, kf), path.join(destKeys, kf));
                  }
                }
              } catch { /* skip */ }
            }
            break;
          }
          case 'profiles': {
            const srcProfile = sourceSrv.profileDir ? path.resolve(sourceSrv.profileDir) : path.join(srcDir, 'profiles');
            const destProfile = targetSrv.profileDir ? path.resolve(targetSrv.profileDir) : path.join(destDir, 'profiles');
            if (fs.existsSync(srcProfile)) {
              if (!fs.existsSync(destProfile)) fs.mkdirSync(destProfile, { recursive: true });
              const entries = fs.readdirSync(srcProfile, { withFileTypes: true });
              for (const entry of entries) {
                // Skip log files
                if (/\.(RPT|ADM|log|mdmp|dmp)$/i.test(entry.name)) continue;
                const srcPath = path.join(srcProfile, entry.name);
                const destPath = path.join(destProfile, entry.name);
                if (entry.isDirectory()) {
                  if (fs.existsSync(destPath)) fs.rmSync(destPath, { recursive: true, force: true });
                  copyDirSync(srcPath, destPath);
                } else {
                  fs.copyFileSync(srcPath, destPath);
                }
                copiedCount++;
              }
            }
            break;
          }
        }
      }

      ctx.io.emit('dangerzoneProgress', { serverId: targetSrv.id, status: 'complete', message: `Replication complete! ${copiedCount} item(s) copied from ${sourceSrv.name}.` });
      addLog(targetSrv.id, 'info', 'dangerzone', `Replicated ${components.join(', ')} from ${sourceSrv.name}`);
      addNotification(targetSrv.id, 'server.replicate', 'Server Replicated', `${targetSrv.name}: copied ${components.join(', ')} from ${sourceSrv.name}`, 'info');
      addAudit(req.user.id, req.user.username, 'server.replicate', `Completed replication to ${targetSrv.name} (${copiedCount} items)`);
    } catch (err) {
      logger.error({ err, serverId: targetSrv.id }, 'Dangerzone: replicate failed');
      ctx.io.emit('dangerzoneProgress', { serverId: targetSrv.id, status: 'error', message: `Replication failed: ${err.message}` });
      addAudit(req.user.id, req.user.username, 'server.replicate', `Replication failed on ${targetSrv.name}: ${err.message}`);
    } finally {
      setDangerzoneActive(targetSrv.id, false);
    }
  });
};
