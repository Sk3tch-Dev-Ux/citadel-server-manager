/**
 * Citadel license endpoints — consumed by the dashboard to activate/manage
 * this installation's subscription link to citadels.cc.
 *
 *   GET    /api/citadel-license/status     — current state (auth required)
 *   POST   /api/citadel-license/activate   — body: { email, password, name? }
 *   POST   /api/citadel-license/refresh    — force a verify call
 *   DELETE /api/citadel-license/deactivate — revoke this device's slot
 */
const license = require('../lib/license');
const { auth } = require('../middleware/auth');

function registerCitadelLicenseRoutes(app) {
  // All routes require admin login to the Citadel dashboard — licensing is
  // a per-installation concern, only the server admin should touch it.
  const requireAdmin = auth(['admin', 'owner', '*']);

  app.get('/api/citadel-license/status', requireAdmin, (_req, res) => {
    const state = license.getState();
    res.json({
      status: state.status,
      subscription: state.subscription,
      lastVerifiedAt: state.lastVerifiedAt,
      machineId: license.machineId(),
      claims: state.claims ? {
        email: state.claims.email,
        deviceId: state.claims.deviceId,
        expiresAt: state.claims.exp ? new Date(state.claims.exp * 1000).toISOString() : null,
      } : null,
      lastError: state.lastError,
    });
  });

  app.post('/api/citadel-license/activate', requireAdmin, async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    try {
      const result = await license.activate({ email, password, name });
      res.json({
        ok: true,
        status: result.state.status,
        subscription: result.state.subscription,
      });
    } catch (err) {
      res.status(err.status || 500).json({
        error: err.code || 'ACTIVATION_FAILED',
        message: err.message,
      });
    }
  });

  app.post('/api/citadel-license/refresh', requireAdmin, async (_req, res) => {
    const result = await license.refresh();
    if (result.ok) {
      res.json({
        ok: true,
        status: result.state.status,
        subscription: result.state.subscription,
      });
    } else {
      res.status(409).json({ ok: false, reason: result.reason });
    }
  });

  app.delete('/api/citadel-license/deactivate', requireAdmin, async (_req, res) => {
    await license.deactivate();
    res.status(204).send();
  });
}

module.exports = registerCitadelLicenseRoutes;
