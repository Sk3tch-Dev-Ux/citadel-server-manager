/**
 * LB Master Perks routes — admin endpoints for perk discovery and management.
 *
 * These endpoints let the admin discover which servers have LB Master installed
 * and which prefix groups / tag groups are available for product perk configuration.
 */
const { getLBStatus, discoverPrefixGroups, discoverTagGroups, detectLBMaster } = require('../lib/lb-perks');
const auth = require('../middleware/auth');
const ctx = require('../lib/context');
const logger = require('../lib/logger');

module.exports = function (app) {

  // ─── LB Master detection status across all servers ─────
  app.get('/api/lb-perks/status', auth('priority.manage'), (req, res) => {
    try {
      const status = getLBStatus();
      const anyInstalled = status.some(s => s.installed);
      const anyAdvancedGroups = status.some(s => s.hasAdvancedGroups);
      const anyTagGroups = status.some(s => s.hasTagGroups);
      res.json({
        servers: status,
        anyInstalled,
        anyAdvancedGroups,
        anyTagGroups,
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to get LB Master status');
      res.status(500).json({ error: 'Failed to detect LB Master status' });
    }
  });

  // ─── List prefix groups for a specific server ──────────
  app.get('/api/lb-perks/prefix-groups/:serverId', auth('priority.manage'), (req, res) => {
    try {
      const server = ctx.servers.find(s => s.id === req.params.serverId);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const detection = detectLBMaster(server);
      if (!detection.installed) {
        return res.json({ installed: false, hasAdvancedGroups: false, prefixGroups: [] });
      }
      if (!detection.hasAdvancedGroups) {
        return res.json({ installed: true, hasAdvancedGroups: false, prefixGroups: [] });
      }

      const prefixGroups = discoverPrefixGroups(server);
      res.json({
        installed: true,
        hasAdvancedGroups: true,
        prefixGroups,
      });
    } catch (err) {
      logger.error({ err: err.message, serverId: req.params.serverId }, 'Failed to get prefix groups');
      res.status(500).json({ error: 'Failed to read prefix groups' });
    }
  });

  // ─── List tag color groups for a specific server ───────
  app.get('/api/lb-perks/tag-groups/:serverId', auth('priority.manage'), (req, res) => {
    try {
      const server = ctx.servers.find(s => s.id === req.params.serverId);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const detection = detectLBMaster(server);
      if (!detection.installed) {
        return res.json({ installed: false, hasTagGroups: false, tagGroups: [] });
      }
      if (!detection.hasTagGroups) {
        return res.json({ installed: true, hasTagGroups: false, tagGroups: [] });
      }

      const tagGroups = discoverTagGroups(server);
      res.json({
        installed: true,
        hasTagGroups: true,
        tagGroups,
      });
    } catch (err) {
      logger.error({ err: err.message, serverId: req.params.serverId }, 'Failed to get tag groups');
      res.status(500).json({ error: 'Failed to read tag groups' });
    }
  });
};
