/**
 * Watchlist CRUD routes.
 */
const { v4: uuid } = require('uuid');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/watchlist', auth(), (req, res) => res.json(ctx.watchList));

  app.post('/api/watchlist', auth('players.ban'), (req, res) => {
    const { name, steamId, reason } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const entry = { id: uuid(), name, steamId: steamId || '', reason: reason || '', addedAt: new Date().toISOString() };
    ctx.watchList.push(entry);
    saveJSON(ctx.CONFIG.dataDir, 'watchlist.json', ctx.watchList);
    res.json(entry);
  });

  app.delete('/api/watchlist/:id', auth('players.ban'), (req, res) => {
    ctx.watchList = ctx.watchList.filter(w => w.id !== req.params.id);
    saveJSON(ctx.CONFIG.dataDir, 'watchlist.json', ctx.watchList);
    res.json({ message: 'Removed' });
  });
};
