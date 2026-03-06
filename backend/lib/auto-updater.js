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

// ─── In-memory update state per server ───────────────────
const updateStates = new Map();

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

  logger.info({ serverId }, 'Update cancelled');
  addLog(serverId, 'info', 'updates', 'Update cancelled by user');

  resetState(serverId);
  emitProgress(serverId);
  return { success: true };
}

// ─── Internal Phase Handlers ─────────────────────────────

/**
 * Start the countdown phase: broadcast RCON warnings at configured intervals,
 * then proceed to the stopping phase when countdown reaches zero.
 */
function startCountdown(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return;

  const us = ensureState(serverId);
  const countdownSeconds = srv.updateCountdownSeconds || 300;
  const warningIntervals = Array.isArray(srv.updateWarningIntervals)
    ? srv.updateWarningIntervals
    : [5, 3, 1];

  us.state = 'countdown';
  us.countdown = countdownSeconds;
  emitProgress(serverId);

  addLog(serverId, 'info', 'updates', `Update countdown started: ${countdownSeconds}s`);

  // Schedule RCON warning broadcasts
  const state = ctx.serverStates[serverId];
  for (const minutesBefore of warningIntervals) {
    const secondsBefore = minutesBefore * 60;
    if (secondsBefore >= countdownSeconds) continue; // skip if warning would be before countdown starts

    const delayMs = (countdownSeconds - secondsBefore) * 1000;
    const timer = setTimeout(async () => {
      try {
        if (!state?.rcon) return;
        // Attempt reconnect if RCON is stale
        if (!state.rcon.loggedIn) {
          try { await state.rcon.connect(); } catch { return; }
        }
        const msg = `Server restarting for update in ${minutesBefore} minute${minutesBefore === 1 ? '' : 's'}`;
        const result = await state.rcon.say(msg);
        if (typeof result === 'string' && (result.startsWith('[Error]') || result === '[No response]')) {
          logger.warn({ serverId, minutesBefore, result }, 'Update RCON warning failed — connection stale');
          state.rcon.loggedIn = false;
        } else {
          addLog(serverId, 'info', 'updates', `RCON broadcast: ${msg}`);
        }
      } catch (err) {
        logger.debug({ err, serverId }, 'RCON warning broadcast failed');
      }
    }, delayMs);
    us.warningTimers.push(timer);
  }

  // Also send an immediate warning if countdown is long enough
  if (countdownSeconds >= 60) {
    const minutes = Math.ceil(countdownSeconds / 60);
    (async () => {
      try {
        if (!state?.rcon) return;
        if (!state.rcon.loggedIn) {
          try { await state.rcon.connect(); } catch { return; }
        }
        const msg = `Server restarting for update in ${minutes} minute${minutes === 1 ? '' : 's'}`;
        const result = await state.rcon.say(msg);
        if (typeof result === 'string' && (result.startsWith('[Error]') || result === '[No response]')) {
          logger.warn({ serverId, result }, 'Update initial RCON warning failed — connection stale');
          state.rcon.loggedIn = false;
        } else {
          addLog(serverId, 'info', 'updates', `RCON broadcast: ${msg}`);
        }
      } catch (err) {
        logger.debug({ err, serverId }, 'RCON initial warning broadcast failed');
      }
    })();
  }

  // Tick the countdown every second
  us.countdownTimer = setInterval(() => {
    us.countdown -= 1;
    // Emit progress every 10 seconds to avoid flooding (and always at 0)
    if (us.countdown % 10 === 0 || us.countdown <= 10) {
      emitProgress(serverId);
    }
    if (us.countdown <= 0) {
      clearInterval(us.countdownTimer);
      us.countdownTimer = null;
      // Final RCON warning
      (async () => {
        try {
          if (state?.rcon) {
            if (!state.rcon.loggedIn) {
              try { await state.rcon.connect(); } catch { /* best effort */ }
            }
            if (state.rcon.loggedIn) {
              const result = await state.rcon.say('Server restarting NOW for update');
              if (typeof result === 'string' && (result.startsWith('[Error]') || result === '[No response]')) {
                state.rcon.loggedIn = false;
              }
            }
          }
        } catch { /* best effort */ }
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
  ctx.io.emit('serverStatus', { serverId, status: 'stopping' });

  try {
    // Kick all connected players via RCON
    if (state.rcon?.loggedIn) {
      try {
        // Kick all players — RCON "kick" with #-prefix triggers a mass-kick
        // Use individual kicks based on player list for reliability
        if (state.players && state.players.length > 0) {
          for (const player of state.players) {
            // Use BattlEye slot number for reliable RCON kick with reason display
            const rconId = player.rconSlot != null ? String(player.rconSlot) : (player.id || player.index);
            if (rconId !== undefined) {
              await state.rcon.kick(rconId, 'Server updating');
            }
          }
        }
        // Give RCON a moment to process kicks
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        logger.debug({ err, serverId }, 'RCON kick-all failed during update stop');
      }
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
    ctx.io.emit('serverStatus', { serverId, status: 'stopped' });
    ctx.io.emit('players', { serverId, players: [] });

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
    ctx.io.emit('serverStatus', { serverId, status: 'stopped' });
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
    addLog(serverId, 'warn', 'updates', `Pre-update backup failed: ${backupErr.message} — proceeding with update`);
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

    // Proceed to starting phase
    await runStartPhase(serverId);

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
 */
async function runStartPhase(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) { resetState(serverId); return; }

  const us = ensureState(serverId);
  const state = ctx.serverStates[serverId];
  if (!state) { resetState(serverId); return; }

  us.state = 'starting';
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
    } else {
      throw new Error('Process not detected after spawn');
    }

  } catch (err) {
    logger.error({ err, serverId }, 'Post-update server start failed');
    addLog(serverId, 'error', 'updates', `Post-update start failed: ${err.message}`);
    addNotification(serverId, 'server.crashed', 'Post-Update Start Failed', `${srv.name}: ${err.message}`, 'error');
    state.status = 'crashed';
    state.pid = null;
    state.process = null;
    ctx.io.emit('serverStatus', { serverId, status: 'crashed' });
  }

  // Always return to idle regardless of outcome
  resetState(serverId);
  emitProgress(serverId);
}

module.exports = { triggerAutoUpdate, triggerManualUpdate, getUpdateState, cancelUpdate };
