/**
 * Restart Scheduler Service.
 *
 * Manages automatic server restarts with configurable schedules,
 * warning messages sent via RCON, and maintenance windows.
 *
 * Schedule types:
 *   - interval: restart every X hours
 *   - daily: restart at specific times each day
 *   - onetime: single restart at a specific date/time
 *
 * Integrates with:
 *   - server-lifecycle.js for actual restart execution
 *   - rcon-client.js for sending player warnings
 *   - data-store.js for persistence
 *   - notifications.js for webhooks/discord
 */
const logger = require('./logger');
const ctx = require('./context');
const { loadJSON, saveJSON } = require('./data-store');
const { restartServer } = require('./server-lifecycle');
const { addAudit, addLog } = require('./audit');
const { fireWebhooks } = require('./notifications');

const DATA_FILE = 'restart-schedules.json';
const HISTORY_FILE = 'restart-history.json';
const MAX_HISTORY = 50;

// In-memory state
let schedules = {};          // serverId -> schedule config
let restartHistory = {};     // serverId -> [{timestamp, type, triggeredBy}]
const activeTimers = {};     // serverId -> { restart: timeout, warnings: [timeout...] }
const schedulerState = {};   // serverId -> { nextRestart, warningsSent: [], countdown }

// ─── Default warning templates ──────────────────────────
const DEFAULT_WARNINGS = [
  { minutesBefore: 30, message: 'SERVER RESTART IN {time}! Please find a safe location.' },
  { minutesBefore: 15, message: 'SERVER RESTART IN {time}! Find safety now!' },
  { minutesBefore: 5,  message: 'RESTART IN {time}! Get to safety!' },
  { minutesBefore: 1,  message: 'RESTARTING IN 1 MINUTE! Find cover immediately!' },
];

// ─── Persistence ────────────────────────────────────────

function load() {
  schedules = loadJSON(ctx.CONFIG.dataDir, DATA_FILE, {});
  restartHistory = loadJSON(ctx.CONFIG.dataDir, HISTORY_FILE, {});
}

function save() {
  saveJSON(ctx.CONFIG.dataDir, DATA_FILE, schedules);
}

function saveHistory() {
  saveJSON(ctx.CONFIG.dataDir, HISTORY_FILE, restartHistory);
}

// ─── Time helpers ───────────────────────────────────────

