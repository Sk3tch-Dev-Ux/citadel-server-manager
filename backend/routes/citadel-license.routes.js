/**
 * Citadel license endpoints — consumed by the dashboard to activate/manage
 * this installation's subscription link to citadels.cc.
 *
 *   GET    /api/citadel-license/status            — current license state (auth)
 *   POST   /api/citadel-license/activate          — body: { email, password, name? }
 *   POST   /api/citadel-license/refresh           — force a verify call
 *   DELETE /api/citadel-license/deactivate        — revoke this device's slot
 *   GET    /api/citadel-license/telemetry-state   — current telemetry config (auth)
 *   POST   /api/citadel-license/telemetry-toggle  — body: { enabled: bool }
 */
const license = require('../lib/license');
const telemetry = require('../lib/telemetry');
const { auth } = require('../middleware/auth');

function registerCitadelLicenseRoutes(app) {
  // All routes require admin login to the Citadel dashboard — licensing is
  // a per-installation concern, only the server admin should touch it.
  const requireAdmin = auth(['admin', 'owner', '*']);

  app.get('/api/citadel-license/status', requireAdmin, (_req, res) => {
    const state = license.getState();
    const entitlements = license.getEntitlements();
    res.json({
      status: state.status,
      subscription: state.subscription,
      lastVerifiedAt: state.lastVerifiedAt,
      machineId: license.machineId(),
      // Phase 3 — entitlements drive feature gating in the dashboard.
      // 'citadel' is implicit (you can't activate without it). 'cloud' is
      // present iff the customer has the $10/mo Citadel Cloud add-on
      // subscription active on top of their base Citadel plan.
      entitlements,
      hasCloud: license.hasCloud(),
      cloudSubscription: state.claims?.cloudSubscriptionStatus
        ? { status: state.claims.cloudSubscriptionStatus }
        : null,
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
      // Don't forward upstream 401s verbatim — the dashboard's global 401
      // handler interprets that as "your Agent session expired" and logs
      // the admin out. A 401 here means "the citadels.cc credentials you
      // typed are wrong", which is a body-level error, not a session one.
      // Same logic for 403 (e.g. account locked / device cap hit upstream).
      const upstream = err.status || 500;
      const status = (upstream === 401 || upstream === 403) ? 422 : upstream;
      res.status(status).json({
        error: err.code || 'ACTIVATION_FAILED',
        message: err.message,
        upstreamStatus: upstream,
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

  // ── Telemetry config (P2.3c) ─────────────────────────────────
  // Same admin-only gate as the rest of this surface: only the server
  // admin should be able to read or change telemetry preferences.
  app.get('/api/citadel-license/telemetry-state', requireAdmin, (_req, res) => {
    const state = telemetry.getState();
    res.json({
      enabled: state.enabled,
      machineIdHash: state.machineIdHash,
      lastFlushAt: state.lastFlushAt || null,
      // The list of event names is informational so the Settings UI can
      // show the user exactly what we send. No PII inside.
      acceptedEvents: Object.keys(telemetry._internal.EVENT_SCHEMA),
    });
  });

  app.post('/api/citadel-license/telemetry-toggle', requireAdmin, (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    const next = telemetry.setEnabled(enabled);
    res.json({
      enabled: next.enabled,
      machineIdHash: next.machineIdHash,
    });
  });
}

module.exports = registerCitadelLicenseRoutes;
