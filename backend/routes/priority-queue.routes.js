/**
 * Priority queue CRUD routes.
 * Syncs with CFTools priority queue when configured.
 */
const ctx = require('../lib/context');
const { addToPriorityQueue, removeFromPriorityQueue } = require('../lib/cftools-priority');
const auth = require('../middleware/auth');
const logger = require('../lib/logger');

module.exports = function(app) {
  app.get('/api/priority-queue', auth(), (req, res) => res.json(ctx.priorityQueue));

  app.post('/api/priority-queue', auth('server.rcon'), async (req, res) => {
    try {
      const { name, steamId, role } = req.body;
      if (!name) return res.status(400).json({ error: 'name required' });
      // Use first server as default for CFTools sync
      const defaultSrv = ctx.servers[0];
      const entry = await addToPriorityQueue(defaultSrv?.id, name, steamId, role);
      res.json(entry);
    } catch (err) {
      logger.error({ err }, 'Failed to add to priority queue');
      res.status(500).json({ error: err.message || 'Failed to add to priority queue' });
    }
  });

  app.delete('/api/priority-queue/:id', auth('server.rcon'), async (req, res) => {
    try {
      const defaultSrv = ctx.servers[0];
      await removeFromPriorityQueue(defaultSrv?.id, req.params.id);
      res.json({ message: 'Removed' });
    } catch (err) {
      logger.error({ err }, 'Failed to remove from priority queue');
      res.status(500).json({ error: err.message || 'Failed to remove from priority queue' });
    }
  });
};
