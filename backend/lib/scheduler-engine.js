/**
 * Scheduler & Messenger Engine
 *
 * Ticks every 10 seconds to:
 * 1. Check scheduler jobs — broadcast warnings, kick/lock, then execute action
 * 2. Check messenger messages — send RCON broadcasts at configured intervals
 */
const logger = require('./logger');
const ctx = require('./context');
const { saveJSON } = require('./data-store');
const { addNotification, fireWebhooks } = require('./notifications');
const { addAudit } = require('./audit');

const TICK_MS = 10_000; // 10 seconds

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Scheduler Logic ──────────────────────────────────

/**
 * Compute minutes until a job should execute.
 * Returns Infinity if the job shouldn't fire today/soon.
 */
function computeMinutesUntil(job, state) {
  const now = new Date();

  if (job.useUptime) {
    // Relative to server start
    if (!state.startedAt) return Infinity;
    const uptimeMs = now.getTime() - new Date(state.startedAt).getTime();
    const targetMs = (job.hour * 60 + job.minute) * 60_000;
    const diff = (targetMs - uptimeMs) / 60_000;
    // If we're past the target, check if within a 2-minute window (for execution)
    if (diff < -2) return Infinity;
    return diff;
  }

  // Absolute wall-clock time
  const target = new Date(now);
  target.setHours(job.hour, job.minute, 0, 0);

  // If target is in the past, check if we're within a 2-minute execution window
  if (target <= now) {
    const diffMs = now.getTime() - target.getTime();
    if (diffMs < 120_000) return -(diffMs / 60_000); // negative = past due but within window
    // Otherwise, it's for tomorrow — skip if today is a valid day
    return Infinity;
  }

  // Check day-of-week filter
  if (job.daysOfWeek && job.daysOfWeek.length > 0 && job.daysOfWeek.length < 7) {
    if (!job.daysOfWeek.includes(now.getDay())) return Infinity;
  }

  return (target.getTime() - now.getTime()) / 60_000;
}

/**
 * Process a single scheduler job — warnings, pre-actions, and execution.
 */
function processJob(job, server, state) {
  if (!job.enabled) return;
  if (!state.rcon) return;

  const minutesUntil = computeMinutesUntil(job, state);
  if (minutesUntil === Infinity) return;

  // Check day-of-week for absolute jobs
  if (!job.useUptime && job.daysOfWeek && job.daysOfWeek.length > 0 && job.daysOfWeek.length < 7) {
    if (!job.daysOfWeek.includes(new Date().getDay())) return;
  }

  // Prevent re-firing within 2 minutes of last execution
  if (job.lastExecutedAt) {
    const sinceLastExec = Date.now() - new Date(job.lastExecutedAt).getTime();
    if (sinceLastExec < 120_000) return;
  }

  // Get or create pending state for this job
  if (!state.scheduler.pendingActions) state.scheduler.pendingActions = new Map();
  let pending = state.scheduler.pendingActions.get(job.id);
  if (!pending) {
    pending = { warned: new Set(), kicked: false, locked: false };
    state.scheduler.pendingActions.set(job.id, pending);
  }

  const maxWarning = Math.max(...(job.warningMinutes || []), 0);

  // Only start processing when within the warning window
  if (minutesUntil > maxWarning + 1) return;

  // ─── Broadcast warnings ───
  const warningMinutes = [...(job.warningMinutes || [])].sort((a, b) => b - a);
  for (const warnMin of warningMinutes) {
    if (minutesUntil <= warnMin && !pending.warned.has(warnMin)) {
      const msg = (job.warningMessage || 'Server restart in {minutes} minute(s)!')
        .replace(/\{minutes\}/g, String(warnMin));
      try {
        state.rcon.say(msg);
        logger.info({ serverId: server.id, job: job.title, warning: warnMin }, 'Scheduler: broadcast warning');
      } catch (err) {
        logger.warn({ err, serverId: server.id }, 'Scheduler: failed to broadcast warning');
      }
      pending.warned.add(warnMin);
    }
  }

  // ─── Lock server ───
  if (job.lockServer && minutesUntil <= (job.lockMinutesBefore || 2) && !pending.locked) {
    try {
      state.rcon.lock();
      logger.info({ serverId: server.id, job: job.title }, 'Scheduler: locked server');
    } catch (err) {
      logger.warn({ err }, 'Scheduler: failed to lock server');
    }
    pending.locked = true;
  }

  // ─── Kick players ───
  if (job.kickPlayers && minutesUntil <= (job.kickMinutesBefore || 1) && !pending.kicked) {
    try {
      for (const player of (state.players || [])) {
        state.rcon.kick(player.id || player.number, 'Server restarting');
      }
      logger.info({ serverId: server.id, job: job.title, count: (state.players || []).length }, 'Scheduler: kicked players');
    } catch (err) {
      logger.warn({ err }, 'Scheduler: failed to kick players');
    }
    pending.kicked = true;
  }

  // ─── Execute action ───
  if (minutesUntil <= 0) {
    try {
      if (job.action === 'restart' || !job.action) {
        state.rcon.restart();
        logger.info({ serverId: server.id, job: job.title }, 'Scheduler: executed restart');
      }

      // Update lastExecutedAt and persist
      job.lastExecutedAt = new Date().toISOString();
      saveJSON(ctx.CONFIG.dataDir, `scheduler-${server.id}.json`, { jobs: state.scheduler.jobs });

      // Notifications & audit
      addNotification(server.id, 'scheduler.execute', 'Scheduled Restart', `${job.title} executed`, 'info');
      addAudit('system', 'scheduler', 'scheduler.execute', `${job.title} on ${server.name}`);

      // Fire webhooks
      try { fireWebhooks('server.restarted', server, { trigger: 'scheduler', job: job.title }); } catch (_) { /* ignore */ }

      // Emit socket event
      if (ctx.io) {
        ctx.io.emit('schedulerExecution', { serverId: server.id, jobId: job.id, title: job.title, action: job.action || 'restart' });
      }
    } catch (err) {
      logger.error({ err, serverId: server.id, job: job.title }, 'Scheduler: failed to execute action');
    }

    // Clear pending state
    state.scheduler.pendingActions.delete(job.id);
  }
}

