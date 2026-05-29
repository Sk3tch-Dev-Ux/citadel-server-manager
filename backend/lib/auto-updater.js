/**
 * Auto-Update Pipeline — State machine for the update-restart sequence.
 *
 * States: idle -> detected -> countdown -> stopping -> updating -> starting -> idle
 *
 * Triggered by:
 *   - Steam update polling (polling.js) when autoUpdateEnabled is true
 *   - Manual "Update Now" API endpoint (server-control.routes.js)
 *
 * Per-server config fields (on the server object):
 *   - autoUpdateEnabled     (boolean, default false)
 *   - updateCountdownSeconds (number, default 300)
 *   - updateWarningIntervals (array of minutes, default [5, 3, 1])
 */
const logger = require('./logger');
const ctx = require('./context');
const { killProcess, spawnDayZServer, detectProcessByPid } = require('./process-manager');
const { startSidecar, stopSidecar } = require('./sidecar-manager');
const { addLog } = require('./audit');
const { addNotification, sendDiscordWebhook, fireWebhooks } = require('./notifications');
const { executeHooks } = require('./lifecycle-hooks');
const { updateServerApp, updateWorkshopMod } = require('./steamcmd');
const { createBackup } = require('./backup-engine');
// polling.js is lazy-required below to avoid circular dependency (polling → auto-updater → polling)

// ─── Default Notification Configs ─────────────────────────
const DEFAULT_NOTIFICATIONS = {
  shutdown: {
    enabled: true, duration: 120, interval: 5,
    message: 'Server is restarting in {{countdown}} seconds',
    kickOnCountdown: false, lockOnCountdown: false,
  },
  gameUpdate: {
    enabled: true, duration: 120, interval: 5,
    message: 'Server is restarting in {{countdown}} seconds',
    kickOnCountdown: false, lockOnCountdown: false,
  },
  modUpdate: {
    enabled: true, duration: 120, interval: 5,
    message: 'Server is restarting in {{countdown}} seconds',
    kickOnCountdown: false, lockOnCountdown: false,
  },
};

/**
 * Resolve notification config for a given update type.
 * Falls back to legacy fields for backward compatibility.
 */
function getNotificationConfig(srv, updateType) {
  const configKey = updateType === 'game' ? 'gameUpdate'
                  : updateType === 'mod'  ? 'modUpdate'
                  : 'shutdown';
  const defaults = DEFAULT_NOTIFICATIONS[configKey];

  if (srv.notifications && srv.notifications[configKey]) {
    return { ...defaults, ...srv.notifications[configKey] };
  }

  // Legacy fallback: derive from old flat fields
  return {
    ...defaults,
    duration: srv.updateCountdownSeconds || defaults.duration,
    interval: Array.isArray(srv.updateWarningIntervals) && srv.updateWarningIntervals.length > 1
      ? (srv.updateWarningIntervals[0] - srv.updateWarningIntervals[1]) * 60
      : defaults.interval,
  };
}

/**
 * Format a countdown message by substituting placeholders.
 * {{countdown}} → human-readable time remaining
 * {{mod}} → mod name (for mod updates)
 */
function formatCountdownMessage(template, secondsRemaining, modName) {
  const countdown = secondsRemaining >= 60
    ? `${Math.ceil(secondsRemaining / 60)} minute${Math.ceil(secondsRemaining / 60) === 1 ? '' : 's'}`
    : `${secondsRemaining} second${secondsRemaining === 1 ? '' : 's'}`;
  return template
    .replace(/\{\{countdown\}\}/g, countdown)
    .replace(/\{\{mod\}\}/g, modName || '');
}

// ─── In-memory update state per server ───────────────────
const updateStates = new Map();

// ─── State Journal (Write-Ahead Log) for Atomicity ───────────
// Persists state transitions to disk for recovery on crashes
const fs = require('fs');
const path = require('path');

// Lazily resolved to use ctx.CONFIG.dataDir when available, with env fallback
function getStateJournalDir() {
  return path.join(ctx.CONFIG?.dataDir || process.env.CITADEL_DATA_DIR || 'data', 'state-journals');
}

