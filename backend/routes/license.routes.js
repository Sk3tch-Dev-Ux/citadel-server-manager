/**
 * License & subscription management routes.
 * Tiered model: Free → Basic ($4.99) → Pro ($9.99) → Community ($24.99)
 */
const auth = require('../middleware/auth');
const { getLicense, setLicenseKey, TIER_LIMITS, TIER_ORDER } = require('../lib/license');
const ctx = require('../lib/context');

module.exports = function(app) {

  /**
   * GET /api/license — Current license & tier status (all authenticated users)
   */
  app.get('/api/license', auth(), (req, res) => {
    res.json({
      ...getLicense(),
      purchaseUrl: ctx.CONFIG.purchaseUrl || null,
    });
  });

  /**
   * GET /api/license/tiers — Tier comparison data for the pricing UI
   */
  app.get('/api/license/tiers', auth(), (req, res) => {
    res.json({
      tiers: TIER_ORDER,
      limits: TIER_LIMITS,
      prices: {
        basic: { month: 4.99, year: 47.88 },
        pro: { month: 9.99, year: 95.88 },
        community: { month: 24.99, year: 239.88 },
      },
    });
  });

  /**
   * POST /api/license/activate — Activate a license key (admin only)
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

    if (ctx.io) {
      ctx.io.emit('licenseUpdate', result.license);
    }

    res.json({ success: true, license: result.license });
  });

  /**
   * DELETE /api/license — Deactivate license, revert to free tier (admin only)
   */
  app.delete('/api/license', auth('admin'), (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const cacheFile = path.join(ctx.CONFIG.dataDir, 'license.json');

    try { fs.unlinkSync(cacheFile); } catch { /* ok */ }

    const { activateLicense } = require('../lib/license');
    activateLicense(ctx.CONFIG.dataDir);

    const license = getLicense();

    if (ctx.io) {
      ctx.io.emit('licenseUpdate', license);
    }

    res.json({ success: true, license });
  });
};
