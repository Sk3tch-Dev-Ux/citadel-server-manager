/**
 * Persistent JSON data store with async debounced writes.
 * - loadJSON: synchronous (used only at startup)
 * - saveJSON: async with 1-second debounce + atomic write (write-to-temp + rename)
 * - flushAll: synchronous flush for graceful shutdown
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const pendingWrites = new Map(); // filename -> { timeout, data, filePath }
const DEBOUNCE_MS = 1000;

function loadJSON(dataDir, filename, defaultVal) {
  const p = path.join(dataDir, filename);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    logger.error({ err, file: filename }, 'Failed to load JSON data file');
  }
  return typeof defaultVal === 'function' ? defaultVal() : defaultVal;
}

function saveJSON(dataDir, filename, data) {
  const filePath = path.join(dataDir, filename);

  if (pendingWrites.has(filename)) {
    clearTimeout(pendingWrites.get(filename).timeout);
  }

  const timeout = setTimeout(async () => {
    pendingWrites.delete(filename);
    const tmpPath = filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');
    try {
      await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2));
      await fsp.rename(tmpPath, filePath);  // atomic on same filesystem
    } catch (err) {
      logger.error({ err, file: filename }, 'Failed to save JSON data file');
      try { await fsp.unlink(tmpPath); } catch { /* cleanup best effort */ }
    }
  }, DEBOUNCE_MS);

  pendingWrites.set(filename, { timeout, data, filePath });
}

/**
 * Synchronously flush all pending writes to disk.
 * Called during graceful shutdown to prevent data loss.
 */
function flushAll() {
  for (const [filename, entry] of pendingWrites) {
    clearTimeout(entry.timeout);
    try {
      fs.writeFileSync(entry.filePath, JSON.stringify(entry.data, null, 2));
      logger.info({ file: filename }, 'Flushed pending write on shutdown');
    } catch (err) {
      logger.error({ err, file: filename }, 'Failed to flush pending write on shutdown');
    }
  }
  pendingWrites.clear();
}

module.exports = { loadJSON, saveJSON, flushAll };
