/**
 * License & subscription management routes.
 * Tiered model: Free → Basic ($4.99) → Pro ($9.99) → Community ($24.99)
 */
const auth = require('../middleware/auth');
const { getLicense, setLicenseKey, refreshLicenseFromServer, TIER_LIMITS, TIER_ORDER } = require('../lib/license');
const ctx = require('../lib/context');
const logger = require('../lib/logger');

const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || 'https://citadel-license-generator.vercel.app';

module.exports = function(app) {

  /**
   * GET /api/license — Current license & tier status (all authenticated users)
   */
  app.get('/api/license', auth(), (req, res) => {
    res.json({
      ...getLicense(),
      purchaseUrl: ctx.CONFIG.purchaseUrl || null,
      licenseServerUrl: LICENSE_SERVER_URL,
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
   * POST /api/license/refresh — Force-refresh subscription status from license server (admin only)
   */
  app.post('/api/license/refresh', auth('admin'), async (req, res) => {
    try {
      await refreshLicenseFromServer(ctx.CONFIG.dataDir);
      const license = getLicense();

      if (ctx.io) {
        ctx.io.emit('licenseUpdate', license);
      }

      res.json({ success: true, license });
    } catch (err) {
      logger.error({ error: err.message }, 'License refresh failed');
      res.status(500).json({ error: 'Failed to refresh license' });
    }
  });

  /**
   * POST /api/license/checkout — Create a Stripe checkout session (admin only)
   * Body: { tier: 'basic'|'pro'|'community', interval: 'month'|'year' }
   */
  app.post('/api/license/checkout', auth('admin'), async (req, res) => {
    const { tier, interval } = req.body;

    if (!tier || !['basic', 'pro', 'community'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }
    if (!interval || !['month', 'year'].includes(interval)) {
      return res.status(400).json({ error: 'Invalid interval' });
    }

    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(`${LICENSE_SERVER_URL}/api/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval }),
      });

      const data = await response.json();
      if (data.url) {
        res.json({ url: data.url });
      } else {
        res.status(500).json({ error: data.error || 'Failed to create checkout session' });
      }
    } catch (err) {
      logger.error({ error: err.message }, 'Checkout creation failed');
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  /**
   * POST /api/license/portal — Create a Stripe billing portal session (admin only)
   */
  app.post('/api/license/portal', auth('admin'), async (req, res) => {
    const license = getLicense();
    if (!license.stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer associated with this license' });
    }

    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(`${LICENSE_SERVER_URL}/api/create-portal-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripeCustomerId: license.stripeCustomerId }),
      });

      const data = await response.json();
      if (data.url) {
        res.json({ url: data.url });
      } else {
        res.status(500).json({ error: data.error || 'Failed to create portal session' });
      }
    } catch (err) {
      logger.error({ error: err.message }, 'Portal session creation failed');
      res.status(500).json({ error: 'Failed to create billing portal session' });
    }
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
