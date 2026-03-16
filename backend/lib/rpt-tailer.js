/**
 * Server console log tailer — streams DayZ server_console.log output
 * to the frontend Console page via Socket.io.
 *
 * The DayZ process stdout/stderr is redirected to profiles/server_console.log
 * by process-manager.js. This module tails that file and emits new lines
 * through a dedicated 'consoleLog' Socket.io event, keeping server output
 * separate from system lifecycle logs.
 *
 * Uses fs.watchFile (polling-based) for reliable Windows file watching.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const ctx = require('./context');
const { MAX_CONSOLE_LINES } = require('./constants');

/** Active tailers keyed by serverId */
const tailers = {};

/** Per-server console log buffer (ring buffer for API fetch) */
const consoleBuffers = {};

/** Lines matching these patterns are filtered out (noise reduction) */
const NOISE_PATTERNS = [
  /^\s*$/,                          // blank lines
  /^Average server FPS:/i,          // already scraped by rpt-scraper for metrics
];

/** Patterns that indicate an error-level line */
const ERROR_PATTERNS = [
  /^!!!/,                           // DayZ !!! prefix = warning/error
  /\berror\b/i,
  /\bcrash\b/i,
  /\bexception\b/i,
  /\bfault\b/i,
];

/** Patterns that indicate a warning-level line */
const WARN_PATTERNS = [
  /\bwarning\b/i,
  /\bcannot\b/i,
  /\btimeout\b/i,
  /\bdenied\b/i,
  /\bcorrupted\b/i,
  /\bskipping\b/i,
];

/**
 * Classify a log line into a severity level.
 */
function classifyLevel(line) {
  if (ERROR_PATTERNS.some(p => p.test(line))) return 'error';
  if (WARN_PATTERNS.some(p => p.test(line))) return 'warn';
  return 'info';
}

/**
 * Resolve the path to server_console.log for a server.
 */
function resolveConsolePath(srv) {
  const profileDir = srv.profileDir || 'profiles';
  const profilePath = path.isAbsolute(profileDir) ? profileDir : path.join(srv.installDir, profileDir);
  return path.join(profilePath, 'server_console.log');
}

/**
 * Get the console log buffer for a server (used by API routes).
 */
function getConsoleBuffer(serverId) {
  return consoleBuffers[serverId] || [];
}

/**
 * Start tailing server_console.log for a server.
 * Reads from beginning of file (server just started, file was freshly created).
 */
function startTailing(serverId) {
  stopTailing(serverId);

  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return;

  const consolePath = resolveConsolePath(srv);
  let offset = 0;
  let lastLine = '';
  let lastLineTime = 0;

  // Initialize console buffer
  consoleBuffers[serverId] = [];

  // Start from beginning — process-manager opens file with 'w' on each start
  // so the file is fresh. But if tailing starts late, read from beginning to catch up.
  logger.info({ serverId, consolePath }, 'Starting console tail');

  const readNewContent = () => {
    try {
      if (!fs.existsSync(consolePath)) return;
      const stat = fs.statSync(consolePath);
      if (stat.size <= offset) {
        if (stat.size < offset) offset = 0; // file was truncated (new server start)
        return;
      }

      const readSize = stat.size - offset;
      const cappedSize = Math.min(readSize, 64 * 1024);
      const fd = fs.openSync(consolePath, 'r');
      const buf = Buffer.alloc(cappedSize);
      fs.readSync(fd, buf, 0, cappedSize, offset);
      fs.closeSync(fd);

      offset += cappedSize;
      const content = buf.toString('utf8');
      const lines = content.split('\n');

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) continue;

        // Skip noise
        if (NOISE_PATTERNS.some(p => p.test(line))) continue;

        // Dedup: skip if identical to last line within 2 seconds
        const now = Date.now();
        if (line === lastLine && (now - lastLineTime) < 2000) continue;
        lastLine = line;
        lastLineTime = now;

        const level = classifyLevel(line);
        const entry = { timestamp: new Date().toISOString(), level, message: line };

        // Store in ring buffer (push + shift is O(1) amortized vs unshift which is O(n))
        const buf = consoleBuffers[serverId];
        if (buf) {
          buf.push(entry);
          if (buf.length > MAX_CONSOLE_LINES) buf.shift();
        }

        // Emit to frontend via dedicated event
        if (ctx.io) ctx.io.emit('consoleLog', { serverId, ...entry });
      }
    } catch (err) {
      logger.debug({ err, serverId, consolePath }, 'Console tail read error');
    }
  };

  // Use fs.watchFile for reliable polling on Windows (1 second interval)
  fs.watchFile(consolePath, { interval: 1000 }, readNewContent);
  // Also do an immediate read to catch any content already written
  readNewContent();

  tailers[serverId] = { consolePath, cleanup: () => fs.unwatchFile(consolePath, readNewContent) };
}

/**
 * Stop tailing for a server.
 */
function stopTailing(serverId) {
  const tailer = tailers[serverId];
  if (tailer) {
    try {
      tailer.cleanup();
    } catch { /* ok */ }
    delete tailers[serverId];
    logger.debug({ serverId }, 'Console tail stopped');
  }
}

module.exports = { startTailing, stopTailing, getConsoleBuffer };
