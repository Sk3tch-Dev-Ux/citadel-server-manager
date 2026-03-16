/**
 * Server logs, console output, and metrics routes.
 */
const ctx = require('../lib/context');
const { authForServer } = require('../middleware/auth');
const { getConsoleBuffer } = require('../lib/rpt-tailer');

module.exports = function(app) {
  // System logs (lifecycle events: start, stop, health, updates)
  app.get('/api/servers/:id/logs', authForServer('logs.view'), (req, res) => {
    const { level, source, limit = 200 } = req.query;
    let logs = ctx.serverStates[req.params.id]?.logs || [];
    if (level) logs = logs.filter(l => l.level === level);
    if (source) logs = logs.filter(l => l.source === source);
    res.json(logs.slice(0, parseInt(limit)));
  });

  // Server console output (DayZ stdout from server_console.log)
  app.get('/api/servers/:id/console', authForServer('logs.view'), (req, res) => {
    const limit = parseInt(req.query.limit) || 500;
    const buf = getConsoleBuffer(req.params.id);
    res.json(buf.slice(-limit).reverse());
  });

  app.get('/api/servers/:id/metrics', authForServer('metrics.view'), (req, res) => {
    res.json(ctx.serverStates[req.params.id]?.metricsHistory || { cpu: [], ram: [], players: [], fps: [], timestamps: [] });
  });

  app.get('/api/servers/:id/metrics/stream', authForServer('metrics.view'), (req, res) => {
    res.json({ message: 'Use Socket.IO events: metrics' });
  });
};