/**
 * Ensure state journal directory exists.
 */
function ensureStateJournalDir() {
  try {
    if (!fs.existsSync(getStateJournalDir())) {
      fs.mkdirSync(getStateJournalDir(), { recursive: true });
      logger.debug({ dir: getStateJournalDir() }, 'Created state journal directory');
    }
  } catch (err) {
    logger.warn({ err, dir: getStateJournalDir() }, 'Failed to create state journal directory');
  }
}

/**
 * Get the state journal file path for a server.
 */
function getStateJournalPath(serverId) {
  return path.join(getStateJournalDir(), `${serverId}.journal.json`);
}

/**
 * Atomically write a state transition to the journal.
 * Uses temp file + rename pattern for atomicity.
 * Returns { success: boolean, error?: string }
 */
function journalStateTransition(serverId, newState, updateType, updateInfo) {
  try {
    ensureStateJournalDir();
    const journalPath = getStateJournalPath(serverId);
    const tempPath = journalPath + '.tmp';

    const entry = {
      serverId,
      timestamp: new Date().toISOString(),
      newState,
      updateType,
      updateInfo,
    };

    // Write to temp file first
    fs.writeFileSync(tempPath, JSON.stringify(entry, null, 2));

    // Atomic rename
    if (fs.existsSync(journalPath)) {
      fs.unlinkSync(journalPath);
    }
    fs.renameSync(tempPath, journalPath);

    logger.debug({ serverId, newState, journalPath }, 'State transition journaled');
    return { success: true };
  } catch (err) {
    logger.warn({ err, serverId }, 'Failed to journal state transition');
    return { success: false, error: err.message };
  }
}

/**
 * Read a state journal entry if it exists.
 * Returns the entry or null if not found.
 */
function readStateJournal(serverId) {
  try {
    const journalPath = getStateJournalPath(serverId);
    if (fs.existsSync(journalPath)) {
      const entry = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      logger.info({ serverId, state: entry.newState }, 'Recovered state from journal');
      return entry;
    }
  } catch (err) {
    logger.warn({ err, serverId }, 'Failed to read state journal');
  }
  return null;
}

/**
 * Clear the state journal after successful state transition.
 */
function clearStateJournal(serverId) {
  try {
    const journalPath = getStateJournalPath(serverId);
    if (fs.existsSync(journalPath)) {
      fs.unlinkSync(journalPath);
    }
  } catch (err) {
    logger.debug({ err, serverId }, 'Failed to clear state journal (non-critical)');
  }
}

/**
 * On startup, recover any interrupted state transitions.
 * If a journal exists, resume the update from that state.
 */
