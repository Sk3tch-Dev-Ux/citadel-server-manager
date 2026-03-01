/**
 * Feature-gating middleware.
 * Returns 403 if the current license doesn't include the required feature.
 *
 * Usage in routes:
 *   const requireFeature = require('../middleware/license');
 *   app.post('/api/deploy', auth('server.deploy'), requireFeature('deploy'), handler);
 */
const { hasFeature, getLicense, canAddServer } = require('../lib/license');
const ctx = require('../lib/context');

/**
 * Middleware that blocks requests if a feature isn't licensed.
 * @param {string} feature - Feature identifier (e.g., 'webhooks', 'discord_bot')
 */
function requireFeature(feature) {
  return (req, res, next) => {
    if (!hasFeature(feature)) {
      const license = getLicense();
      return res.status(403).json({
        error: 'Feature not available',
        message: `The "${feature}" feature requires a ${getMinTier(feature)} license or higher.`,
        currentTier: license.tier,
        upgrade: true,
      });
    }
    next();
  };
}

/**
 * Middleware that blocks server creation if the license limit is reached.
 */
function requireServerSlot() {
  return (req, res, next) => {
    if (!canAddServer(ctx.servers.length)) {
      const license = getLicense();
      return res.status(403).json({
        error: 'Server limit reached',
        message: `Your ${license.tier} license allows up to ${license.maxServers} server(s). Upgrade to add more.`,
        currentTier: license.tier,
        maxServers: license.maxServers,
        currentServers: ctx.servers.length,
        upgrade: true,
      });
    }
    next();
  };
}

/**
 * Get the minimum tier required for a feature.
 */
function getMinTier(feature) {
  const { TIERS } = require('../lib/license');
  const tierOrder = ['community', 'standard', 'professional', 'enterprise'];
  for (const tier of tierOrder) {
    const def = TIERS[tier];
    if (def.features.includes('*') || def.features.includes(feature)) {
      return def.label;
    }
  }
  return 'Enterprise';
}

module.exports = requireFeature;
module.exports.requireFeature = requireFeature;
module.exports.requireServerSlot = requireServerSlot;
