/**
 * Scheduler & Messenger Engine
 *
 * Ticks every 10 seconds to:
 * 1. Check scheduler jobs — broadcast warnings, kick/lock, then execute action
 * 2. Check messenger messages — send RCON broadcasts at configured intervals
 *
 * Supported action types:
 *   restart      — Restart server via RCON (default)
 *   stop         — Stop the server (kill process)
 *   start        — Start the server if currently stopped
 *   update       — Trigger a manual game update via auto-updater
 *   backup       — Create a server backup
 *   rcon_command  — Execute an arbitrary RCON command
 *   webhook      — Fire a custom webhook event
 */
const logger = require('./logger');
const ctx = require('./context');
const { saveJSON } = require('./data-store');
const { addNotification, fireWebhooks } = require('./notifications');
const { addAudit } = require('./audit');

const VALID_ACTIONS = ['restart', 'stop', 'start', 'update', 'backup', 'rcon_command', 'webhook'];

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
 * Execute the configured action for a scheduler job.
 * Uses shared lifecycle functions for start/stop/restart.
 */
async function executeAction(actionType, job, server, state) {
  switch (actionType) {
    case 'restart':
    default: {
      const { restartServer } = require('./server-lifecycle');
      const result = await restartServer(server.id, `Scheduled: ${job.title}`);
      if (result.success) {
        logger.info({ serverId: server.id, job: job.title }, 'Scheduler: executed restart');
      } else {
        logger.error({ serverId: server.id, job: job.title, error: result.error }, 'Scheduler: restart failed');
        throw new Error(result.error || 'Restart failed');
      }
      break;
    }

    case 'stop': {
      const { stopServer } = require('./server-lifecycle');
      const result = await stopServer(server.id, `Scheduled: ${job.title}`);
      if (result.success) {
        logger.info({ serverId: server.id, job: job.title }, 'Scheduler: executed stop');
      } else {
        logger.error({ serverId: server.id, job: job.title, error: result.error }, 'Scheduler: stop failed');
        throw new Error(result.error || 'Stop failed');
      }
      break;
    }

    case 'start': {
      const { startServer } = require('./server-lifecycle');
      const result = await startServer(server.id, `Scheduled: ${job.title}`);
      if (result.success) {
        logger.info({ serverId: server.id, job: job.title }, 'Scheduler: executed start');
      } else {
        logger.error({ serverId: server.id, job: job.title, error: result.error }, 'Scheduler: start failed');
        throw new Error(result.error || 'Start failed');
      }
      break;
    }

    case 'update': {
      const { triggerManualUpdate } = require('./auto-updater');
      const result = triggerManualUpdate(server.id, 'game', {});
      if (!result.success) {
        logger.warn({ serverId: server.id, job: job.title, error: result.error }, 'Scheduler: update could not be triggered');
      } else {
        logger.info({ serverId: server.id, job: job.title }, 'Scheduler: executed update');
      }
      break;
    }

    case 'backup': {
      const { createBackup } = require('./backup-engine');
      const backupResult = await createBackup(server.id, 'automated');
      if (backupResult) {
        logger.info({ serverId: server.id, job: job.title, file: backupResult.filename }, 'Scheduler: executed backup');
      } else {
        logger.warn({ serverId: server.id, job: job.title }, 'Scheduler: backup returned null (may already be in progress)');
      }
      break;
    }

    case 'rcon_command': {
      const cmd = job.rconCommand;
      if (!cmd || typeof cmd !== 'string' || cmd.trim().length === 0) {
        logger.warn({ serverId: server.id, job: job.title }, 'Scheduler: rcon_command has no command configured');
        break;
      }
      state.rcon.command(cmd.trim());
      logger.info({ serverId: server.id, job: job.title, rconCommand: cmd.trim() }, 'Scheduler: executed rcon_command');
      break;
    }

    case 'webhook': {
      const eventName = job.webhookEvent || 'scheduler.custom';
      fireWebhooks(eventName, { serverId: server.id, serverName: server.name, trigger: 'scheduler', job: job.title, action: 'webhook' });
      logger.info({ serverId: server.id, job: job.title, event: eventName }, 'Scheduler: executed webhook');
      break;
    }
  }
}

/**
 * Process a single scheduler job — warnings, pre-actions, and execution.
 */
