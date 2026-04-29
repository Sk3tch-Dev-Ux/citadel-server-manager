/**
 * require-license — gates paid Citadel Cloud features at the route level.
 *
 * Usage (Phase 3+):
 *
 *   const requireLicense = require('../middleware/require-license');
 *   app.get('/api/global-bans', auth(['admin']), requireLicense(), handler);
 *
 * In Phase 2 this middleware is intentionally NOT applied to any route — it
 * exists as scaffolding so Phase 3 can introduce a paid feature in a single
 * line. Adding it to a route returns:
 *
 *   402 Payment Required
 *   { error: 'SUBSCRIPTION_INACTIVE',
 *     message: 'This feature requires an active Citadel Cloud subscription.',
 *     upgradeUrl: 'https://citadels.cc/cloud',
 *     status: <current license state> }
 *
 * The local Citadel app (free) keeps working — only routes wrapped with
 * this middleware are gated. See ROADMAP.md "Product model" for context.
 *
 * Decision rule:
 *   - state === 'active'     → allow
 *   - state === 'grace'      → allow (offline grace period; license module
 *                                     handles expiry once GRACE_DAYS exceeded)
 *   - anything else          → 402
 *
 * The license module (backend/lib/license/index.js) already exposes
 * isUsable() with the same rule; we use it directly so behavior stays
 * consistent if the rule ever changes.
 */
const license = require('../lib/license');

/**
 * Build a middleware that requires an active Citadel Cloud subscription.
 *
 * @param {object} [opts]
 * @param {string} [opts.featureName] - human-readable feature name shown in the 402
 * @returns {(req, res, next) => void}
 */
function requireLicense({ featureName } = {}) {
  return function requireLicenseMiddleware(req, res, next) {
    if (license.isUsable()) return next();

    const state = license.getState();
    return res.status(402).json({
      error: 'SUBSCRIPTION_INACTIVE',
      message: featureName
        ? `${featureName} requires an active Citadel Cloud subscription.`
        : 'This feature requires an active Citadel Cloud subscription.',
      upgradeUrl: 'https://citadels.cc/cloud',
      status: state.status,
    });
  };
}

module.exports = requireLicense;
module.exports.requireLicense = requireLicense;
