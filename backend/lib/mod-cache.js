/**
 * Global Mod Cache — shared cache directory for workshop mods.
 * Avoids re-downloading mods that are already cached when installing to multiple servers.
 *
 * Features:
 * - TTL-based expiration (default 30 minutes)
 * - LRU eviction when cache exceeds size limit (default 10GB)
 * - Disk space monitoring
 * - Persistent cache with TTL tracking
 *
 * Default cache dir: C:\Citadel\cache\mods\
 * Layout: <cacheDir>/<workshopId>/  (copy of workshop content)
 *         <cacheDir>/<workshopId>.json  (metadata: name, workshopId, cachedAt, time_updated, size)
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { copyDirSync, getDirSize, formatBytes } = require('./helpers');

const DEFAULT_CACHE_DIR = 'C:\\Citadel\\cache\\mods';

// Cache configuration (in milliseconds and bytes)
const CACHE_CONFIG = {
  ttlMs: 30 * 60 * 1000,           // 30 minutes default TTL
  maxSizeBytes: 10 * 1024 * 1024 * 1024, // 10 GB max cache size
  lowDiskThresholdBytes: 5 * 1024 * 1024 * 1024, // 5 GB free disk space warning threshold
  maxEntries: 500,                  // LRU: evict if exceeds 500 entries
};

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
 * Get available disk space (bytes) on the drive containing cacheDir.
 * Returns null if unable to determine.
 */
function getAvailableDiskSpace() {
  try {
    // Node.js 18.17+ has fs.statfs
    if (fs.statfsSync) {
      const stats = fs.statfsSync(getCacheDir());
      return stats.bavail * stats.bsize;
    }
  } catch (err) {
    logger.debug({ err }, 'Failed to get disk space stats');
  }
  return null;
}

/**
 * Check if a cache entry is expired based on TTL.
 * Compares cached `cachedAt` with current time.
 */
function isCacheExpired(metadata, ttlMs = CACHE_CONFIG.ttlMs) {
  if (!metadata || !metadata.cachedAt) return true;
  const cachedTime = new Date(metadata.cachedAt).getTime();
  const ageMs = Date.now() - cachedTime;
  return ageMs > ttlMs;
}

/**
 * Compare cached mod's time_updated with Steam API response.
 * Returns true if the mod should be invalidated (Steam version is newer).
 */
function shouldInvalidateByUpdateTime(cachedMeta, steamTimeUpdated) {
  if (!cachedMeta || !steamTimeUpdated) return false;
  const cachedTime = cachedMeta.time_updated || 0;
  return Number(steamTimeUpdated) > Number(cachedTime);
}

/**
 * Evict oldest (least recently used) cache entries until cache is under limit.
 * Uses cachedAt timestamp to determine age.
 */
function evictOldestEntries() {
  try {
    const dir = getCacheDir();
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const metaFile = path.join(dir, `${e.name}.json`);
        let cachedAt = new Date(0); // very old default
        try {
          const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          if (meta.cachedAt) cachedAt = new Date(meta.cachedAt);
        } catch { /* use default */ }
        return { name: e.name, cachedAt };
      })
      .sort((a, b) => a.cachedAt.getTime() - b.cachedAt.getTime()); // oldest first

    // Evict until under limit
    const maxEntries = CACHE_CONFIG.maxEntries;
    if (entries.length > maxEntries) {
      const toEvict = entries.slice(0, entries.length - maxEntries);
      for (const entry of toEvict) {
        const modDir = path.join(dir, entry.name);
        const metaFile = path.join(dir, `${entry.name}.json`);
        try {
          if (fs.existsSync(modDir)) fs.rmSync(modDir, { recursive: true, force: true });
          if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);
          logger.debug({ workshopId: entry.name }, 'Evicted cache entry (LRU)');
        } catch (err) {
          logger.warn({ err, workshopId: entry.name }, 'Failed to evict cache entry');
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to perform LRU eviction');
  }
}

/**
 * Check whether a workshop item is already cached and return its content path.
 * Validates TTL expiration and non-empty directory.
 * Returns the content directory path if cached and valid, otherwise null.
 *
 * @param {string} workshopId
 * @param {number} [steamTimeUpdated] - Optional Steam API time_updated value for comparison
 * @returns {string|null} Content directory path or null if not cached/expired
 */
function getCached(workshopId, steamTimeUpdated = null) {
  const contentDir = path.join(getCacheDir(), String(workshopId));
  const metaFile = path.join(getCacheDir(), `${workshopId}.json`);

  if (!fs.existsSync(contentDir) || !fs.existsSync(metaFile)) {
    return null;
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

    // Check TTL expiration
    if (isCacheExpired(meta)) {
      logger.info({ workshopId }, 'Mod cache expired (TTL)');
      // Clean up expired entry
      try {
        fs.rmSync(contentDir, { recursive: true, force: true });
        fs.unlinkSync(metaFile);
      } catch { /* best effort */ }
      return null;
    }

    // Check if Steam has a newer version
    if (steamTimeUpdated && shouldInvalidateByUpdateTime(meta, steamTimeUpdated)) {
      logger.info({ workshopId, cachedTime: meta.time_updated, steamTime: steamTimeUpdated }, 'Mod cache invalidated (newer version on Steam)');
      // Clean up outdated entry
      try {
        fs.rmSync(contentDir, { recursive: true, force: true });
        fs.unlinkSync(metaFile);
      } catch { /* best effort */ }
      return null;
    }

    // Check directory is not empty
    const entries = fs.readdirSync(contentDir);
    if (entries.length > 0) {
      logger.info({ workshopId }, 'Mod cache hit');
      return contentDir;
    }

    // Empty directory — clean up
    logger.warn({ workshopId }, 'Cache directory is empty, removing stale entry');
    try {
      fs.rmSync(contentDir, { recursive: true, force: true });
      fs.unlinkSync(metaFile);
    } catch { /* best effort */ }
    return null;
  } catch (err) {
    logger.debug({ err, workshopId }, 'Cache retrieval failed');
    return null;
  }
}

