/**
 * Discord Bot lifecycle manager.
 * Spawns the Discord bot (discord-bot/bot.js) as a managed child process
 * with auto-restart on crash and graceful shutdown integration.
 *
 * The bot communicates with the backend exclusively via REST API —
 * no shared memory, no circular dependencies.
 */
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

const { ROOT: PROJECT_ROOT, BOT_ENTRY } = require('./paths');

// Backoff schedule (ms) for auto-restart on crash
const BACKOFF_SCHEDULE = [5000, 15000, 30000, 60000];
const MAX_FAILURES = 5; // stop retrying after this many consecutive failures at max backoff
const STABILITY_THRESHOLD_MS = 30000; // if bot stays alive this long, reset failure counter

// Module-level state
let botProcess = null;
let restartAttempts = 0;
let intentionallyStopped = false;
let restartTimer = null;
let stabilityTimer = null;

/**
 * Start the Discord bot as a child process.
 * Pre-validates required env vars to prevent crash loops.
 * No-op if already running or not configured.
 */
function startBot() {
  // Already running?
  if (botProcess) {
    logger.debug('Discord bot already running, skipping start');
    return;
  }

  // Pre-validate — bot's config.js calls process.exit(1) if these are missing,
  // which would cause an immediate crash loop without this guard
  const token = process.env.DISCORD_BOT_TOKEN;
  const apiKey = process.env.DISCORD_BOT_API_KEY;

  if (!token) {
    logger.info('Discord bot not configured (DISCORD_BOT_TOKEN not set) — skipping');
    return;
  }

  if (!apiKey) {
    logger.warn('Discord bot cannot start: DISCORD_BOT_API_KEY is required but not set');
    return;
  }

  intentionallyStopped = false;

  logger.info('Starting Discord bot');

  try {
    const child = spawn(process.execPath, [BOT_ENTRY], {
      env: process.env,
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    botProcess = child;

    // Pipe stdout with prefix
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          logger.info(`[Discord Bot] ${line}`);
        }
      });
    }

    // Pipe stderr with prefix
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          logger.error(`[Discord Bot] ${line}`);
        }
      });
    }

    // Stability detection — if bot stays alive for 30s, reset restart counter
    stabilityTimer = setTimeout(() => {
      if (botProcess && botProcess.pid) {
        restartAttempts = 0;
        logger.debug('Discord bot stable, restart counter reset');
      }
    }, STABILITY_THRESHOLD_MS);

    child.on('error', (err) => {
      logger.error({ err: err.message }, 'Discord bot process error');
      botProcess = null;
      clearTimeout(stabilityTimer);
    });

    child.on('exit', (code, signal) => {
      botProcess = null;
      clearTimeout(stabilityTimer);

      if (intentionallyStopped) {
        logger.info({ code, signal }, 'Discord bot stopped');
        return;
      }

      logger.warn({ code, signal }, 'Discord bot exited unexpectedly');
      scheduleRestart();
    });

    if (child.pid) {
      logger.info({ pid: child.pid }, 'Discord bot started');
    } else {
      logger.error('Discord bot spawn returned no PID');
      botProcess = null;
    }
  } catch (err) {
    logger.error({ err }, 'Failed to start Discord bot');
    botProcess = null;
  }
}

/**
 * Schedule an auto-restart with exponential backoff.
 */
function scheduleRestart() {
  const backoffIndex = Math.min(restartAttempts, BACKOFF_SCHEDULE.length - 1);
  const delayMs = BACKOFF_SCHEDULE[backoffIndex];
  restartAttempts++;

  // Stop retrying after too many consecutive failures at max backoff
  if (restartAttempts > MAX_FAILURES + BACKOFF_SCHEDULE.length - 1) {
    logger.error(
      `Discord bot has crashed ${restartAttempts} times — giving up. Check logs and restart manually.`
    );
    return;
  }

  logger.info({ delayMs, attempt: restartAttempts }, 'Scheduling Discord bot restart');

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBot();
  }, delayMs);
}

/**
 * Stop the Discord bot gracefully.
 * Sends SIGTERM, then SIGKILL after 5 seconds if still alive.
 */
function stopBot() {
  intentionallyStopped = true;

  // Clear pending restart / stability timers
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (stabilityTimer) {
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }

  if (!botProcess) return;

  const pid = botProcess.pid;
  logger.info({ pid }, 'Stopping Discord bot');

  try {
    botProcess.kill('SIGTERM');
  } catch (err) {
    if (err.code !== 'ESRCH') {
      logger.warn({ err, pid }, 'Failed to send SIGTERM to Discord bot');
    }
    botProcess = null;
    return;
  }

  // Force kill after 5 seconds if still alive
  const killTimer = setTimeout(() => {
    if (botProcess) {
      try {
        botProcess.kill('SIGKILL');
        logger.warn({ pid }, 'Force-killed Discord bot after 5s timeout');
      } catch {
        // Already gone
      }
      botProcess = null;
    }
  }, 5000);
  killTimer.unref();
}

/**
 * Check if the Discord bot process is running.
 */
function isBotRunning() {
  if (!botProcess || !botProcess.pid) return false;
  try {
    process.kill(botProcess.pid, 0); // Signal 0 = existence check
    return true;
  } catch {
    botProcess = null;
    return false;
  }
}

/**
 * Get bot status for startup banner / API.
 */
function getBotStatus() {
  return {
    configured: !!process.env.DISCORD_BOT_TOKEN,
    running: isBotRunning(),
    pid: botProcess?.pid || null,
    restartAttempts,
  };
}

module.exports = { startBot, stopBot, isBotRunning, getBotStatus };