async function processJob(job, server, state) {
  if (!job.enabled) return;

  const minutesUntil = computeMinutesUntil(job, state);
  if (minutesUntil === Infinity) return;

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

  // ─── Pre-action steps (warnings, lock, kick) require RCON + running server ───
  if (state.rcon && state.status === 'running') {
    // Broadcast warnings
    const warningMinutes = [...(job.warningMinutes || [])].sort((a, b) => b - a);
    for (const warnMin of warningMinutes) {
      if (minutesUntil <= warnMin && !pending.warned.has(warnMin)) {
        const msg = (job.warningMessage || 'Server restart in {minutes} minute(s)!')
          .replace(/\{minutes\}/g, String(warnMin));
        try {
          const result = await state.rcon.say(msg);
          if (typeof result === 'string' && (result.startsWith('[Error]') || result === '[No response]')) {
            // RCON returned an error string instead of throwing — connection is likely stale
            logger.warn({ serverId: server.id, job: job.title, warning: warnMin, result }, 'Scheduler: warning broadcast failed — will retry next tick');
            state.rcon.loggedIn = false; // Force reconnect on next attempt
            break; // Stop trying more warnings this tick — RCON is down
          }
          pending.warned.add(warnMin);
          logger.info({ serverId: server.id, job: job.title, warning: warnMin }, 'Scheduler: broadcast warning');
        } catch (err) {
          logger.warn({ err, serverId: server.id }, 'Scheduler: failed to broadcast warning');
          // Don't mark as warned — retry on next tick
        }
      }
    }

    // Lock server
    if (job.lockServer && minutesUntil <= (job.lockMinutesBefore || 2) && !pending.locked) {
      try {
        const result = await state.rcon.lock();
        if (typeof result === 'string' && (result.startsWith('[Error]') || result === '[No response]')) {
          logger.warn({ serverId: server.id, result }, 'Scheduler: failed to lock server — will retry');
        } else {
          pending.locked = true;
          logger.info({ serverId: server.id, job: job.title }, 'Scheduler: locked server');
        }
      } catch (err) {
        logger.warn({ err }, 'Scheduler: failed to lock server');
      }
    }

    // Kick players
    if (job.kickPlayers && minutesUntil <= (job.kickMinutesBefore || 1) && !pending.kicked) {
      try {
        for (const player of (state.players || [])) {
          await state.rcon.kick(player.id || player.number, 'Server restarting');
        }
        pending.kicked = true;
        logger.info({ serverId: server.id, job: job.title, count: (state.players || []).length }, 'Scheduler: kicked players');
      } catch (err) {
        logger.warn({ err }, 'Scheduler: failed to kick players');
      }
    }
  }

  // ─── Execute action (works regardless of RCON/server status) ───
  if (minutesUntil <= 0) {
    const actionType = job.action || 'restart';

    try {
      await executeAction(actionType, job, server, state);

      // Update lastExecutedAt and persist
      job.lastExecutedAt = new Date().toISOString();
      saveJSON(ctx.CONFIG.dataDir, `scheduler-${server.id}.json`, { jobs: state.scheduler.jobs });

      // Notifications & audit
      const actionLabel = actionType.replace(/_/g, ' ');
      addNotification(server.id, 'scheduler.execute', `Scheduled ${actionLabel}`, `${job.title} executed (${actionLabel})`, 'info');
      addAudit('system', 'scheduler', 'scheduler.execute', `${job.title} [${actionLabel}] on ${server.name}`);

      // Fire scheduler.executed webhook for all action types
      try { fireWebhooks('scheduler.executed', { serverId: server.id, serverName: server.name, trigger: 'scheduler', job: job.title, action: actionType }); } catch (_) { /* ignore */ }

      // Emit socket event
      if (ctx.io) {
        ctx.io.emit('schedulerExecution', { serverId: server.id, jobId: job.id, title: job.title, action: actionType });
      }
    } catch (err) {
      logger.error({ err, serverId: server.id, job: job.title, action: actionType }, 'Scheduler: failed to execute action');
      addNotification(server.id, 'scheduler.error', 'Scheduler Error', `${job.title} failed: ${err.message}`, 'error');
    }

    // Clear pending state
    state.scheduler.pendingActions.delete(job.id);
  }
}

// ─── Messenger Logic ──────────────────────────────────

/**
 * Process messenger messages for a running server.
 */
async function processMessenger(server, state) {
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

      const result = await state.rcon.say(text);
      if (typeof result === 'string' && (result.startsWith('[Error]') || result === '[No response]')) {
        logger.warn({ serverId: server.id, msgId: msg.id, result }, 'Messenger: broadcast failed — RCON stale');
        state.rcon.loggedIn = false; // Force reconnect on next attempt
        break; // Stop trying more messages this tick
      }
      state.messenger.lastSent.set(msg.id, now);
      logger.debug({ serverId: server.id, msgId: msg.id }, 'Messenger: sent message');
    } catch (err) {
      logger.warn({ err, serverId: server.id, msgId: msg.id }, 'Messenger: failed to send');
    }
  }
}

// ─── Main Tick ────────────────────────────────────────

async function tick() {
  for (const server of ctx.servers) {
    const state = ctx.serverStates[server.id];
    if (!state) continue;

    // Process scheduler jobs (always — start/restart actions need to fire even if server is stopped)
    if (state.scheduler && state.scheduler.jobs) {
      for (const job of state.scheduler.jobs) {
        try {
          await processJob(job, server, state);
        } catch (err) {
          logger.error({ err, serverId: server.id, jobId: job.id }, 'Scheduler tick error');
        }
      }
    }

    // Process messenger (only when running — needs RCON)
    if (state.status === 'running') {
      try {
        await processMessenger(server, state);
      } catch (err) {
        logger.error({ err, serverId: server.id }, 'Messenger tick error');
      }
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

module.exports = { startSchedulerEngine, VALID_ACTIONS };
