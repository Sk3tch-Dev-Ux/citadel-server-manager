/**
 * License-gating middleware.
 * Returns 403 if the current instance is not licensed.
 * Allows requests through during initial setup (before setup_complete.json exists).
 *
 * Usage in routes:
 *   const requireLicense = require('../middleware/license');
 *   app.post('/api/deploy', auth('server.deploy'), requireLicense(), handler);
 */
const fs = require('fs');
const path = require('path');
const { isLicensed } = require('../lib/license');
const ctx = require('../lib/context');

/**
 * Middleware that blocks requests when no valid license is active.
 * Bypasses the check during first-run setup so the wizard can create a server.
 */
function requireLicense() {
  return (req, res, next) => {
    // Allow during initial setup — the first server should always be free to create
    const setupFlagPath = path.join(ctx.CONFIG?.dataDir || path.join(__dirname, '..', '..', 'data'), 'setup_complete.json');
    if (!fs.existsSync(setupFlagPath)) {
      return next();
    }

    if (!isLicensed()) {
      return res.status(403).json({
        error: 'License required',
        message: 'This feature requires a valid Citadel license. Purchase at citadel.gg for $34.99.',
        licensed: false,
      });
    }
    next();
  };
}

module.exports = requireLicense;
module.exports.requireLicense = requireLicense;
