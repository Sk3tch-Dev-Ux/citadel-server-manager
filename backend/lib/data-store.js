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
  // The real on-disk file written by lib/token-revocation.js is
  // 'token-revocations.json'. This set previously listed 'tokens-revoked.json',
  // which never existed — so the revocation file was written 0o644
  // (world-readable on POSIX). Use the correct name.
  'token-revocations.json',
  // servers.json holds RCON passwords + the sidecar in-house API key. Those
  // two fields are now encrypted at rest (AES-256-GCM via lib/servers-store,
  // which wraps load/save of this file); the 0o600 mode here is defense in
  // depth on top so the file isn't world-readable even before decryption.
  'servers.json',
  '.jwt-secret',
]);
function modeFor(filename) {
  return SENSITIVE_FILES.has(filename) ? 0o600 : 0o644;
}

/**
 * Files that must be durably on disk before the request that triggered the
 * write returns its 200. These are security/forensic-critical: a token
 * revocation or an audit row that's still sitting in the debounce window when
 * the process is killed is effectively lost. For these we write synchronously
 * inside saveJSON (and still resolve the returned Promise on success).
 *
 * Everything in SENSITIVE_FILES qualifies; audit.json is already in that set
 * but is called out here for intent.
 */
function isForceFlushFile(filename) {
  return SENSITIVE_FILES.has(filename) || filename === 'audit.json';
}

/**
 * Optional hook invoked when a persistence write ultimately fails (after the
 * atomic-rename path or the synchronous force-flush path). Lets the host wire
 * a metric / alert ("failed_persist") without this module depending on the
 * metrics layer. Best-effort: a throwing hook never masks the original error.
 *
 * @type {((info: { filename: string, error: Error }) => void) | null}
 */
let _onWriteError = null;
function setOnWriteError(fn) {
  _onWriteError = typeof fn === 'function' ? fn : null;
}
function _reportWriteError(filename, error) {
  logger.error({ err: error, file: filename, event: 'failed_persist' }, 'Failed to persist JSON data file');
  if (_onWriteError) {
    try { _onWriteError({ filename, error }); } catch { /* hook must never throw through */ }
  }
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

// Per-file list of {resolve,reject} for callers awaiting a still-debounced
// write. When the debounced write fires, every waiter settles with that
// write's real outcome (coalesced writes share one disk result).
const writeWaiters = new Map(); // filename -> [{ resolve, reject }]

function _settleWaiters(filename, err) {
  const waiters = writeWaiters.get(filename);
  if (!waiters) return;
  writeWaiters.delete(filename);
  for (const w of waiters) {
    if (err) w.reject(err); else w.resolve();
  }
}

/**
 * The atomic write body shared by the debounced path. Writes `latestData` to
 * `filePath` via a temp file + rename, refusing to follow a symlink (M16).
 * Resolves on success, rejects on failure (after best-effort temp cleanup).
 */
async function _atomicWrite(filename, filePath, latestData) {
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
    try {
      await fsp.unlink(tmpPath);
    } catch {
      /* cleanup best effort */
    }
    throw err;
  }
}

/**
 * Persist `data` to dataDir/filename as JSON.
 *
 * Returns a Promise that settles on the REAL write outcome (FRAG-4): it
 * resolves once the bytes are durably on disk and rejects if the write fails
 * (after routing the error through the failed_persist log + onWriteError hook).
 * Existing fire-and-forget callers keep working — they simply ignore the
 * returned Promise (an unobserved rejection is suppressed for them, see below).
 *
 * For security/forensic-critical files (SENSITIVE_FILES + audit.json) the
 * write is forced synchronously here, so the durable write completes before
 * the calling request returns its 200 — a token revocation or audit row can't
 * be lost in the debounce window if the process is killed. All other files
 * keep the debounced, coalesced, async atomic write.
 */
function saveJSON(dataDir, filename, data) {
  const filePath = path.join(dataDir, filename);

  // Critical files: write durably right now (synchronous), then settle.
  if (isForceFlushFile(filename)) {
    // Drop any queued debounce for this file — this sync write supersedes it.
    if (pendingWrites.has(filename)) {
      clearTimeout(pendingWrites.get(filename).timeout);
      pendingWrites.delete(filename);
    }
    writeQueue.delete(filename);
    try {
      // M16: don't follow a symlink that may have replaced the target.
      try {
        const st = fs.lstatSync(filePath);
        if (st.isSymbolicLink()) throw new Error(`Refusing to write to symlink at ${filePath}`);
      } catch (lstatErr) {
        if (lstatErr.code !== 'ENOENT') throw lstatErr; // ENOENT = first write, fine
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: modeFor(filename) });
      logger.debug({ file: filename }, 'JSON data file force-flushed (critical)');
      _settleWaiters(filename, null);
      return Promise.resolve();
    } catch (err) {
      _reportWriteError(filename, err);
      _settleWaiters(filename, err);
      const rejected = Promise.reject(err);
      rejected.catch(() => {}); // suppress unhandledRejection for fire-and-forget callers
      return rejected;
    }
  }

  // Add this write to the queue for this file
  if (!writeQueue.has(filename)) {
    writeQueue.set(filename, []);
  }
  writeQueue.get(filename).push({ data, timestamp: Date.now() });

  // Build the Promise this caller gets back; park its resolver so the
  // debounced write can settle every coalesced waiter with one outcome.
  if (!writeWaiters.has(filename)) writeWaiters.set(filename, []);
  const resultPromise = new Promise((resolve, reject) => {
    writeWaiters.get(filename).push({ resolve, reject });
  });
  // Fire-and-forget callers don't observe this Promise; swallow its rejection
  // so a failed background write can't crash the process via unhandledRejection.
  resultPromise.catch(() => {});

  // Clear existing debounce timeout if any
  if (pendingWrites.has(filename)) {
    clearTimeout(pendingWrites.get(filename).timeout);
  }

  // Set new debounce timeout — will write the latest state
  const timeout = setTimeout(async () => {
    pendingWrites.delete(filename);

    // Get the latest data from the queue
    const queue = writeQueue.get(filename);
    if (!queue || queue.length === 0) { _settleWaiters(filename, null); return; }

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

    let writeErr = null;
    try {
      await _atomicWrite(filename, filePath, latestData);
    } catch (err) {
      writeErr = err;
      _reportWriteError(filename, err);
    } finally {
      writeInFlight.delete(filename);
      resolveInFlight();
      _settleWaiters(filename, writeErr);
    }
  }, DEBOUNCE_MS);

  pendingWrites.set(filename, { timeout, data, filePath });
  return resultPromise;
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
      _settleWaiters(filename, null);
    } catch (err) {
      _reportWriteError(filename, err);
      _settleWaiters(filename, err);
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
      _settleWaiters(filename, null);
    } catch (err) {
      _reportWriteError(filename, err);
      _settleWaiters(filename, err);
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

module.exports = { loadJSON, saveJSON, flushAll, forceFlush, cleanupStaleTempFiles, setOnWriteError };