function recoverInterruptedUpdates() {
  try {
    ensureStateJournalDir();
    const files = fs.readdirSync(getStateJournalDir()).filter(f => f.endsWith('.journal.json'));
    for (const file of files) {
      const serverId = file.replace('.journal.json', '');
      const entry = readStateJournal(serverId);
      if (entry) {
        logger.info({ serverId, state: entry.newState }, 'Recovering interrupted update');
        // The update state will be restored by ensureState() which may pick up
        // the in-memory state. If the process crashed, in-memory is lost, so
        // we should resume from the journal entry.
        // For now, log recovery and let the server operator decide next steps.
        addLog(serverId, 'warn', 'updates', `Recovered interrupted update: state was ${entry.newState}`);
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to recover interrupted updates on startup');
  }
}

/**
 * Valid update types:
 *   'game'  — DayZ dedicated server app update
 *   'mod'   — Single workshop mod update
 */

/**
 * Get or create the default (idle) update state for a server.
 */
function ensureState(serverId) {
  if (!updateStates.has(serverId)) {
    updateStates.set(serverId, {
      state: 'idle',
      updateType: null,    // 'game' | 'mod'
      updateInfo: null,    // { modId, modName, build } depending on type
      countdown: 0,
      countdownTimer: null,
      warningTimers: [],
      startedAt: null,
      error: null,
      lockedDuringCountdown: false,
      kickedDuringCountdown: false,
    });
  }
  return updateStates.get(serverId);
}

/**
 * Emit the current update progress to all connected clients via Socket.IO.
 */
function emitProgress(serverId, extra) {
  const us = ensureState(serverId);
  if (ctx.io) {
    ctx.io.emit('updateProgress', {
      serverId,
      state: us.state,
      countdown: us.countdown,
      updateType: us.updateType,
      updateInfo: us.updateInfo,
      error: us.error,
      ...extra,
    });
  }
}

/**
 * Reset a server's update state back to idle, clearing all timers.
 */
function resetState(serverId) {
  const us = ensureState(serverId);
  if (us.countdownTimer) clearInterval(us.countdownTimer);
  for (const t of us.warningTimers) clearTimeout(t);
  us.state = 'idle';
  us.updateType = null;
  us.updateInfo = null;
  us.countdown = 0;
  us.countdownTimer = null;
  us.warningTimers = [];
  us.startedAt = null;
  us.error = null;
  us.lockedDuringCountdown = false;
  us.kickedDuringCountdown = false;

  // Clear state journal on transition back to idle
  clearStateJournal(serverId);
}

// ─── Public API ──────────────────────────────────────────

/**
 * Trigger an auto-update for a server (called from polling.js when an update is detected).
 * Only proceeds if autoUpdateEnabled is true and the server is not already updating.
 *
 * @param {string} serverId
 * @param {'game'|'mod'} updateType
 * @param {object} updateInfo - { modId, modName } for mod updates; { build } for game updates
 */
function triggerAutoUpdate(serverId, updateType, updateInfo) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return;
  if (!srv.autoUpdateEnabled) return;

  const us = ensureState(serverId);
  if (us.state !== 'idle') {
    logger.debug({ serverId, currentState: us.state }, 'Auto-update skipped — already in progress');
    return;
  }

  const state = ctx.serverStates[serverId];
  if (!state) return;

  logger.info({ serverId, updateType, updateInfo, server: srv.name }, 'Auto-update triggered');
  addLog(serverId, 'info', 'updates', `Auto-update triggered: ${updateType} update detected`);

  us.state = 'detected';
  us.updateType = updateType;
  us.updateInfo = updateInfo;
  us.startedAt = new Date().toISOString();

  // Journal this state transition for crash recovery
  journalStateTransition(serverId, 'detected', updateType, updateInfo);

  emitProgress(serverId);

  // If the server is running, go through the countdown phase
  // If the server is stopped/crashed, skip straight to updating
  if (state.status === 'running' || state.status === 'starting') {
    startCountdown(serverId);
  } else {
    runUpdatePhase(serverId);
  }
}

/**
 * Trigger a manual update (called from the API endpoint).
 * Bypasses autoUpdateEnabled check. Defaults to a game update.
 *
 * @param {string} serverId
 * @param {'game'|'mod'} [updateType='game']
 * @param {object} [updateInfo={}]
 * @returns {{ success: boolean, error?: string }}
 */
function triggerManualUpdate(serverId, updateType, updateInfo) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return { success: false, error: 'Server not found' };

  const us = ensureState(serverId);
  if (us.state !== 'idle') {
    return { success: false, error: `Update already in progress (state: ${us.state})` };
  }

  const state = ctx.serverStates[serverId];
  if (!state) return { success: false, error: 'Server state not initialized' };

  logger.info({ serverId, updateType, server: srv.name }, 'Manual update triggered');
  addLog(serverId, 'info', 'updates', `Manual update triggered: ${updateType || 'game'}`);

  us.state = 'detected';
  us.updateType = updateType || 'game';
  us.updateInfo = updateInfo || {};
  us.startedAt = new Date().toISOString();

  // Journal this state transition for crash recovery
  journalStateTransition(serverId, 'detected', us.updateType, us.updateInfo);

  emitProgress(serverId);

  // If the server is running, go through countdown; otherwise skip to update
  if (state.status === 'running' || state.status === 'starting') {
    startCountdown(serverId);
  } else {
    runUpdatePhase(serverId);
  }

  return { success: true };
}