/**
 * Store a freshly downloaded workshop mod into the cache.
 * Checks disk space, evicts old entries if needed, copies content to cache.
 *
 * @param {string} workshopId   Steam Workshop item ID
 * @param {string} sourcePath   Path to the downloaded content
 * @param {string} modName      Human-readable mod name
 * @param {number} [timeUpdated] Optional Steam time_updated value
 * @returns {{ success: boolean, error?: string }}
 */
function storeInCache(workshopId, sourcePath, modName, timeUpdated = null) {
  try {
    const dir = getCacheDir();
    const destDir = path.join(dir, String(workshopId));

    // Check available disk space
    const availableBytes = getAvailableDiskSpace();
    if (availableBytes !== null && availableBytes < CACHE_CONFIG.lowDiskThresholdBytes) {
      logger.warn({ availableBytes: formatBytes(availableBytes), threshold: formatBytes(CACHE_CONFIG.lowDiskThresholdBytes) }, 'Low disk space warning');
    }

    // Remove stale cache entry if present
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }

    // Copy to cache
    copyDirSync(sourcePath, destDir);
    const size = getDirSize(destDir);

    // Check if adding this entry would exceed cache size limit
    const totalSize = getCacheStats().totalSize + size;
    if (totalSize > CACHE_CONFIG.maxSizeBytes) {
      logger.info({ currentSize: formatBytes(totalSize), limit: formatBytes(CACHE_CONFIG.maxSizeBytes) }, 'Cache size exceeded, evicting oldest entries');
      evictOldestEntries();
    }

    // Check entry count and evict if needed
    const stats = getCacheStats();
    if (stats.modCount >= CACHE_CONFIG.maxEntries) {
      evictOldestEntries();
    }

    const meta = {
      workshopId: String(workshopId),
      name: modName || '',
      cachedAt: new Date().toISOString(),
      time_updated: timeUpdated || null,
      size,
    };
    fs.writeFileSync(path.join(dir, `${workshopId}.json`), JSON.stringify(meta, null, 2));
    logger.info({ workshopId, modName, size: formatBytes(size) }, 'Stored mod in cache');
    return { success: true };
  } catch (err) {
    logger.warn({ err, workshopId }, 'Failed to store mod in cache');
    return { success: false, error: err.message };
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
 * Returns total size, mod count, and per-mod metadata with TTL info.
 */
function getCacheStats() {
  const dir = getCacheDir();
  let totalSize = 0;
  let modCount = 0;
  const mods = [];
  const now = Date.now();

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metaFile = path.join(dir, `${entry.name}.json`);
        let meta = { workshopId: entry.name, name: entry.name, cachedAt: null, size: 0, time_updated: null };
        if (fs.existsSync(metaFile)) {
          try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { /* use default */ }
        }
        const size = meta.size || getDirSize(path.join(dir, entry.name));
        totalSize += size;
        modCount++;

        const cachedAtTime = meta.cachedAt ? new Date(meta.cachedAt).getTime() : 0;
        const ageMs = now - cachedAtTime;
        const isExpired = ageMs > CACHE_CONFIG.ttlMs;

        mods.push({
          workshopId: meta.workshopId || entry.name,
          name: meta.name || entry.name,
          cachedAt: meta.cachedAt || null,
          time_updated: meta.time_updated || null,
          size,
          sizeFormatted: formatBytes(size),
          ageMs,
          isExpired,
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
    ttlMs: CACHE_CONFIG.ttlMs,
    maxSizeBytes: CACHE_CONFIG.maxSizeBytes,
    maxSizeFormatted: formatBytes(CACHE_CONFIG.maxSizeBytes),
    maxEntries: CACHE_CONFIG.maxEntries,
    availableDiskBytes: getAvailableDiskSpace(),
  };
}

/**
 * Manually clear the entire mod cache.
 * Useful for explicit admin cache flush or update checks.
 *
 * @returns {{ success: boolean, removed: number, freedBytes: number, error?: string }}
 */
function clearCache() {
  const stats = cleanCache();
  return { success: true, ...stats };
}

/**
 * Force invalidation of a specific cache entry (ignoring TTL).
 * Useful when user manually triggers "check for updates".
 *
 * @param {string} workshopId
 * @returns {{ success: boolean, error?: string }}
 */
function invalidateCacheEntry(workshopId) {
  try {
    const dir = getCacheDir();
    const contentDir = path.join(dir, String(workshopId));
    const metaFile = path.join(dir, `${workshopId}.json`);

    let removed = false;
    if (fs.existsSync(contentDir)) {
      fs.rmSync(contentDir, { recursive: true, force: true });
      removed = true;
    }
    if (fs.existsSync(metaFile)) {
      fs.unlinkSync(metaFile);
      removed = true;
    }

    if (removed) {
      logger.info({ workshopId }, 'Cache entry invalidated manually');
      return { success: true };
    }
    return { success: true }; // Already gone
  } catch (err) {
    logger.warn({ err, workshopId }, 'Failed to invalidate cache entry');
    return { success: false, error: err.message };
  }
}

module.exports = {
  initCache,
  getCacheDir,
  getCached,
  storeInCache,
  cleanCache,
  clearCache,
  getCacheStats,
  invalidateCacheEntry,
  getAvailableDiskSpace,
};
