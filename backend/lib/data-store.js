/**
 * Persistent JSON data store with async write queue.
 * - loadJSON: synchronous (used only at startup)
 * - saveJSON: queues writes with debounce; writes latest state when timer fires
 * - flushAll: synchronous flush for graceful shutdown (forces all queued writes)
 *
 * Ensures no data loss between debounce invocations by:
 *   - Collecting all pending writes for the same file
 *   - Writing the latest state when debounce timer fires
 *   - Serializing writes (no concurrent writes to same file)
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const pendingWrites = new Map(); // filename -> { timeout, data, filePath }
const writeQueue = new Map(); // filename -> [{ data, timestamp }]
const DEBOUNCE_MS = 1000;
const activeWrites = new Set(); // Prevent concurrent writes to same file

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

  // Add this write to the queue for this file
  if (!writeQueue.has(filename)) {
    writeQueue.set(filename, []);
  }
  writeQueue.get(filename).push({ data, timestamp: Date.now() });

  // Clear existing debounce timeout if any
  if (pendingWrites.has(filename)) {
    clearTimeout(pendingWrites.get(filename).timeout);
  }

  // Set new debounce timeout — will write the latest state
  const timeout = setTimeout(async () => {
    pendingWrites.delete(filename);

    // Get the latest data from the queue
    const queue = writeQueue.get(filename);
    if (!queue || queue.length === 0) return;

    // Use the most recent data
    const latestWrite = queue[queue.length - 1];
    const latestData = latestWrite.data;
    writeQueue.delete(filename);

    // Serialize writes: wait if another write is in progress for this file
    while (activeWrites.has(filename)) {
      await new Promise(r => setTimeout(r, 10));
    }

    activeWrites.add(filename);
    const tmpPath = filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');

    try {
      await fsp.writeFile(tmpPath, JSON.stringify(latestData, null, 2));
      await fsp.rename(tmpPath, filePath); // atomic on same filesystem
      logger.debug({ file: filename }, 'JSON data file written');
    } catch (err) {
      logger.error({ err, file: filename }, 'Failed to save JSON data file');
      try {
        await fsp.unlink(tmpPath);
      } catch {
        /* cleanup best effort */
      }
    } finally {
      activeWrites.delete(filename);
    }
  }, DEBOUNCE_MS);

  pendingWrites.set(filename, { timeout, data, filePath });
}

/**
 * Synchronously flush all pending writes to disk.
 * Called during graceful shutdown to prevent data loss.
 * This is a synchronous best-effort flush of in-flight writes.
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
  writeQueue.clear();
}

/**
 * Force flush a specific file synchronously.
 * Used when you need to ensure a file is written before proceeding.
 */
function forceFlush(dataDir, filename) {
  const filePath = path.join(dataDir, filename);

  if (pendingWrites.has(filename)) {
    const entry = pendingWrites.get(filename);
    clearTimeout(entry.timeout);
    pendingWrites.delete(filename);

    try {
      fs.writeFileSync(filePath, JSON.stringify(entry.data, null, 2));
      logger.info({ file: filename }, 'Force-flushed pending write');
    } catch (err) {
      logger.error({ err, file: filename }, 'Failed to force-flush pending write');
    }
  }

  writeQueue.delete(filename);
}

module.exports = { loadJSON, saveJSON, flushAll, forceFlush };
