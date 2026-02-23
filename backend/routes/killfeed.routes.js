/**
 * Killfeed routes.
 */
const ctx = require('../lib/context');
const { scrapeRPTForKills } = require('../lib/rpt-scraper');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/servers/:id/killfeed', auth(), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    res.json(scrapeRPTForKills(srv, parseInt(req.query.limit) || 30));
  });
};