/**
 * Get the current update state for a server.
 *
 * @param {string} serverId
 * @returns {object} Current update state
 */
function getUpdateState(serverId) {
  const us = ensureState(serverId);
  return {
    state: us.state,
    updateType: us.updateType,
    updateInfo: us.updateInfo,
    countdown: us.countdown,
    startedAt: us.startedAt,
    error: us.error,
  };
}

/**
 * Cancel a pending update countdown.
 * Only works during 'detected' or 'countdown' phases.
 *
 * @param {string} serverId
 * @returns {{ success: boolean, error?: string }}
 */
function cancelUpdate(serverId) {
  const us = ensureState(serverId);
  if (us.state !== 'detected' && us.state !== 'countdown') {
    return { success: false, error: `Cannot cancel in state: ${us.state}` };
  }

  // Capture lock state before reset clears it
  const wasLocked = us.lockedDuringCountdown;

  logger.info({ serverId }, 'Update cancelled');
  addLog(serverId, 'info', 'updates', 'Update cancelled by user');

  resetState(serverId);
  emitProgress(serverId);

  // Unlock server if it was locked for the countdown
  if (wasLocked) {
    const state = ctx.serverStates[serverId];
    if (state?.rcon?.loggedIn) {
      state.rcon.unlock().catch(() => {});
      addLog(serverId, 'info', 'updates', 'Server unlocked after update cancellation');
    }
  }

  return { success: true };
}

// ─── Internal Phase Handlers ─────────────────────────────

/**
 * Send an RCON message, reconnecting if needed. Returns true on success.
 */