/** Parse "HH:MM" to { hours, minutes } */
function parseTime(str) {
  const [h, m] = str.split(':').map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

/** Format minutes into human-readable string */
function formatMinutes(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h} hour${h > 1 ? 's' : ''}`;
  }
  return `${mins} minute${mins !== 1 ? 's' : ''}`;
}

/**
 * Calculate next restart time for a schedule.
 * Returns a Date object or null if no next restart.
 */
function calculateNextRestart(schedule) {
  const now = new Date();

  if (!schedule.enabled) return null;

  switch (schedule.type) {
    case 'interval': {
      const hours = schedule.intervalHours || 4;
      // If we have a lastRestart, calculate from that
      if (schedule.lastRestart) {
        const last = new Date(schedule.lastRestart);
        const next = new Date(last.getTime() + hours * 3600_000);
        // If the calculated next is in the past, use now + interval
        return next > now ? next : new Date(now.getTime() + hours * 3600_000);
      }
      // No last restart — schedule from now
      return new Date(now.getTime() + hours * 3600_000);
    }

    case 'daily': {
      const times = schedule.dailyTimes || [];
      if (times.length === 0) return null;

      // Find the next upcoming time today or tomorrow
      let earliest = null;
      for (const timeStr of times) {
        const { hours, minutes } = parseTime(timeStr);

        // Check today
        const todayTarget = new Date(now);
        todayTarget.setHours(hours, minutes, 0, 0);
        if (todayTarget > now) {
          if (!earliest || todayTarget < earliest) earliest = todayTarget;
        }

        // Check tomorrow
        const tomorrowTarget = new Date(now);
        tomorrowTarget.setDate(tomorrowTarget.getDate() + 1);
        tomorrowTarget.setHours(hours, minutes, 0, 0);
        if (!earliest || tomorrowTarget < earliest) {
          // Only use tomorrow if nothing today
          if (!earliest) earliest = tomorrowTarget;
        }
      }
      return earliest;
    }

    case 'onetime': {
      if (!schedule.oneTimeDate) return null;
      const target = new Date(schedule.oneTimeDate);
      return target > now ? target : null;
    }

    default:
      return null;
  }
}

// ─── RCON Warning System ────────────────────────────────

/**
 * Send a warning message to all players on a server via RCON.
 */
async function sendWarning(serverId, message) {
  const state = ctx.serverStates[serverId];
  if (!state?.rcon) {
    logger.warn({ serverId }, 'Cannot send restart warning — RCON not available');
    return false;
  }

  try {
    const result = await state.rcon.say(message);
    logger.info({ serverId, message }, 'Sent restart warning via RCON');
    addLog(serverId, 'info', 'scheduler', `Restart warning: ${message}`);
    return !result.startsWith('[Error]');
  } catch (err) {
    logger.error({ err, serverId }, 'Failed to send restart warning');
    return false;
  }
}

/**
 * Interpolate message template variables.
 */
function interpolateMessage(template, vars) {
  return template
    .replace(/\{time\}/g, vars.time || '')
    .replace(/\{server_name\}/g, vars.serverName || 'Server');
}

// ─── Core Scheduling Engine ─────────────────────────────

/**
 * Clear all active timers for a server.
 */
function clearTimers(serverId) {
  const timers = activeTimers[serverId];
  if (!timers) return;

  if (timers.restart) clearTimeout(timers.restart);
  if (timers.warnings) {
    for (const t of timers.warnings) clearTimeout(t);
  }
  delete activeTimers[serverId];
  delete schedulerState[serverId];
}

/**
 * Schedule the next restart for a server (with warnings).
 */
function scheduleRestart(serverId) {
  const schedule = schedules[serverId];
  if (!schedule || !schedule.enabled) {
    clearTimers(serverId);
    return;
  }

  // Clear existing timers
  clearTimers(serverId);

  const nextRestart = calculateNextRestart(schedule);
  if (!nextRestart) {
    logger.info({ serverId }, 'No next restart time — schedule may be expired');
    return;
  }

  const now = Date.now();
  const msUntilRestart = nextRestart.getTime() - now;

  if (msUntilRestart <= 0) {
    logger.warn({ serverId }, 'Next restart time is in the past — executing immediately');
    executeRestart(serverId, 'scheduled');
    return;
  }

  // Update schedule state
  schedule.nextRestart = nextRestart.toISOString();
  save();

  // Initialize scheduler state
  schedulerState[serverId] = {
    nextRestart: nextRestart.toISOString(),
    warningsSent: [],
    status: 'scheduled',
  };

  // Set up warning timers
  const warnings = schedule.warnings || DEFAULT_WARNINGS;
  const warningTimers = [];
  const srv = ctx.servers.find(s => s.id === serverId);
  const serverName = srv?.name || 'Server';

  for (const warning of warnings) {
    const msBeforeRestart = warning.minutesBefore * 60_000;
    const msUntilWarning = msUntilRestart - msBeforeRestart;

    if (msUntilWarning > 0) {
      const timer = setTimeout(() => {
        const msg = interpolateMessage(
          warning.message,
          { time: formatMinutes(warning.minutesBefore), serverName }
        );
        sendWarning(serverId, msg);
        if (schedulerState[serverId]) {
          schedulerState[serverId].warningsSent.push({
            minutesBefore: warning.minutesBefore,
            sentAt: new Date().toISOString(),
          });
        }
      }, msUntilWarning);
      warningTimers.push(timer);
    }
  }

  // Set up the actual restart timer
  const restartTimer = setTimeout(() => {
    executeRestart(serverId, 'scheduled');
  }, msUntilRestart);

  activeTimers[serverId] = {
    restart: restartTimer,
    warnings: warningTimers,
  };

  logger.info({
    serverId,
    nextRestart: nextRestart.toISOString(),
    msUntilRestart,
    warningCount: warningTimers.length,
  }, 'Scheduled next restart');
}

/**
 * Execute a restart for a server.
 */
async function executeRestart(serverId, triggeredBy = 'scheduled') {
  const schedule = schedules[serverId];
  const srv = ctx.servers.find(s => s.id === serverId);

  if (!srv) {
    logger.error({ serverId }, 'Cannot restart — server not found');
    return;
  }

  logger.info({ serverId, triggeredBy }, 'Executing scheduled restart');
  addLog(serverId, 'info', 'scheduler', `Executing ${triggeredBy} restart`);

  // Update state
  if (schedulerState[serverId]) {
    schedulerState[serverId].status = 'restarting';
  }

  // Add to history
  addHistoryEntry(serverId, triggeredBy);

  // Fire webhooks
  fireWebhooks('server.restart', {
    serverName: srv.name,
    serverId,
    reason: `Scheduled restart (${triggeredBy})`,
  }).catch(err => logger.error({ err }, 'Failed to fire restart webhook'));

  // Add audit entry
  addAudit('system', 'Scheduler', 'server.restart', `Scheduled restart: ${srv.name} (${triggeredBy})`);

  // Perform the actual restart
  try {
    const result = await restartServer(serverId, `Scheduled restart (${triggeredBy})`);
    if (result.success) {
      logger.info({ serverId }, 'Scheduled restart completed successfully');
      addLog(serverId, 'info', 'scheduler', 'Restart completed successfully');
    } else {
      logger.error({ serverId, error: result.error }, 'Scheduled restart failed');
      addLog(serverId, 'error', 'scheduler', `Restart failed: ${result.error}`);
    }
  } catch (err) {
    logger.error({ err, serverId }, 'Scheduled restart threw an error');
    addLog(serverId, 'error', 'scheduler', `Restart error: ${err.message}`);
  }

  // Update last restart time
  if (schedule) {
    schedule.lastRestart = new Date().toISOString();
    schedule.updatedAt = new Date().toISOString();

    // For one-time schedules, disable after execution
    if (schedule.type === 'onetime') {
      schedule.enabled = false;
      schedule.nextRestart = null;
    }

    save();
  }

  // Clear timers and schedule the next one (if recurring)
  clearTimers(serverId);
  if (schedule && schedule.enabled && schedule.type !== 'onetime') {
    // Small delay before scheduling next to avoid overlapping with restart
    setTimeout(() => scheduleRestart(serverId), 5000);
  }
}

// ─── History ────────────────────────────────────────────

function addHistoryEntry(serverId, triggeredBy) {
  if (!restartHistory[serverId]) restartHistory[serverId] = [];
  restartHistory[serverId].unshift({
    timestamp: new Date().toISOString(),
    type: schedules[serverId]?.type || 'manual',
    triggeredBy,
  });
  if (restartHistory[serverId].length > MAX_HISTORY) {
    restartHistory[serverId] = restartHistory[serverId].slice(0, MAX_HISTORY);
  }
  saveHistory();
}

// ─── Public API ─────────────────────────────────────────

/**
 * Get the schedule for a server.
 */
function getSchedule(serverId) {
  return schedules[serverId] || null;
}

/**
 * Create or update a schedule for a server.
 */
function setSchedule(serverId, config) {
  const existing = schedules[serverId];
  const now = new Date().toISOString();

  schedules[serverId] = {
    enabled: config.enabled !== undefined ? config.enabled : true,
    type: config.type || 'interval',
    intervalHours: config.intervalHours || 4,
    dailyTimes: config.dailyTimes || ['00:00', '06:00', '12:00', '18:00'],
    oneTimeDate: config.oneTimeDate || null,
    warnings: config.warnings || DEFAULT_WARNINGS,
    lastRestart: existing?.lastRestart || config.lastRestart || null,
    nextRestart: null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  save();

  // Re-schedule
  if (schedules[serverId].enabled) {
    scheduleRestart(serverId);
  } else {
    clearTimers(serverId);
  }

  return schedules[serverId];
}

/**
 * Delete a schedule for a server.
 */
function deleteSchedule(serverId) {
  clearTimers(serverId);
  delete schedules[serverId];
  save();
}

/**
 * Toggle a schedule on/off.
 */
function toggleSchedule(serverId) {
  const schedule = schedules[serverId];
  if (!schedule) return null;

  schedule.enabled = !schedule.enabled;
  schedule.updatedAt = new Date().toISOString();

  if (schedule.enabled) {
    scheduleRestart(serverId);
  } else {
    clearTimers(serverId);
    schedule.nextRestart = null;
  }

  save();
  return schedule;
}

/**
 * Skip the next scheduled restart (reschedules to the one after).
 */
function skipNext(serverId) {
  const schedule = schedules[serverId];
  if (!schedule || !schedule.enabled) return null;

  // Clear current timers
  clearTimers(serverId);

  // For interval, advance the "lastRestart" to now to push the window forward
  if (schedule.type === 'interval') {
    schedule.lastRestart = new Date().toISOString();
  }

  // For one-time, just disable
  if (schedule.type === 'onetime') {
    schedule.enabled = false;
    schedule.nextRestart = null;
    save();
    return schedule;
  }

  schedule.updatedAt = new Date().toISOString();
  save();

  // Reschedule
  scheduleRestart(serverId);
  return schedule;
}

/**
 * Trigger an immediate restart with warning countdown.
 * @param {string} serverId
 * @param {number} delayMinutes - minutes before restart (0 = immediate)
 * @param {string} triggeredBy - who triggered it
 */
async function triggerRestart(serverId, delayMinutes = 0, triggeredBy = 'manual') {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return { success: false, error: 'Server not found' };

  if (delayMinutes <= 0) {
    // Immediate restart
    await executeRestart(serverId, triggeredBy);
    return { success: true, message: 'Restart initiated' };
  }

  // Restart with warnings
  const schedule = schedules[serverId];
  const warnings = schedule?.warnings || DEFAULT_WARNINGS;
  const serverName = srv.name || 'Server';

  // Send applicable warnings immediately
  const applicableWarnings = warnings
    .filter(w => w.minutesBefore <= delayMinutes)
    .sort((a, b) => b.minutesBefore - a.minutesBefore);

  // Clear any existing timers for this manual trigger
  clearTimers(serverId);

  const warningTimers = [];
  for (const warning of applicableWarnings) {
    const msUntilWarning = (delayMinutes - warning.minutesBefore) * 60_000;
    const timer = setTimeout(() => {
      const msg = interpolateMessage(
        warning.message,
        { time: formatMinutes(warning.minutesBefore), serverName }
      );
      sendWarning(serverId, msg);
    }, msUntilWarning);
    warningTimers.push(timer);
  }

  // Schedule the restart
  const restartTimer = setTimeout(() => {
    executeRestart(serverId, triggeredBy);
  }, delayMinutes * 60_000);

  activeTimers[serverId] = {
    restart: restartTimer,
    warnings: warningTimers,
  };

  const restartTime = new Date(Date.now() + delayMinutes * 60_000);
  schedulerState[serverId] = {
    nextRestart: restartTime.toISOString(),
    warningsSent: [],
    status: 'countdown',
  };

  return { success: true, message: `Restart scheduled in ${delayMinutes} minutes` };
}

/**
 * Get the current status of the scheduler for a server.
 */
function getStatus(serverId) {
  const schedule = schedules[serverId];
  const state = schedulerState[serverId];
  const history = (restartHistory[serverId] || []).slice(0, 10);

  if (!schedule) {
    return {
      active: false,
      schedule: null,
      nextRestart: null,
      countdown: null,
      warningsSent: [],
      history,
    };
  }

  let countdown = null;
  if (state?.nextRestart) {
    const ms = new Date(state.nextRestart).getTime() - Date.now();
    countdown = ms > 0 ? Math.ceil(ms / 1000) : 0;
  }

  return {
    active: schedule.enabled,
    schedule,
    nextRestart: state?.nextRestart || schedule.nextRestart || null,
    countdown,
    status: state?.status || (schedule.enabled ? 'scheduled' : 'disabled'),
    warningsSent: state?.warningsSent || [],
    history,
  };
}

/**
 * Initialize the scheduler.
 *
 * Restart scheduling moved to Citadel Cloud in May 2026 — Cloud owns the
 * schedule and calls /api/server-control/restart on the Agent when a
 * window fires. The in-Agent cron loop is no longer started, so any
 * schedules sitting in data/restart-schedules.json are inert until you
 * migrate them to citadels.cc/cloud.
 *
 * This function is kept callable so we don't have to surgically remove
 * the call site, and so future versions can either delete this lib or
 * repurpose it for Cloud-side scheduling.
 */
function initialize() {
  // Intentionally no-op. Don't call load() — we don't want to silently
  // re-activate stale schedules if someone re-enables the routes.
  logger.info('Restart scheduler is disabled — Cloud now owns this. See citadels.cc/cloud.');
}

/**
 * Shutdown — clear any timers. Safe to call even when initialize() didn't
 * start anything (activeTimers is empty in that case).
 */
function shutdown() {
  for (const serverId of Object.keys(activeTimers)) {
    clearTimers(serverId);
  }
}

module.exports = {
  initialize,
  shutdown,
  getSchedule,
  setSchedule,
  deleteSchedule,
  toggleSchedule,
  skipNext,
  triggerRestart,
  getStatus,
  DEFAULT_WARNINGS,
};
