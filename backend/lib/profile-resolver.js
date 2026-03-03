/**
 * DayZ profile directory and RPT file resolution.
 * Centralizes the logic for finding RPT files across common DayZ server layouts.
 *
 * Search order:
 * 1. Explicit `server.profileDir` setting
 * 2. `-profiles=` or `-profile=` parsed from `server.launchParams`
 * 3. Common subdirectories: profiles/, profile/, logs/
 * 4. Server install directory root
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Parse the -profiles= or -profile= parameter from DayZ launch arguments.
 * Returns the resolved absolute path or null.
 */
function parseProfilesFromLaunchParams(launchParams, installDir) {
  if (!launchParams) return null;
  // Match: -profiles=SomePath  or  -profile=SomePath  (with or without quotes)
  const match = launchParams.match(/-profiles?=["']?([^"'\s]+)["']?/i);
  if (!match) return null;
  const raw = match[1];
  // Could be relative (e.g. "profiles") or absolute (e.g. "C:\DayZServer\profiles")
  if (path.isAbsolute(raw)) return raw;
  if (installDir) return path.join(installDir, raw);
  return raw;
}

/**
 * Resolve the most likely profile directory for a server.
 * Returns the directory path that contains RPT files, or the best-guess directory.
 */
function resolveProfileDir(server) {
  const installDir = server.installDir;
  const candidates = [];

  // 1. Explicit profileDir setting
  if (server.profileDir && server.profileDir.trim()) {
    const explicit = path.isAbsolute(server.profileDir)
      ? server.profileDir
      : path.join(installDir || '', server.profileDir);
    candidates.push(explicit);
  }

  // 2. Parse from launch params
  const fromParams = parseProfilesFromLaunchParams(server.launchParams, installDir);
  if (fromParams) candidates.push(fromParams);

  // 3. Common DayZ server profile subdirectories
  if (installDir) {
    candidates.push(
      path.join(installDir, 'profiles'),
      path.join(installDir, 'profile'),
      path.join(installDir, 'logs'),
      installDir, // 4. Root install directory
    );
  }

  // Return the first directory that exists and contains RPT files
  for (const dir of candidates) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      const hasRPT = fs.readdirSync(dir).some(f => f.toLowerCase().endsWith('.rpt'));
      if (hasRPT) return dir;
    } catch { /* permission error or similar */ }
  }

  // No RPT files found in any candidate — return best-guess directory
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }

  return installDir || null;
}

/**
 * Find RPT files for a server, sorted by modification time (newest first).
 * Returns array of { name, fullPath, mtime }.
 */
function findRPTFiles(server) {
  const installDir = server.installDir;
  const candidates = [];

  // Build candidate directories in priority order
  if (server.profileDir && server.profileDir.trim()) {
    const explicit = path.isAbsolute(server.profileDir)
      ? server.profileDir
      : path.join(installDir || '', server.profileDir);
    candidates.push(explicit);
  }
  const fromParams = parseProfilesFromLaunchParams(server.launchParams, installDir);
  if (fromParams) candidates.push(fromParams);
  if (installDir) {
    candidates.push(
      path.join(installDir, 'profiles'),
      path.join(installDir, 'profile'),
      path.join(installDir, 'logs'),
      installDir,
    );
  }

  // Search each candidate for RPT files, return from first directory that has them
  for (const dir of candidates) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      const rptFiles = fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.rpt'))
        .map(f => {
          const fullPath = path.join(dir, f);
          return { name: f, fullPath, mtime: fs.statSync(fullPath).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      if (rptFiles.length > 0) {
        logger.debug({ dir, count: rptFiles.length, serverId: server.id }, 'Found RPT files');
        return rptFiles;
      }
    } catch { /* ignore */ }
  }

  return [];
}

module.exports = { resolveProfileDir, findRPTFiles, parseProfilesFromLaunchParams };
