/**
 * License/tier-gating middleware.
 *
 * Usage in routes:
 *   const { requireTier, checkServerLimit, checkWebhookLimit } = require('../middleware/license');
 *
 *   // Any tier (including free) — just attaches tierLimits to req
 *   app.get('/api/data', auth(), requireTier(), handler);
 *
 *   // Requires Basic tier or higher
 *   app.post('/api/feature', auth(), requireTier('basic'), handler);
 *
 *   // Enforces server count limit based on tier
 *   app.post('/api/servers', auth('server.deploy'), checkServerLimit(), handler);
 *
 *   // Enforces webhook count limit based on tier
 *   app.post('/api/webhooks', auth('webhooks.manage'), checkWebhookLimit(), handler);
 */
const fs = require('fs');
const path = require('path');
const { getTier, getTierLimits, meetsMinTier } = require('../lib/license');
const ctx = require('../lib/context');

/**
 * Middleware that checks the current tier meets a minimum requirement.
 * Always attaches `req.tierLimits` for downstream use.
 * Bypasses during initial setup so the wizard can create a server.
 *
 * @param {string} [minTier] - Minimum tier required (e.g. 'basic', 'pro'). Omit for any tier.
 */
function requireTier(minTier) {
  return (req, res, next) => {
    // Allow during initial setup
    const setupFlagPath = path.join(ctx.CONFIG?.dataDir || path.join(__dirname, '..', '..', 'data'), 'setup_complete.json');
    if (!fs.existsSync(setupFlagPath)) {
      req.tierLimits = getTierLimits('community'); // Full access during setup
      return next();
    }

    const currentTier = getTier();
    req.tierLimits = getTierLimits(currentTier);
    req.currentTier = currentTier;

    if (minTier && !meetsMinTier(currentTier, minTier)) {
      return res.status(403).json({
        error: 'Tier upgrade required',
        message: `This feature requires the ${minTier.charAt(0).toUpperCase() + minTier.slice(1)} tier or higher. Your current tier: ${currentTier}.`,
        currentTier,
        requiredTier: minTier,
      });
    }

    next();
  };
}

/**
 * Middleware that checks the current server count against the tier limit.
 * Blocks server creation if the limit is reached.
 */
function checkServerLimit() {
  return (req, res, next) => {
    // Allow during initial setup
    const setupFlagPath = path.join(ctx.CONFIG?.dataDir || path.join(__dirname, '..', '..', 'data'), 'setup_complete.json');
    if (!fs.existsSync(setupFlagPath)) {
      req.tierLimits = getTierLimits('community');
      return next();
    }

    const currentTier = getTier();
    const limits = getTierLimits(currentTier);
    req.tierLimits = limits;
    req.currentTier = currentTier;

    // -1 means unlimited
    if (limits.maxServers !== -1) {
      const currentCount = (ctx.servers || []).length;
      if (currentCount >= limits.maxServers) {
        return res.status(403).json({
          error: 'Server limit reached',
          message: `Your ${currentTier} tier allows ${limits.maxServers} server(s). Upgrade your plan to add more.`,
          currentTier,
          limit: limits.maxServers,
          current: currentCount,
        });
      }
    }

    next();
  };
}

/**
 * Middleware that checks the current webhook count against the tier limit.
 * Blocks webhook creation if the limit is reached.
 */
function checkWebhookLimit() {
  return (req, res, next) => {
    // Allow during initial setup
    const setupFlagPath = path.join(ctx.CONFIG?.dataDir || path.join(__dirname, '..', '..', 'data'), 'setup_complete.json');
    if (!fs.existsSync(setupFlagPath)) {
      req.tierLimits = getTierLimits('community');
      return next();
    }

    const currentTier = getTier();
    const limits = getTierLimits(currentTier);
    req.tierLimits = limits;
    req.currentTier = currentTier;

    // -1 means unlimited
    if (limits.maxWebhooks !== -1) {
      const { loadJSON } = require('../lib/data-store');
      const webhooks = loadJSON(ctx.CONFIG.dataDir, 'webhooks.json') || [];
      if (webhooks.length >= limits.maxWebhooks) {
        return res.status(403).json({
          error: 'Webhook limit reached',
          message: `Your ${currentTier} tier allows ${limits.maxWebhooks} webhook(s). Upgrade your plan to add more.`,
          currentTier,
          limit: limits.maxWebhooks,
          current: webhooks.length,
        });
      }
    }

    next();
  };
}

// ─── Backward compatibility ──────────────────────────────
// Old code used requireLicense() — map it to requireTier('basic')
function requireLicense() {
  return requireTier('basic');
}

module.exports = requireTier;
module.exports.requireTier = requireTier;
module.exports.requireLicense = requireLicense;
module.exports.checkServerLimit = checkServerLimit;
module.exports.checkWebhookLimit = checkWebhookLimit;
