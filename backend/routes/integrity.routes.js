/**
 * Mod & build integrity routes.
 *
 * Exposes the integrity engine: view the trusted snapshot + last drift check,
 * re-baseline (after a deliberate manual change), or run an on-demand drift
 * check. Mirrors CF Architect's deployment-integrity surface.
 */
const ctx = require('../lib/context');
const { authForServer } = require('../middleware/auth');
const { addAudit } = require('../lib/audit');
const integrity = require('../lib/integrity-engine');
const { safeError } = require('../lib/http-errors');

module.exports = function (app) {
  // Current integrity report: per-mod baselines, last check, installed build.
  app.get('/api/servers/:id/integrity', authForServer('mods.view'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    res.json(integrity.getReport(req.params.id));
  });

  // Re-baseline every enabled mod to the current on-disk bytes.
  app.post('/api/servers/:id/integrity/snapshot', authForServer('mods.install'), async (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      const result = await integrity.snapshotServer(req.params.id);
      integrity.recordInstalledBuild(req.params.id);
      addAudit(req.user.id, req.user.username, 'integrity.snapshot', `Re-baselined ${result.count} mod(s) on ${srv.name}`);
      res.json({ message: `Snapshotted ${result.count} mod(s)`, ...result });
    } catch (err) { safeError(err, req, res, { status: 500 }); }
  });

  // Run a drift check now (does not change the baseline).
  app.post('/api/servers/:id/integrity/check', authForServer('mods.view'), async (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      const result = await integrity.checkServerDrift(req.params.id, { notify: false });
      res.json(result);
    } catch (err) { safeError(err, req, res, { status: 500 }); }
  });
};