// ─── Messenger Logic ──────────────────────────────────

/**
 * Process messenger messages for a running server.
 */
function processMessenger(server, state) {
  if (!state.messenger || !state.messenger.enabled) return;
  if (!state.rcon) return;
  if (!state.startedAt) return;

  const now = Date.now();
  const serverStarted = new Date(state.startedAt).getTime();
  const uptimeMs = now - serverStarted;

  if (!state.messenger.lastSent) state.messenger.lastSent = new Map();

  for (const msg of (state.messenger.messages || [])) {
    if (!msg.enabled) continue;
    if (!msg.text || !msg.intervalSeconds) continue;

    // Check start delay
    const startDelay = (msg.startDelaySeconds || 0) * 1000;
    if (uptimeMs < startDelay) continue;

    // Check interval
    const lastSent = state.messenger.lastSent.get(msg.id) || 0;
    const elapsed = now - lastSent;
    if (elapsed < msg.intervalSeconds * 1000) continue;

    // Send the message
    try {
      // Replace placeholders
      let text = msg.text;
      text = text.replace(/\{server_name\}/g, server.name || 'DayZ Server');
      text = text.replace(/\{player_count\}/g, String((state.players || []).length));
      text = text.replace(/\{max_players\}/g, String(server.maxPlayers || 60));

      state.rcon.say(text);
      state.messenger.lastSent.set(msg.id, now);
      logger.debug({ serverId: server.id, msgId: msg.id }, 'Messenger: sent message');
    } catch (err) {
      logger.warn({ err, serverId: server.id, msgId: msg.id }, 'Messenger: failed to send');
    }
  }
}

// ─── Main Tick ────────────────────────────────────────

function tick() {
  for (const server of ctx.servers) {
    const state = ctx.serverStates[server.id];
    if (!state || state.status !== 'running') continue;

    // Process scheduler jobs
    if (state.scheduler && state.scheduler.jobs) {
      for (const job of state.scheduler.jobs) {
        try {
          processJob(job, server, state);
        } catch (err) {
          logger.error({ err, serverId: server.id, jobId: job.id }, 'Scheduler tick error');
        }
      }
    }

    // Process messenger
    try {
      processMessenger(server, state);
    } catch (err) {
      logger.error({ err, serverId: server.id }, 'Messenger tick error');
    }
  }
}

/**
 * Start the scheduler engine. Returns the interval ID for cleanup.
 */
function startSchedulerEngine() {
  logger.info('Scheduler engine started (10s tick)');
  return setInterval(tick, TICK_MS);
}

module.exports = { startSchedulerEngine };
