/**
 * Trust Network — local read-only status route.
 *
 *   GET  /api/cloud-bans/status — cache stats + enforcement counts
 *
 * The Trust Network (shared cheater-ban database) is owned by Citadel Cloud
 * at citadels.cc/cloud. The Local Agent's only responsibility is downloading
 * the synced ban list and writing it to each server's ban.txt. The management
 * surface (submitting bans, browsing the global DB, false-positive workflows)
 * lives in Citadel Cloud, not here.
 *
 * The submit/unenroll write paths are NOT exposed as separate endpoints —
 * they're still triggered automatically from /api/bans/* when a customer adds
 * or removes a local ban (see bans.routes.js). That stays so locally-issued
 * bans continue to contribute to the network.
 *
 * The /status endpoint exists so the License banner can show "X bans applied"
 * and the local Bans page can render a one-line status with a deep-link to
 * citadels.cc/cloud for management.
 */
const cloudBans = require('../lib/cloud-bans');
const { auth } = require('../middleware/auth');

function registerCloudBansRoutes(app) {
  const requireAdmin = auth(['admin', 'owner', '*', 'license.manage']);

  app.get('/api/cloud-bans/status', requireAdmin, (_req, res) => {
    res.json({
      cache: cloudBans.getCacheStats(),
      enforcer: cloudBans.getEnforcerStatus(),
    });
  });
}

module.exports = registerCloudBansRoutes;
