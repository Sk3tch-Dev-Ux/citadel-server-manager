/**
 * Cloud Agent API routes — manage Citadel Cloud connections.
 * Admin-only endpoints for configuring and monitoring cloud integration.
 */
const auth = require('../middleware/auth');
const ctx = require('../lib/context');
const cloudAgent = require('../lib/cloud-agent');
const { saveJSON } = require('../lib/data-store');
const logger = require('../lib/logger');

module.exports = function (app) {
  /**
   * GET /api/cloud/status — Get cloud connection status for all servers.
   */
  app.get('/api/cloud/status', auth('server.view'), (req, res) => {
    res.json({
      enabled: cloudAgent.isEnabled(),
      relayUrl: ctx.CONFIG?.cloud?.relayUrl || '',
      connections: cloudAgent.getStatus(),
    });
  });

  /**
   * POST /api/cloud/connect/:serverId — Connect a server to Citadel Cloud.
   * Body: { apiKey: string }
   */
  app.post('/api/cloud/connect/:serverId', auth('settings.manage'), (req, res) => {
    const { serverId } = req.params;
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({ error: 'apiKey is required' });
    }

    if (!ctx.CONFIG?.cloud?.enabled || !ctx.CONFIG?.cloud?.relayUrl) {
      return res.status(400).json({ error: 'Cloud integration is not enabled. Set cloud.enabled=true and cloud.relayUrl in config.' });
    }

    const srv = ctx.servers.find(s => s.id === serverId);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    // Save the API key to the server config
    srv.cloudApiKey = apiKey;
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);

    // Connect to cloud
    cloudAgent.connectServer(srv);

    logger.info({ serverId, user: req.user?.username }, 'Cloud connection initiated');
    res.json({ ok: true, message: 'Cloud connection initiated' });
  });

  /**
   * POST /api/cloud/disconnect/:serverId — Disconnect a server from Citadel Cloud.
   */
  app.post('/api/cloud/disconnect/:serverId', auth('settings.manage'), (req, res) => {
    const { serverId } = req.params;
    const srv = ctx.servers.find(s => s.id === serverId);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    // Remove the API key
    delete srv.cloudApiKey;
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);

    // Disconnect
    cloudAgent.disconnectServer(serverId);

    logger.info({ serverId, user: req.user?.username }, 'Cloud connection removed');
    res.json({ ok: true, message: 'Disconnected from Citadel Cloud' });
  });

  /**
   * POST /api/cloud/reconnect/:serverId — Force reconnect a server to Citadel Cloud.
   */
  app.post('/api/cloud/reconnect/:serverId', auth('settings.manage'), (req, res) => {
    const { serverId } = req.params;
    const srv = ctx.servers.find(s => s.id === serverId);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    if (!srv.cloudApiKey) {
      return res.status(400).json({ error: 'No cloud API key configured for this server' });
    }

    cloudAgent.connectServer(srv);

    logger.info({ serverId, user: req.user?.username }, 'Cloud reconnect initiated');
    res.json({ ok: true, message: 'Reconnecting to Citadel Cloud' });
  });
};