async function rconSay(state, serverId, msg) {
  try {
    if (!state?.rcon) return false;
    if (!state.rcon.loggedIn) {
      try { await state.rcon.connect(); } catch { return false; }
    }
    const result = await state.rcon.say(msg);
    if (typeof result === 'string' && (result.startsWith('[Error]') || result === '[No response]')) {
      state.rcon.loggedIn = false;
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Kick all connected players via RCON. Returns number of kicks attempted.
 */
async function kickAllPlayers(state, serverId, reason) {
  if (!state?.rcon?.loggedIn) return 0;
  const playersCopy = [...(state.players || [])];
  let kicked = 0;
  for (const player of playersCopy) {
    const rconId = player.rconSlot != null ? String(player.rconSlot) : (player.id || player.index);
    if (rconId !== undefined) {
      try { await state.rcon.kick(rconId, reason || 'Server updating'); kicked++; } catch { /* player may have left */ }
    }
  }
  if (kicked > 0) await new Promise(r => setTimeout(r, 2000)); // give RCON time to process
  return kicked;
}

/**
 * Start the countdown phase: broadcast RCON warnings at configured intervals,
 * optionally lock the server and kick players, then proceed to stopping phase.
 */
function startCountdown(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return;

  const us = ensureState(serverId);
  const notifConfig = getNotificationConfig(srv, us.updateType);
  const countdownSeconds = notifConfig.duration || 120;
  const broadcastInterval = notifConfig.interval || 5;
  const messageTemplate = notifConfig.message || DEFAULT_NOTIFICATIONS.shutdown.message;
  const modName = us.updateInfo?.modName || '';

  us.state = 'countdown';
  us.countdown = countdownSeconds;
  emitProgress(serverId);

  addLog(serverId, 'info', 'updates', `Update countdown started: ${countdownSeconds}s (broadcast every ${broadcastInterval}s)`);

  const state = ctx.serverStates[serverId];

  // Lock server if configured
  if (notifConfig.lockOnCountdown && state?.rcon) {
    (async () => {
      try {
        if (!state.rcon.loggedIn) {
          try { await state.rcon.connect(); } catch { return; }
        }
        await state.rcon.lock();
        us.lockedDuringCountdown = true;
        addLog(serverId, 'info', 'updates', 'Server locked for update countdown');
      } catch (err) {
        logger.debug({ err, serverId }, 'Failed to lock server during countdown');
      }
    })();
  }

  // Send immediate first broadcast
  if (countdownSeconds > 0) {
    const msg = formatCountdownMessage(messageTemplate, countdownSeconds, modName);
    rconSay(state, serverId, msg).then(ok => {
      if (ok) addLog(serverId, 'info', 'updates', `RCON broadcast: ${msg}`);
    });
  }

  // Tick the countdown every second
  us.countdownTimer = setInterval(() => {
    us.countdown -= 1;

    // Broadcast at regular intervals
    if (us.countdown > 0 && us.countdown % broadcastInterval === 0) {
      const msg = formatCountdownMessage(messageTemplate, us.countdown, modName);
      rconSay(state, serverId, msg).then(ok => {
        if (ok) addLog(serverId, 'info', 'updates', `RCON broadcast: ${msg}`);
      });
    }

    // Emit progress every 10 seconds to avoid flooding (and always at <= 10)
    if (us.countdown % 10 === 0 || us.countdown <= 10) {
      emitProgress(serverId);
    }

    if (us.countdown <= 0) {
      clearInterval(us.countdownTimer);
      us.countdownTimer = null;
      // Final actions at countdown end
      (async () => {
        // Final RCON broadcast
        const finalMsg = formatCountdownMessage(messageTemplate, 0, modName);
        await rconSay(state, serverId, finalMsg);

        // Kick all players if configured
        if (notifConfig.kickOnCountdown) {
          const kicked = await kickAllPlayers(state, serverId, 'Server updating');
          if (kicked > 0) {
            us.kickedDuringCountdown = true;
            addLog(serverId, 'info', 'updates', `Kicked ${kicked} player(s) at countdown end`);
          }
        }

        // Proceed to stopping phase
        stopAndUpdate(serverId);
      })();
    }
  }, 1000);
}

/**
 * Stop the server, then run the update.
 * Handles the 'stopping' -> 'updating' transition.
 */
async function stopAndUpdate(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) { resetState(serverId); return; }

  const us = ensureState(serverId);
  const state = ctx.serverStates[serverId];
  if (!state) { resetState(serverId); return; }

  // ── Stopping Phase ──
  us.state = 'stopping';
  emitProgress(serverId);
  addLog(serverId, 'info', 'updates', 'Stopping server for update...');
  state.status = 'stopping';
  if (ctx.io) ctx.io.emit('serverStatus', { serverId, status: 'stopping' });

  try {
    // Kick all connected players via RCON (skip if already kicked during countdown)
    if (!us.kickedDuringCountdown && state.rcon?.loggedIn) {
      const kicked = await kickAllPlayers(state, serverId, 'Server updating');
      if (kicked > 0) addLog(serverId, 'info', 'updates', `Kicked ${kicked} player(s) before stopping`);
    }

    // Kill the process
    stopSidecar(serverId);
    if (state.pid) {
      await killProcess(state.pid, srv.executable);
    }
    state.pid = null;
    state.process = null;
    state.players = [];
    state.startedAt = null;
    state.status = 'stopped';
    if (ctx.io) ctx.io.emit('serverStatus', { serverId, status: 'stopped' });
    if (ctx.io) ctx.io.emit('players', { serverId, players: [] });

    // Execute stopped lifecycle hooks
    await executeHooks(serverId, 'stopped').catch(() => {});

    addLog(serverId, 'info', 'updates', 'Server stopped for update');
  } catch (err) {
    logger.error({ err, serverId }, 'Failed to stop server for update');
    addLog(serverId, 'error', 'updates', `Failed to stop server: ${err.message}`);
    // Try to force-stop
    try {
      stopSidecar(serverId);
      if (state.pid) await killProcess(state.pid, srv.executable).catch(() => {});
    } catch { /* best effort */ }
    state.pid = null;
    state.process = null;
    state.players = [];
    state.status = 'stopped';
    if (ctx.io) ctx.io.emit('serverStatus', { serverId, status: 'stopped' });
  }

  // Proceed to update phase
  await runUpdatePhase(serverId);
}

/**
 * Run the SteamCMD update. This is the 'updating' phase.
 * On success, proceeds to the 'starting' phase.
 * On failure, logs the error, fires notification, and returns to idle (server stays stopped).
 */
async function runUpdatePhase(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) { resetState(serverId); return; }

  const us = ensureState(serverId);

  us.state = 'updating';
  emitProgress(serverId);
  addLog(serverId, 'info', 'updates', `Running ${us.updateType} update via SteamCMD...`);

  // ── Pre-Update Backup (for rollback on failure) ──
  // CRITICAL: If backup fails, abort the update entirely
  let preUpdateBackup = null;
  try {
    addLog(serverId, 'info', 'updates', 'Creating pre-update backup...');
    emitProgress(serverId, { message: 'Creating pre-update backup...' });
    preUpdateBackup = await createBackup(serverId, 'automated');
    if (preUpdateBackup) {
      addLog(serverId, 'info', 'updates', `Pre-update backup created: ${preUpdateBackup.filename}`);
    } else {
      addLog(serverId, 'warn', 'updates', 'Pre-update backup skipped (no paths configured or backup in progress)');
    }
  } catch (backupErr) {
    // Backup failed — abort the update entirely
    logger.error({ err: backupErr, serverId }, 'Pre-update backup failed — aborting update');
    addLog(serverId, 'error', 'updates', `CRITICAL: Pre-update backup failed: ${backupErr.message} — update aborted to prevent data loss`);
    addNotification(serverId, 'update.backup_failed', 'Update Aborted', `${srv.name}: Backup creation failed, update aborted for safety`, 'error');
    sendDiscordWebhook(`❌ **${srv.name}** update aborted — backup creation failed: ${backupErr.message}`);

    us.state = 'backup_failed';
    us.error = backupErr.message;
    emitProgress(serverId);
    journalStateTransition(serverId, 'backup_failed', us.updateType, us.updateInfo);

    // Reset to idle so auto-updates can trigger again on the next poll cycle
    resetState(serverId);
    emitProgress(serverId);
    return;
  }

  try {
    if (us.updateType === 'game') {
      await updateServerApp(serverId, srv.installDir);
      addLog(serverId, 'info', 'updates', 'Game update completed successfully');
    } else if (us.updateType === 'mod' && us.updateInfo?.modId) {
      await updateWorkshopMod(serverId, srv.installDir, us.updateInfo.modId);
      addLog(serverId, 'info', 'updates', `Mod update completed: ${us.updateInfo.modName || us.updateInfo.modId}`);
      // Clear the pending mod update tracker (lazy require to avoid circular dep)
      require('./polling').clearPendingModUpdate(us.updateInfo.modId);
    } else {
      throw new Error(`Unknown update type: ${us.updateType}`);
    }

    emitProgress(serverId, { message: 'Update complete, starting server...' });

    // Fire appropriate webhooks
    if (us.updateType === 'game') {
      fireWebhooks('title.updated', { serverId, serverName: srv.name, build: us.updateInfo?.build || 'latest' });
      addNotification(serverId, 'update.available', 'Game Updated', `${srv.name} game files updated`, 'success');
      sendDiscordWebhook(`🆕 **${srv.name}** game updated and restarting`);
    } else {
      fireWebhooks('mod.updated', { serverId, serverName: srv.name, modName: us.updateInfo?.modName || '' });
      addNotification(serverId, 'mod.updated', 'Mod Updated', `${srv.name}: mod ${us.updateInfo?.modName || us.updateInfo?.modId} updated`, 'success');
      sendDiscordWebhook(`📦 **${srv.name}** mod updated: ${us.updateInfo?.modName || us.updateInfo?.modId}`);
    }

    // Journal state transition to 'verifying' before starting
    journalStateTransition(serverId, 'verifying', us.updateType, us.updateInfo);

    // Proceed to starting phase (pass backup for auto-rollback capability)
    await runStartPhase(serverId, preUpdateBackup);

  } catch (err) {
    logger.error({ err, serverId }, 'Update failed');
    addLog(serverId, 'error', 'updates', `Update failed: ${err.message}`);

    // ── Rollback: restore pre-update backup if available ──
    if (preUpdateBackup) {
      try {
        addLog(serverId, 'info', 'updates', `Rolling back: restoring pre-update backup ${preUpdateBackup.filename}...`);
        addNotification(serverId, 'update.rollback', 'Rolling Back Update', `${srv.name}: restoring from pre-update backup`, 'warning');
        emitProgress(serverId, { message: 'Update failed — rolling back...' });
        const { restoreBackup } = require('./backup-engine');
        const result = await restoreBackup(serverId, preUpdateBackup.filename, 'automated');
        if (result.success) {
          addLog(serverId, 'info', 'updates', 'Rollback successful — server files restored to pre-update state');
          addNotification(serverId, 'update.rollback', 'Rollback Complete', `${srv.name}: rolled back to pre-update state`, 'success');
          sendDiscordWebhook(`🔄 **${srv.name}** update failed — rolled back to pre-update state`);
        } else {
          addLog(serverId, 'error', 'updates', `Rollback failed: ${result.error}`);
          sendDiscordWebhook(`⚠️ **${srv.name}** update AND rollback failed: ${result.error}`);
        }
      } catch (rollbackErr) {
        addLog(serverId, 'error', 'updates', `Rollback error: ${rollbackErr.message}`);
        sendDiscordWebhook(`⚠️ **${srv.name}** update AND rollback failed: ${rollbackErr.message}`);
      }
    }

    addNotification(serverId, 'update.available', 'Update Failed', `${srv.name}: ${err.message}`, 'error');
    fireWebhooks('server.crashed', { serverId, serverName: srv.name, reason: `Update failed: ${err.message}` });
    sendDiscordWebhook(`❌ **${srv.name}** update failed: ${err.message}`);

    us.error = err.message;
    us.state = 'idle';
    emitProgress(serverId);
    resetState(serverId);
    // Server stays stopped — operator must intervene
  }
}

/**
 * Start the server after a successful update. This is the 'starting' phase.
 * Uses the same spawn logic as server-lifecycle.js.
 * If start fails within 60 seconds, automatically triggers rollback.
 */
async function runStartPhase(serverId, preUpdateBackup = null) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) { resetState(serverId); return; }

  const us = ensureState(serverId);
  const state = ctx.serverStates[serverId];
  if (!state) { resetState(serverId); return; }

  us.state = 'starting';
  journalStateTransition(serverId, 'starting', us.updateType, us.updateInfo);
  emitProgress(serverId);
  addLog(serverId, 'info', 'updates', 'Starting server after update...');

  try {
    // Execute pre-start lifecycle hooks
    const preStartResult = await executeHooks(serverId, 'pre-start');
    if (!preStartResult.success) {
      const hookError = `Pre-start hook aborted post-update start: ${preStartResult.hook}`;
      addLog(serverId, 'warn', 'updates', hookError);
      addNotification(serverId, 'server.crashed', 'Post-Update Start Blocked', `${srv.name}: ${hookError}`, 'warning');
      us.error = hookError;
      resetState(serverId);
      return;
    }

    state.status = 'starting';
    ctx.io.emit('serverStatus', { serverId, status: 'starting' });

    const { child, launchFailed } = spawnDayZServer(srv);
    state.process = child;
    state.pid = child.pid;

    // Wait for the launch monitor (10s grace period)
    const failReason = await launchFailed;
    if (failReason) {
      throw new Error(`Server failed to start after update: ${failReason}`);
    }

    // ── Post-Start Verification (60s grace period) ──
    // If the process dies within 60 seconds of starting, trigger automatic rollback
    const startTime = Date.now();
    const verificationPromise = new Promise(resolve => {
      const checkInterval = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        const stillAlive = await detectProcessByPid(child.pid).catch(() => false);

        if (elapsed >= 60000) {
          // 60 seconds passed — process survived, update is good
          clearInterval(checkInterval);
          resolve('success');
        } else if (!stillAlive) {
          // Process died too soon — trigger rollback
          clearInterval(checkInterval);
          resolve('failure');
        }
      }, 2000); // Check every 2 seconds
    });

    const verificationResult = await verificationPromise;

    if (verificationResult === 'failure') {
      throw new Error('Server process crashed shortly after starting (within 60s) — triggering automatic rollback');
    }

    const alive = await detectProcessByPid(child.pid);
    if (alive) {
      state.pid = child.pid;
      state.status = 'running';
      state.startedAt = new Date().toISOString();
      ctx.io.emit('serverStatus', { serverId, status: 'running' });

      addLog(serverId, 'info', 'updates', `Server started after update (PID: ${child.pid})`);
      addNotification(serverId, 'server.restarted', 'Server Updated & Restarted', `${srv.name} updated and back online`, 'success');
      fireWebhooks('server.restarted', { serverId, serverName: srv.name, reason: `${us.updateType} update` });
      sendDiscordWebhook(`🔄 **${srv.name}** updated and back online`);

      startSidecar(srv);

      // Fire started hooks (non-blocking)
      executeHooks(serverId, 'started').catch(() => {});

      // Clear state journal on successful completion
      clearStateJournal(serverId);
    } else {
      throw new Error('Process not detected after spawn');
    }

  } catch (err) {
    logger.error({ err, serverId }, 'Post-update server start failed');
    addLog(serverId, 'error', 'updates', `Post-update start failed: ${err.message}`);

    // ── Auto-Rollback on Start Failure ──
    if (preUpdateBackup && err.message.includes('crashed shortly after starting')) {
      try {
        addLog(serverId, 'info', 'updates', 'Triggering automatic rollback due to start failure...');
        addNotification(serverId, 'update.rollback', 'Auto-Rollback Triggered', `${srv.name}: Starting rolled back to pre-update state`, 'warning');
        emitProgress(serverId, { message: 'Server crashed after update — rolling back automatically...' });

        const { restoreBackup } = require('./backup-engine');
        const result = await restoreBackup(serverId, preUpdateBackup.filename, 'automated');

        if (result.success) {
          addLog(serverId, 'info', 'updates', 'Rollback successful — server files restored to pre-update state');
          addNotification(serverId, 'update.rollback', 'Rollback Complete', `${srv.name}: rolled back to pre-update state`, 'success');
          sendDiscordWebhook(`🔄 **${srv.name}** auto-rolled back: server crashed after update`);
          us.state = 'rollback_complete';
        } else {
          addLog(serverId, 'error', 'updates', `Auto-rollback failed: ${result.error}`);
          sendDiscordWebhook(`⚠️ **${srv.name}** update AND auto-rollback failed: ${result.error}`);
        }
      } catch (rollbackErr) {
        addLog(serverId, 'error', 'updates', `Auto-rollback error: ${rollbackErr.message}`);
        sendDiscordWebhook(`⚠️ **${srv.name}** auto-rollback failed: ${rollbackErr.message}`);
      }
    } else {
      addNotification(serverId, 'server.crashed', 'Post-Update Start Failed', `${srv.name}: ${err.message}`, 'error');
    }

    state.status = 'crashed';
    state.pid = null;
    state.process = null;
    ctx.io.emit('serverStatus', { serverId, status: 'crashed' });
  }

  // Always return to idle regardless of outcome
  resetState(serverId);
  emitProgress(serverId);
}

/**
 * Initialize the auto-updater module.
 * Should be called once on application startup to recover any interrupted updates.
 */
function initAutoUpdater() {
  recoverInterruptedUpdates();
}

module.exports = {
  triggerAutoUpdate,
  triggerManualUpdate,
  getUpdateState,
  cancelUpdate,
  initAutoUpdater,
  recoverInterruptedUpdates,
  getNotificationConfig,
  DEFAULT_NOTIFICATIONS,
  // Exported for testing the write-ahead journal in isolation.
  journalStateTransition,
  readStateJournal,
  clearStateJournal,
  getStateJournalPath,
  formatCountdownMessage,
};
