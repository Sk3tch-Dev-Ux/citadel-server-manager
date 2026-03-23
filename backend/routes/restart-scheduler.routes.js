/**
 * Restart Scheduler API routes.
 *
 * Endpoints:
 *   GET    /api/servers/:id/restart-schedule          — Get schedule config
 *   PUT    /api/servers/:id/restart-schedule          — Create/update schedule
 *   DELETE /api/servers/:id/restart-schedule          — Delete schedule
 *   POST   /api/servers/:id/restart-schedule/toggle   — Enable/disable
 *   GET    /api/servers/:id/restart-schedule/status    — Live status + countdown
 *   POST   /api/servers/:id/restart-schedule/skip      — Skip next restart
 *   POST   /api/servers/:id/restart-schedule/trigger   — Trigger restart now
 */
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const scheduler = require('../lib/restart-scheduler');

module.exports = function (app) {

  // ─── GET schedule ───────────────────────────────────────
  app.get('/api/servers/:id/restart-schedule', authForServer(), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const schedule = scheduler.getSchedule(req.params.id);
    res.json({ schedule: schedule || null });
  });

  // ─── PUT create/update schedule ─────────────────────────
  app.put('/api/servers/:id/restart-schedule', authForServer('scheduler.manage'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { type, intervalHours, dailyTimes, oneTimeDate, warnings, enabled } = req.body;

    // Validate type
    if (type && !['interval', 'daily', 'onetime'].includes(type)) {
      return res.status(400).json({ error: 'Invalid schedule type. Must be interval, daily, or onetime.' });
    }

    // Validate interval hours
    if (type === 'interval' && intervalHours !== undefined) {
      const hours = Number(intervalHours);
      if (isNaN(hours) || hours < 0.5 || hours > 168) {
        return res.status(400).json({ error: 'Interval hours must be between 0.5 and 168.' });
      }
    }

    // Validate daily times format
    if (type === 'daily' && dailyTimes) {
      if (!Array.isArray(dailyTimes) || dailyTimes.length === 0) {
        return res.status(400).json({ error: 'Daily times must be a non-empty array of HH:MM strings.' });
      }
      const timeRe = /^\d{1,2}:\d{2}$/;
      for (const t of dailyTimes) {
        if (!timeRe.test(t)) {
          return res.status(400).json({ error: `Invalid time format: "${t}". Use HH:MM.` });
        }
      }
    }

    // Validate one-time date
    if (type === 'onetime' && oneTimeDate) {
      const d = new Date(oneTimeDate);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid one-time date.' });
      }
      if (d <= new Date()) {
        return res.status(400).json({ error: 'One-time date must be in the future.' });
      }
    }

    // Validate warnings
    if (warnings) {
      if (!Array.isArray(warnings)) {
        return res.status(400).json({ error: 'Warnings must be an array.' });
      }
      for (const w of warnings) {
        if (typeof w.minutesBefore !== 'number' || w.minutesBefore < 0) {
          return res.status(400).json({ error: 'Each warning must have a valid minutesBefore value.' });
        }
        if (!w.message || typeof w.message !== 'string') {
          return res.status(400).json({ error: 'Each warning must have a message string.' });
        }
      }
    }

    const schedule = scheduler.setSchedule(req.params.id, {
      type, intervalHours, dailyTimes, oneTimeDate, warnings, enabled,
    });

    addAudit(req.user.id, req.user.username, 'scheduler.update',
      `Updated restart schedule for ${srv.name}: ${type || 'interval'}, enabled=${schedule.enabled}`);

    res.json({ schedule });
  });

  // ─── DELETE schedule ────────────────────────────────────
  app.delete('/api/servers/:id/restart-schedule', authForServer('scheduler.manage'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    scheduler.deleteSchedule(req.params.id);
    addAudit(req.user.id, req.user.username, 'scheduler.delete',
      `Deleted restart schedule for ${srv.name}`);

    res.json({ message: 'Schedule deleted' });
  });

  // ─── POST toggle ────────────────────────────────────────
  app.post('/api/servers/:id/restart-schedule/toggle', authForServer('scheduler.manage'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const schedule = scheduler.toggleSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'No schedule configured for this server' });

    addAudit(req.user.id, req.user.username, 'scheduler.toggle',
      `${schedule.enabled ? 'Enabled' : 'Disabled'} restart schedule for ${srv.name}`);

    res.json({ schedule });
  });

  // ─── GET status ─────────────────────────────────────────
  app.get('/api/servers/:id/restart-schedule/status', authForServer(), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const status = scheduler.getStatus(req.params.id);
    res.json(status);
  });

  // ─── POST skip ──────────────────────────────────────────
  app.post('/api/servers/:id/restart-schedule/skip', authForServer('scheduler.manage'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const schedule = scheduler.skipNext(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'No active schedule to skip' });

    addAudit(req.user.id, req.user.username, 'scheduler.skip',
      `Skipped next scheduled restart for ${srv.name}`);

    res.json({ schedule, message: 'Next restart skipped' });
  });

  // ─── POST trigger ──────────────────────────────────────
  app.post('/api/servers/:id/restart-schedule/trigger', authForServer('server.restart'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { delayMinutes = 0 } = req.body || {};

    addAudit(req.user.id, req.user.username, 'scheduler.trigger',
      `Triggered manual restart for ${srv.name} (delay: ${delayMinutes}m)`);

    const result = await scheduler.triggerRestart(
      req.params.id,
      Number(delayMinutes) || 0,
      `manual by ${req.user.username}`
    );

    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(500).json({ error: result.error });
    }
  });
};
