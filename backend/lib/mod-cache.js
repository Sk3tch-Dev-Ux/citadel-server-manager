/**
 * Global Mod Cache — shared cache directory for workshop mods.
 * Avoids re-downloading mods that are already cached when installing to multiple servers.
 *
 * Default cache dir: C:\Citadel\cache\mods\
 * Layout: <cacheDir>/<workshopId>/  (copy of workshop content)
 *         <cacheDir>/<workshopId>.json  (metadata: name, workshopId, cachedAt, size)
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { copyDirSync, getDirSize, formatBytes } = require('./helpers');

const DEFAULT_CACHE_DIR = 'C:\\Citadel\\cache\\mods';

let cacheDir = DEFAULT_CACHE_DIR;

/**
 * Initialise the cache directory (creates it if it doesn't exist).
 * Optionally override the default path via `dir` argument.
 */
function initCache(dir) {
  if (dir) cacheDir = dir;
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    logger.info({ cacheDir }, 'Created mod cache directory');
  }
}

/**
 * Return the cache directory path (ensures it exists).
 */
function getCacheDir() {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

/**
 * Check whether a workshop item is already cached and return its content path.
 * Returns the content directory path if cached, otherwise null.
 */
function getCached(workshopId) {
  const contentDir = path.join(getCacheDir(), String(workshopId));
  const metaFile = path.join(getCacheDir(), `${workshopId}.json`);
  if (fs.existsSync(contentDir) && fs.existsSync(metaFile)) {
    try {
      const entries = fs.readdirSync(contentDir);
      if (entries.length > 0) {
        logger.info({ workshopId }, 'Mod cache hit');
        return contentDir;
      }
    } catch (err) {
      logger.debug({ err, workshopId }, 'Cache check failed');
    }
  }
  return null;
}

/**
 * Store a freshly downloaded workshop mod into the cache.
 * Copies the entire content directory into the cache.
 *
 * @param {string} workshopId   Steam Workshop item ID
 * @param {string} sourcePath   Path to the downloaded content
 * @param {string} modName      Human-readable mod name
 */
function storeInCache(workshopId, sourcePath, modName) {
  try {
    const dir = getCacheDir();
    const destDir = path.join(dir, String(workshopId));
    // Remove stale cache entry if present
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    copyDirSync(sourcePath, destDir);
    const size = getDirSize(destDir);
    const meta = {
      workshopId: String(workshopId),
      name: modName || '',
      cachedAt: new Date().toISOString(),
      size,
    };
    fs.writeFileSync(path.join(dir, `${workshopId}.json`), JSON.stringify(meta, null, 2));
    logger.info({ workshopId, modName, size: formatBytes(size) }, 'Stored mod in cache');
  } catch (err) {
    logger.warn({ err, workshopId }, 'Failed to store mod in cache');
  }
}

/**
 * Remove all cached mods to free disk space.
 * Returns the number of entries removed and bytes freed.
 */
function cleanCache() {
  const dir = getCacheDir();
  let removed = 0;
  let freedBytes = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          freedBytes += getDirSize(fullPath);
          fs.rmSync(fullPath, { recursive: true, force: true });
          removed++;
        } else if (entry.name.endsWith('.json')) {
          const stat = fs.statSync(fullPath);
          freedBytes += stat.size;
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        logger.warn({ err, entry: entry.name }, 'Failed to clean cache entry');
      }
    }
    logger.info({ removed, freed: formatBytes(freedBytes) }, 'Mod cache cleaned');
  } catch (err) {
    logger.warn({ err }, 'Failed to clean mod cache');
  }
  return { removed, freedBytes, freedFormatted: formatBytes(freedBytes) };
}

/**
 * Collect cache statistics.
 * Returns total size, mod count, and per-mod metadata.
 */
function getCacheStats() {
  const dir = getCacheDir();
  let totalSize = 0;
  let modCount = 0;
  const mods = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metaFile = path.join(dir, `${entry.name}.json`);
        let meta = { workshopId: entry.name, name: entry.name, cachedAt: null, size: 0 };
        if (fs.existsSync(metaFile)) {
          try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { /* use default */ }
        }
        const size = meta.size || getDirSize(path.join(dir, entry.name));
        totalSize += size;
        modCount++;
        mods.push({
          workshopId: meta.workshopId || entry.name,
          name: meta.name || entry.name,
          cachedAt: meta.cachedAt || null,
          size,
          sizeFormatted: formatBytes(size),
        });
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Failed to collect cache stats');
  }
  return {
    cacheDir: dir,
    totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    modCount,
    mods,
  };
}

module.exports = { initCache, getCacheDir, getCached, storeInCache, cleanCache, getCacheStats };
