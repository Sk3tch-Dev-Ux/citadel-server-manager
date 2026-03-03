/**
 * Scheduler routes — CRUD for scheduled jobs (per server).
 * Data model matches scheduler-engine.js expectations.
 * Persists to data/scheduler-{serverId}.json
 */
const { v4: uuid } = require('uuid');
const ctx = require('../lib/context');
const { authForServer } = require('../middleware/auth');
const requireLicense = require('../middleware/license');
const { saveJSON } = require('../lib/data-store');
const { addAudit } = require('../lib/audit');
const { VALID_ACTIONS } = require('../lib/scheduler-engine');

function getJobs(serverId) {
  const state = ctx.serverStates[serverId];
  return state?.scheduler?.jobs || [];
}

function persistJobs(serverId) {
  const jobs = getJobs(serverId);
  saveJSON(ctx.CONFIG.dataDir, `scheduler-${serverId}.json`, { jobs });
}

module.exports = function (app) {
  // ─── List all jobs ──────────────────────────────────────
  app.get('/api/servers/:id/scheduler', authForServer(), requireLicense(), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    res.json({ jobs: getJobs(req.params.id) });
  });

  // ─── Create a new job ──────────────────────────────────
  app.post('/api/servers/:id/scheduler', authForServer('server.restart'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const { title, hour, minute, action, rconCommand, webhookEvent, daysOfWeek, useUptime, warningMinutes, warningMessage, lockServer, lockMinutesBefore, kickPlayers, kickMinutesBefore } = req.body;

    if (!title || title.trim().length === 0) return res.status(400).json({ error: 'Title is required' });
    if (hour == null || minute == null) return res.status(400).json({ error: 'Hour and minute are required' });

    // Validate action type
    const resolvedAction = action || 'restart';
    if (!VALID_ACTIONS.includes(resolvedAction)) {
      return res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    // Validate rcon_command requires a command string
    if (resolvedAction === 'rcon_command' && (!rconCommand || typeof rconCommand !== 'string' || rconCommand.trim().length === 0)) {
      return res.status(400).json({ error: 'RCON command is required when action is rcon_command' });
    }

    const job = {
      id: uuid(),
      title: title.trim(),
      hour: Math.max(0, Math.min(23, parseInt(hour, 10) || 0)),
      minute: Math.max(0, Math.min(59, parseInt(minute, 10) || 0)),
      action: resolvedAction,
      rconCommand: resolvedAction === 'rcon_command' ? rconCommand.trim() : undefined,
      webhookEvent: resolvedAction === 'webhook' && webhookEvent ? webhookEvent.trim() : undefined,
      daysOfWeek: Array.isArray(daysOfWeek) ? daysOfWeek.filter(d => d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6],
      useUptime: !!useUptime,
      warningMinutes: Array.isArray(warningMinutes) ? warningMinutes.filter(m => m > 0).sort((a, b) => b - a) : [15, 10, 5, 1],
      warningMessage: warningMessage || 'Server restart in {minutes} minute(s)!',
      lockServer: !!lockServer,
      lockMinutesBefore: parseInt(lockMinutesBefore, 10) || 2,
      kickPlayers: !!kickPlayers,
      kickMinutesBefore: parseInt(kickMinutesBefore, 10) || 1,
      enabled: true,
      lastExecutedAt: null,
      createdAt: new Date().toISOString(),
    };

    if (!state.scheduler) state.scheduler = { jobs: [] };
    if (!state.scheduler.jobs) state.scheduler.jobs = [];
    state.scheduler.jobs.push(job);
    persistJobs(req.params.id);
    addAudit(req.user?.id || 'system', req.user?.username || 'system', 'job.create', `Created "${job.title}" on server ${req.params.id}`);
    res.json(job);
  });

  // ─── Update a job ──────────────────────────────────────
  app.put('/api/servers/:id/scheduler/:jobId', authForServer('server.restart'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const jobs = getJobs(req.params.id);
    const job = jobs.find(j => j.id === req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { title, hour, minute, action, rconCommand, webhookEvent, daysOfWeek, useUptime, warningMinutes, warningMessage, lockServer, lockMinutesBefore, kickPlayers, kickMinutesBefore, enabled } = req.body;

    // Validate action type if provided
    if (action !== undefined && !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    const resolvedAction = action !== undefined ? action : job.action;

    // Validate rcon_command requires a command string
    if (resolvedAction === 'rcon_command') {
      const cmd = rconCommand !== undefined ? rconCommand : job.rconCommand;
      if (!cmd || typeof cmd !== 'string' || cmd.trim().length === 0) {
        return res.status(400).json({ error: 'RCON command is required when action is rcon_command' });
      }
    }

    if (title !== undefined) job.title = title.trim();
    if (hour !== undefined) job.hour = Math.max(0, Math.min(23, parseInt(hour, 10) || 0));
    if (minute !== undefined) job.minute = Math.max(0, Math.min(59, parseInt(minute, 10) || 0));
    if (action !== undefined) job.action = action;
    if (rconCommand !== undefined) job.rconCommand = resolvedAction === 'rcon_command' ? rconCommand.trim() : undefined;
    if (webhookEvent !== undefined) job.webhookEvent = resolvedAction === 'webhook' && webhookEvent ? webhookEvent.trim() : undefined;
    if (daysOfWeek !== undefined) job.daysOfWeek = Array.isArray(daysOfWeek) ? daysOfWeek.filter(d => d >= 0 && d <= 6) : job.daysOfWeek;
    if (useUptime !== undefined) job.useUptime = !!useUptime;
    if (warningMinutes !== undefined) job.warningMinutes = Array.isArray(warningMinutes) ? warningMinutes.filter(m => m > 0).sort((a, b) => b - a) : job.warningMinutes;
    if (warningMessage !== undefined) job.warningMessage = warningMessage;
    if (lockServer !== undefined) job.lockServer = !!lockServer;
    if (lockMinutesBefore !== undefined) job.lockMinutesBefore = parseInt(lockMinutesBefore, 10) || 2;
    if (kickPlayers !== undefined) job.kickPlayers = !!kickPlayers;
    if (kickMinutesBefore !== undefined) job.kickMinutesBefore = parseInt(kickMinutesBefore, 10) || 1;
    if (enabled !== undefined) job.enabled = !!enabled;

    // Clean up fields that don't apply to the current action
    if (job.action !== 'rcon_command') delete job.rconCommand;
    if (job.action !== 'webhook') delete job.webhookEvent;

    persistJobs(req.params.id);
    addAudit(req.user?.id || 'system', req.user?.username || 'system', 'job.update', `Updated "${job.title}" on server ${req.params.id}`);
    res.json(job);
  });

  // ─── Toggle a job ──────────────────────────────────────
  app.patch('/api/servers/:id/scheduler/:jobId/toggle', authForServer('server.restart'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const jobs = getJobs(req.params.id);
    const job = jobs.find(j => j.id === req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    job.enabled = !job.enabled;
    persistJobs(req.params.id);
    res.json(job);
  });

  // ─── Delete a job ──────────────────────────────────────
  app.delete('/api/servers/:id/scheduler/:jobId', authForServer('server.restart'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });

    const jobs = getJobs(req.params.id);
    const idx = jobs.findIndex(j => j.id === req.params.jobId);
    if (idx === -1) return res.status(404).json({ error: 'Job not found' });

    const removed = jobs.splice(idx, 1)[0];
    persistJobs(req.params.id);
    addAudit(req.user?.id || 'system', req.user?.username || 'system', 'job.delete', `Deleted "${removed.title}" on server ${req.params.id}`);
    res.json({ message: 'Deleted', id: removed.id });
  });
};
