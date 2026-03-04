/**
 * RPT log file tailer — streams new DayZ RPT log lines to the console
 * via the existing addLog() → Socket.io pipeline.
 *
 * Uses fs.watchFile (polling-based) for reliable Windows file watching.
 * Tracks byte offset per server so only new content is read.
 */
const fs = require('fs');
const logger = require('./logger');
const ctx = require('./context');
const { findRPTFiles } = require('./profile-resolver');
const { addLog } = require('./audit');

/** Active tailers keyed by serverId */
const tailers = {};

/** Lines matching these patterns are filtered out (noise reduction) */
const NOISE_PATTERNS = [
  /^\s*$/,                          // blank lines
  /^Average server FPS:/i,          // already scraped by rpt-scraper for metrics
  /^FPS log:/i,
  /^\d{2}:\d{2}:\d{2}\.\d+ \d+$/,  // bare timestamp + number (fps tick lines)
];

/** Patterns that indicate an error-level line */
const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bcrash\b/i,
  /\bexception\b/i,
  /\bfailed\b/i,
  /\bfault\b/i,
];

/** Patterns that indicate a warning-level line */
const WARN_PATTERNS = [
  /\bwarning\b/i,
  /\bcannot\b/i,
  /\btimeout\b/i,
  /\bdenied\b/i,
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
 * Start tailing the newest RPT file for a server.
 * Begins reading from the current end-of-file (only new content).
 */
function startTailing(serverId) {
  // Stop any existing tailer first
  stopTailing(serverId);

  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return;

  const rptFiles = findRPTFiles(srv);
  if (rptFiles.length === 0) {
    logger.debug({ serverId }, 'No RPT files found for tailing');
    return;
  }

  const rptPath = rptFiles[0].fullPath;
  let offset = 0;
  let lastLine = '';
  let lastLineTime = 0;

  // Start from end of file (don't replay old content)
  try {
    const stat = fs.statSync(rptPath);
    offset = stat.size;
  } catch {
    offset = 0;
  }

  logger.info({ serverId, rptPath, offset }, 'Starting RPT tail');

  const readNewContent = () => {
    try {
      const stat = fs.statSync(rptPath);
      if (stat.size <= offset) {
        // File was truncated or unchanged
        if (stat.size < offset) offset = stat.size;
        return;
      }

      const readSize = stat.size - offset;
      // Cap read at 64KB per tick to avoid flooding
      const cappedSize = Math.min(readSize, 64 * 1024);
      const fd = fs.openSync(rptPath, 'r');
      const buf = Buffer.alloc(cappedSize);
      fs.readSync(fd, buf, 0, cappedSize, offset);
      fs.closeSync(fd);

      offset += cappedSize;
      const content = buf.toString('utf8');
      const lines = content.split('\n');

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '').trim();
        if (!line) continue;

        // Skip noise
        if (NOISE_PATTERNS.some(p => p.test(line))) continue;

        // Dedup: skip if identical to last line within 2 seconds
        const now = Date.now();
        if (line === lastLine && (now - lastLineTime) < 2000) continue;
        lastLine = line;
        lastLineTime = now;

        const level = classifyLevel(line);
        addLog(serverId, level, 'rpt', line);
      }
    } catch (err) {
      logger.debug({ err, serverId, rptPath }, 'RPT tail read error');
    }
  };

  // Use fs.watchFile for reliable polling on Windows (1 second interval)
  fs.watchFile(rptPath, { interval: 1000 }, readNewContent);

  tailers[serverId] = { rptPath, cleanup: () => fs.unwatchFile(rptPath, readNewContent) };
}

/**
 * Stop tailing RPT for a server.
 */
function stopTailing(serverId) {
  const tailer = tailers[serverId];
  if (tailer) {
    try {
      tailer.cleanup();
    } catch { /* ok */ }
    delete tailers[serverId];
    logger.debug({ serverId }, 'RPT tail stopped');
  }
}

module.exports = { startTailing, stopTailing };
