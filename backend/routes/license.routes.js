/**
 * License management routes.
 * Simple model: unlicensed → purchase $19.99 → activate key → full access.
 */
const auth = require('../middleware/auth');
const { getLicense, setLicenseKey } = require('../lib/license');
const ctx = require('../lib/context');

module.exports = function(app) {

  /**
   * GET /api/license — Current license status (all authenticated users)
   */
  app.get('/api/license', auth(), (req, res) => {
    res.json(getLicense());
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

    // Broadcast license change to all connected clients
    if (ctx.io) {
      ctx.io.emit('licenseUpdate', result.license);
    }

    res.json({ success: true, license: result.license });
  });

  /**
   * DELETE /api/license — Deactivate license, revert to unlicensed (admin only)
   */
  app.delete('/api/license', auth('admin'), (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const cacheFile = path.join(ctx.CONFIG.dataDir, 'license.json');

    try { fs.unlinkSync(cacheFile); } catch { /* ok */ }

    // Re-activate with no key → unlicensed
    const { activateLicense } = require('../lib/license');
    activateLicense(ctx.CONFIG.dataDir);

    const license = getLicense();

    if (ctx.io) {
      ctx.io.emit('licenseUpdate', license);
    }

    res.json({ success: true, license });
  });
};
