/**
 * Citadel Sidecar — Command Queue
 *
 * File-based IPC between the sidecar (Node.js) and the DayZ server mod (EnScript).
 *
 * Protocol:
 *   1. Sidecar writes a JSON file to queueDir:   {id}.cmd.json
 *   2. DayZ mod picks it up, executes it, writes: {id}.res.json to responseDir
 *   3. Sidecar polls for the response file until timeout
 *   4. Both files are cleaned up after processing
 *
 * PERFORMANCE improvements:
 *   - Atomic file writes (write .tmp → rename) to prevent partial reads
 *   - fs.watch() for event-driven response detection (falls back to polling)
 *
 * Command file format:
 *   {
 *     "id": "uuid",
 *     "action": "player.heal",
 *     "params": { "steamId": "76561198..." },
 *     "timestamp": 1709136000000
 *   }
 *
 * Response file format:
 *   {
 *     "id": "uuid",
 *     "ok": true,
 *     "data": { ... },
 *     "error": null,
 *     "timestamp": 1709136000100
 *   }
 */
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const config = require('./config');
const logger = require('./logger');

/**
 * Atomically write a file by writing to a .tmp file first, then renaming.
 * Prevents the DayZ mod from reading a partially-written command file.
 */
function atomicWriteSync(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

/**
 * Send a command to the DayZ mod and wait for the response.
 *
 * @param {string} action  - Action identifier (e.g. "player.heal")
 * @param {object} params  - Action-specific parameters
 * @returns {Promise<object>} - The response data from the mod
 */
async function sendCommand(action, params = {}) {
  const id = uuid();
  const command = {
    id,
    action,
    params,
    timestamp: Date.now(),
  };

  const cmdFile = path.join(config.queueDir, `${id}.cmd.json`);
  const resFile = path.join(config.responseDir, `${id}.res.json`);

  // Atomic write — prevents mod from reading partial JSON
  atomicWriteSync(cmdFile, JSON.stringify(command));
  logger.debug({ id, action }, 'Command queued');

  // Wait for response using fs.watch + polling fallback
  const deadline = Date.now() + config.commandTimeoutMs;

  return new Promise((resolve, reject) => {
    let watcher;
    let poll;
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (watcher) { try { watcher.close(); } catch {} }
      if (poll) clearInterval(poll);
    };

    const tryRead = () => {
      try {
        if (!fs.existsSync(resFile)) return false;

        const raw = fs.readFileSync(resFile, 'utf-8');
        const response = JSON.parse(raw);

        cleanup();

        // Cleanup IPC files
        try { fs.unlinkSync(cmdFile); } catch { /* already consumed by mod */ }
        try { fs.unlinkSync(resFile); } catch { /* ignore */ }

        if (response.ok === false) {
          const err = new Error(response.error || 'Command failed');
          err.commandId = id;
          reject(err);
        } else {
          resolve(response.data || {});
        }
        return true;
      } catch (readErr) {
        // File might be partially written by mod — retry on next tick
        if (readErr instanceof SyntaxError) return false;
        cleanup();
        reject(readErr);
        return true;
      }
    };

    // Try fs.watch for event-driven response detection (faster than pure polling)
    try {
      watcher = fs.watch(config.responseDir, (eventType, filename) => {
        if (settled) return;
        if (filename && filename === `${id}.res.json`) {
          tryRead();
        }
      });
      watcher.on('error', () => {
        // fs.watch not reliable on all platforms — polling handles it
        if (watcher) { try { watcher.close(); } catch {} watcher = null; }
      });
    } catch {
      // fs.watch unavailable — polling alone is fine
    }

    // Polling fallback (catches cases fs.watch misses + handles timeout)
    poll = setInterval(() => {
      if (settled) return;

      if (tryRead()) return;

      if (Date.now() > deadline) {
        cleanup();
        // Cleanup stale command file
        try { fs.unlinkSync(cmdFile); } catch { /* ignore */ }
        const err = new Error(`Command timed out after ${config.commandTimeoutMs}ms`);
        err.commandId = id;
        err.action = action;
        reject(err);
      }
    }, config.pollIntervalMs);
  });
}

/**
 * Send a command that doesn't need a response (fire-and-forget).
 * Still writes the command file; the mod consumes it.
 */
function sendCommandAsync(action, params = {}) {
  const id = uuid();
  const command = { id, action, params, timestamp: Date.now() };
  const cmdFile = path.join(config.queueDir, `${id}.cmd.json`);

  try {
    atomicWriteSync(cmdFile, JSON.stringify(command));
    logger.debug({ id, action }, 'Async command queued');
  } catch (err) {
    logger.error({ err: err.message, action }, 'Failed to queue async command');
  }
  return id;
}

/**
 * Cleanup stale command/response files older than maxAge ms.
 */
function cleanupStaleFiles(maxAgeMs = 60000) {
  const now = Date.now();
  for (const dir of [config.queueDir, config.responseDir]) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(full);
          logger.debug({ file }, 'Cleaned up stale queue file');
        }
      }
    } catch { /* ignore */ }
  }
}

module.exports = { sendCommand, sendCommandAsync, cleanupStaleFiles };
