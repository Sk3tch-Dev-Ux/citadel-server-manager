/**
 * Scheduled restart routes (per server).
 */
const { v4: uuid } = require('uuid');
const ctx = require('../lib/context');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/servers/:id/schedule', auth(), (req, res) => {
    res.json(ctx.serverStates[req.params.id]?.scheduledRestarts || []);
  });

  app.post('/api/servers/:id/schedule', auth('server.restart'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    const task = { id: uuid(), cronExpression: req.body.cronExpression, label: req.body.label, enabled: req.body.enabled !== false };
    state.scheduledRestarts.push(task);
    res.json(task);
  });

  app.delete('/api/servers/:id/schedule/:taskId', auth('server.restart'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (state) state.scheduledRestarts = state.scheduledRestarts.filter(s => s.id !== req.params.taskId);
    res.json({ message: 'Removed' });
  });
};
