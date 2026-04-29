/**
 * Cloud Bans — local backend routes consumed by the Citadel dashboard.
 *
 *   GET  /api/cloud-bans/status   — community-ban cache + enforcement stats
 *   POST /api/cloud-bans/sync     — manual sync trigger
 *   GET  /api/cloud-bans/list     — full cached list (paginated)
 *
 * The submit/unenroll write paths are NOT exposed as separate endpoints —
 * they're triggered automatically from the existing /api/bans/* flow when
 * a paying customer adds or removes a ban locally. See bans.routes.js
 * augmentation in P3.9.
 */
const cloudBans = require('../lib/cloud-bans');
const { auth } = require('../middleware/auth');
const requireLicense = require('../middleware/require-license');

function registerCloudBansRoutes(app) {
  // Same auth shape as the rest of the cloud-management surface — only the
  // server admin needs to see this.
  const requireAdmin = auth(['admin', 'owner', '*', 'license.manage']);

  // P3.18 — Cloud Bans are paywalled behind the 'cloud' entitlement.
  // The dashboard /global-bans page is wrapped in <LicenseGate feature='cloud'>
  // for the UI side; this is the matching server-side gate so the API
  // can't be called without the entitlement even by direct fetch.
  const requireCloud = requireLicense({ feature: 'cloud', featureName: 'Global Ban Database' });

  // /status is informational (lets the dashboard render the upgrade card
  // for non-subscribers without 402'ing), so it stays cloud-optional.
  app.get('/api/cloud-bans/status', requireAdmin, (_req, res) => {
    res.json({
      cache: cloudBans.getCacheStats(),
      enforcer: cloudBans.getEnforcerStatus(),
    });
  });

  app.post('/api/cloud-bans/sync', requireAdmin, requireCloud, async (_req, res) => {
    const result = await cloudBans.manualSync();
    if (result.ok) return res.json(result);
    return res.status(409).json({ error: 'SYNC_FAILED', ...result });
  });

  app.get('/api/cloud-bans/list', requireAdmin, requireCloud, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const offset = parseInt(req.query.offset, 10) || 0;
    const all = cloudBans.listCachedBans();
    res.json({
      total: all.length,
      offset,
      limit,
      items: all.slice(offset, offset + limit),
    });
  });
}

module.exports = registerCloudBansRoutes;
