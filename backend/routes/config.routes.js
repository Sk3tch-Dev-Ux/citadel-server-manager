/**
 * Server config (serverDZ.cfg) read/write routes.
 */
const ctx = require('../lib/context');
const { readServerConfig, writeServerConfig } = require('../lib/dayz-config');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/servers/:id/config', authForServer('server.config'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id];
    if (state) state.config = readServerConfig(srv.installDir);
    res.json(state?.config || {});
  });

  app.patch('/api/servers/:id/config', authForServer('server.config'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (writeServerConfig(srv.installDir, req.body)) {
      if (ctx.serverStates[srv.id]) ctx.serverStates[srv.id].config = readServerConfig(srv.installDir);
      addAudit(req.user.id, req.user.username, 'config.update', `Updated config for ${srv.name}`);
      res.json(ctx.serverStates[srv.id]?.config || {});
    } else res.status(500).json({ error: 'Failed to write config' });
  });
};
