/**
 * Priority queue CRUD routes.
 */
const { v4: uuid } = require('uuid');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/priority-queue', auth(), (req, res) => res.json(ctx.priorityQueue));

  app.post('/api/priority-queue', auth('server.rcon'), (req, res) => {
    const { name, steamId, role } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const entry = { id: uuid(), name, steamId: steamId || '', role: role || 'VIP', addedAt: new Date().toISOString() };
    ctx.priorityQueue.push(entry);
    saveJSON(ctx.CONFIG.dataDir, 'priority_queue.json', ctx.priorityQueue);
    res.json(entry);
  });

  app.delete('/api/priority-queue/:id', auth('server.rcon'), (req, res) => {
    ctx.priorityQueue = ctx.priorityQueue.filter(p => p.id !== req.params.id);
    saveJSON(ctx.CONFIG.dataDir, 'priority_queue.json', ctx.priorityQueue);
    res.json({ message: 'Removed' });
  });
};
