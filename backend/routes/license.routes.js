/**
 * License management routes.
 * Provides license status, activation, and tier information.
 */
const auth = require('../middleware/auth');
const { getLicense, setLicenseKey, TIERS, hasFeature } = require('../lib/license');
const ctx = require('../lib/context');

module.exports = function(app) {

  /**
   * GET /api/license — Current license status (all authenticated users)
   */
  app.get('/api/license', auth(), (req, res) => {
    const license = getLicense();
    res.json({
      ...license,
      currentServers: ctx.servers.length,
      canAddServer: license.maxServers === Infinity || ctx.servers.length < license.maxServers,
    });
  });

  /**
   * GET /api/license/tiers — Available tier definitions (public info)
   */
  app.get('/api/license/tiers', auth(), (req, res) => {
    const tiers = Object.entries(TIERS).map(([id, def]) => ({
      id,
      label: def.label,
      maxServers: def.maxServers === Infinity ? 'unlimited' : def.maxServers,
      features: def.features,
      watermark: def.watermark,
    }));
    res.json(tiers);
  });

  /**
   * GET /api/license/features — Check all feature availability for current tier
   */
  app.get('/api/license/features', auth(), (req, res) => {
    const allFeatures = [
      'server.view', 'server.control', 'players', 'rcon', 'logs', 'metrics',
      'mods', 'mods.view', 'config', 'file_manager', 'scheduler', 'messenger',
      'backups', 'bans', 'live_map', 'leaderboard', 'killfeed', 'deploy',
      'discord_bot', 'webhooks', 'priority_queue', 'watchlist',
    ];

    const features = {};
    for (const f of allFeatures) {
      features[f] = hasFeature(f);
    }
    res.json(features);
  });

  /**
   * POST /api/license/activate — Activate a new license key (admin only)
   */
  app.post('/api/license/activate', auth('admin'), (req, res) => {
    const { key } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'License key is required' });
    }

    const result = setLicenseKey(key.trim(), ctx.CONFIG.dataDir);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast license change to all connected clients
    if (ctx.io) {
      ctx.io.emit('licenseUpdate', result.license);
    }

    res.json({ success: true, license: result.license });
  });

  /**
   * DELETE /api/license — Deactivate license, revert to community (admin only)
   */
  app.delete('/api/license', auth('admin'), (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const cacheFile = path.join(ctx.CONFIG.dataDir, 'license.json');

    try { fs.unlinkSync(cacheFile); } catch { /* ok */ }

    // Re-activate with no key → community tier
    const { activateLicense } = require('../lib/license');
    activateLicense(ctx.CONFIG.dataDir);

    const license = getLicense();

    if (ctx.io) {
      ctx.io.emit('licenseUpdate', license);
    }

    res.json({ success: true, license });
  });
};
