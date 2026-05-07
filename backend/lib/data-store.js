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
const { DATA_STORE_DEBOUNCE_MS: DEBOUNCE_MS } = require('./constants');

// Audit M17. Sensitive files contain bcrypt hashes, MFA secrets (encrypted),
// webhook URLs that may include tokens, and audit logs. On POSIX without an
// explicit mode, fs.writeFile honors umask which is typically 0o022 →
// world-readable 0644. Set 0o600 explicitly so only the running user can
// read these. On Windows the mode is mostly ignored (ACLs win) but the
// flag does no harm.
const SENSITIVE_FILES = new Set([
  'users.json',
  'webhooks.json',
  'audit.json',
  'lockouts.json',
  'ip-bans.json',
  'tokens-revoked.json',
  '.jwt-secret',
]);
function modeFor(filename) {
  return SENSITIVE_FILES.has(filename) ? 0o600 : 0o644;
}

const pendingWrites = new Map(); // filename -> { timeout, data, filePath }
const writeQueue = new Map(); // filename -> [{ data, timestamp }]
const writeInFlight = new Map(); // filename -> Promise<void> (replaces busy-wait Set)

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

    // Serialize writes: await in-flight write for this file (Promise-based, no polling)
    if (writeInFlight.has(filename)) {
      await writeInFlight.get(filename);
    }

    let resolveInFlight;
    const inFlightPromise = new Promise(r => { resolveInFlight = r; });
    writeInFlight.set(filename, inFlightPromise);

    const tmpPath = filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');

    try {
      // Audit M16: refuse to rename over a symlink. If an attacker (or a
      // misconfiguration) replaces filePath with a symlink pointing at,
      // say, /etc/shadow before this rename, the rename clobbers the
      // symlink target (since rename follows the link's containing dir,
      // not the link itself) — which means we'd write JSON into the
      // attacker-chosen file. lstat tells us about the link itself.
      try {
        const st = await fsp.lstat(filePath);
        if (st.isSymbolicLink()) {
          throw new Error(`Refusing to write to symlink at ${filePath}`);
        }
      } catch (lstatErr) {
        if (lstatErr.code !== 'ENOENT') throw lstatErr; // ENOENT = first write, fine
      }

      await fsp.writeFile(tmpPath, JSON.stringify(latestData, null, 2), { mode: modeFor(filename) });
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
      writeInFlight.delete(filename);
      resolveInFlight();
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

    // Use the latest data from the writeQueue if available (more recent than pendingWrites)
    let dataToWrite = entry.data;
    const queue = writeQueue.get(filename);
    if (queue && queue.length > 0) {
      dataToWrite = queue[queue.length - 1].data;
    }

    try {
      fs.writeFileSync(entry.filePath, JSON.stringify(dataToWrite, null, 2), { mode: modeFor(filename) });
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

    // Use the latest data from the writeQueue if available (more recent than pendingWrites)
    let dataToWrite = entry.data;
    const queue = writeQueue.get(filename);
    if (queue && queue.length > 0) {
      dataToWrite = queue[queue.length - 1].data;
    }

    try {
      fs.writeFileSync(filePath, JSON.stringify(dataToWrite, null, 2), { mode: modeFor(filename) });
      logger.info({ file: filename }, 'Force-flushed pending write');
    } catch (err) {
      logger.error({ err, file: filename }, 'Failed to force-flush pending write');
    }
  }

  writeQueue.delete(filename);
}

/**
 * Remove orphaned .tmp.* files left behind by crashes during atomic writes.
 * Called once at startup to prevent stale temp files from accumulating.
 */
function cleanupStaleTempFiles(dataDir) {
  try {
    const files = fs.readdirSync(dataDir);
    const stale = files.filter(f => f.includes('.tmp.'));
    for (const f of stale) {
      try {
        fs.unlinkSync(path.join(dataDir, f));
      } catch { /* best effort */ }
    }
    if (stale.length > 0) {
      logger.info({ count: stale.length }, 'Cleaned up stale temp files from data directory');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to scan for stale temp files');
  }
}

module.exports = { loadJSON, saveJSON, flushAll, forceFlush, cleanupStaleTempFiles };
