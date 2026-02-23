/**
 * Audit log routes.
 */
const ctx = require('../lib/context');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/audit', auth('users.manage'), (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    res.json({ entries: ctx.auditLog.slice(parseInt(offset), parseInt(offset) + parseInt(limit)), total: ctx.auditLog.length });
  });
};
