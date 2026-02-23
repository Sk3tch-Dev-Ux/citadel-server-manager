/**
 * Notification routes.
 */
const ctx = require('../lib/context');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/notifications', auth(), (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(ctx.notifications.slice(0, limit));
  });

  app.patch('/api/notifications/read', auth(), (req, res) => {
    const { ids } = req.body;
    if (ids && Array.isArray(ids)) {
      ids.forEach(id => { const n = ctx.notifications.find(x => x.id === id); if (n) n.read = true; });
    } else {
      ctx.notifications.forEach(n => n.read = true);
    }
    res.json({ message: 'Marked as read' });
  });

  app.delete('/api/notifications', auth(), (req, res) => {
    ctx.notifications.length = 0;
    res.json({ message: 'Cleared' });
  });
};
