/**
 * License-gating middleware.
 * Returns 403 if the current instance is not licensed.
 *
 * Usage in routes:
 *   const requireLicense = require('../middleware/license');
 *   app.post('/api/deploy', auth('server.deploy'), requireLicense(), handler);
 */
const { isLicensed } = require('../lib/license');

/**
 * Middleware that blocks requests when no valid license is active.
 */
function requireLicense() {
  return (req, res, next) => {
    if (!isLicensed()) {
      return res.status(403).json({
        error: 'License required',
        message: 'This feature requires a valid Citadel license. Purchase at citadel.gg for $19.99.',
        licensed: false,
      });
    }
    next();
  };
}

module.exports = requireLicense;
module.exports.requireLicense = requireLicense;
