/**
 * Server logs and metrics routes.
 */
const ctx = require('../lib/context');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/servers/:id/logs', auth('logs.view'), (req, res) => {
    const { level, source, limit = 200 } = req.query;
    let logs = ctx.serverStates[req.params.id]?.logs || [];
    if (level) logs = logs.filter(l => l.level === level);
    if (source) logs = logs.filter(l => l.source === source);
    res.json(logs.slice(0, parseInt(limit)));
  });

  app.get('/api/servers/:id/metrics', auth('metrics.view'), (req, res) => {
    res.json(ctx.serverStates[req.params.id]?.metricsHistory || { cpu: [], ram: [], players: [], fps: [], timestamps: [] });
  });

  app.get('/api/servers/:id/metrics/stream', auth('metrics.view'), (req, res) => {
    res.json({ message: 'Use Socket.IO events: metrics' });
  });
};
