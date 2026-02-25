/**
 * Leaderboard routes.
 */
const ctx = require('../lib/context');
const { updateLeaderboard } = require('../lib/cftools-leaderboard');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/leaderboard', auth(), (req, res) => res.json(ctx.leaderboard));

  app.post('/api/leaderboard/refresh', auth(), (req, res) => {
    ctx.servers.forEach(s => updateLeaderboard(s.id));
    res.json(ctx.leaderboard);
  });
};
