/**
 * require-license — gates paid Citadel features at the route level.
 *
 * Usage (Phase 3+):
 *
 *   const requireLicense = require('../middleware/require-license');
 *
 *   // Routes that pair with the Citadel Cloud add-on (rare in the Agent —
 *   // most Cloud-add-on features live at citadels.cc/cloud, not here):
 *   app.get('/api/some-cloud-paired-route', auth(['admin']), requireLicense({ feature: 'cloud' }), handler);
 *
 *   // Citadel-only features (the local app license itself — rare since
 *   // most routes don't gate on subscription, but useful where they do):
 *   app.get('/api/something', auth(['admin']), requireLicense(), handler);
 *
 * Gating model:
 *   - requireLicense() with no `feature` requires only that the Citadel
 *     subscription is active (isUsable()).
 *   - requireLicense({ feature: 'cloud' }) requires both isUsable() AND
 *     the cloud entitlement on the JWT.
 *   - Adding a new feature (Phase 4+) requires:
 *       (1) The corresponding subscription on Paddle.
 *       (2) The webhook handler writes to a new column on `users`.
 *       (3) `computeEntitlements` in citadel-cloud/lib/license.ts adds the
 *           feature key when the column says active.
 *       (4) Pass that feature key to this middleware on the gated routes.
 *
 * Failure mode:
 *   402 Payment Required
 *   {
 *     error: 'SUBSCRIPTION_INACTIVE' | 'FEATURE_NOT_ENTITLED',
 *     message: '...',
 *     upgradeUrl: 'https://citadels.cc/cloud',
 *     feature: 'cloud',
 *     status: <current Citadel sub state>
 *   }
 */
const license = require('../lib/license');

const UPGRADE_URLS = {
  cloud: 'https://citadels.cc/cloud',
};

/**
 * @param {object} [opts]
 * @param {'cloud'} [opts.feature]   — entitlement required, if any
 * @param {string} [opts.featureName] — human-readable label for the 402 message
 */
function requireLicense({ feature, featureName } = {}) {
  return function requireLicenseMiddleware(req, res, next) {
    if (!license.isUsable()) {
      return res.status(402).json({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'Your Citadel subscription is not active. Renew to continue.',
        upgradeUrl: 'https://citadels.cc/account',
        feature: feature ?? null,
        status: license.getState().status,
      });
    }

    if (feature && !license.hasFeature(feature)) {
      return res.status(402).json({
        error: 'FEATURE_NOT_ENTITLED',
        message: featureName
          ? `${featureName} requires an active Citadel Cloud subscription on top of your Citadel plan.`
          : `This feature requires the Citadel Cloud add-on on top of your Citadel plan.`,
        upgradeUrl: UPGRADE_URLS[feature] || 'https://citadels.cc/cloud',
        feature,
        status: license.getState().status,
        entitlements: license.getEntitlements(),
      });
    }

    return next();
  };
}

module.exports = requireLicense;
module.exports.requireLicense = requireLicense;
