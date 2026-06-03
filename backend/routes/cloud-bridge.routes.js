/**
 * Cloud bridge — operator-facing CRUD over the per-DayZ-server Citadel Cloud
 * pairing. The actual WS connection is owned by lib/cloud-bridge/supervisor;
 * these routes just edit the persisted link file. The supervisor picks up
 * changes on its next tick and connects / disconnects accordingly, then
 * writes status back via storage.updateStatus().
 *
 *   GET    /api/cloud-bridge/status           — all link entries (no raw keys)
 *   GET    /api/servers/:id/cloud-link        — one server's link state
 *   POST   /api/servers/:id/cloud-link        — body { cloudServerId, apiKey, name? }
 *   DELETE /api/servers/:id/cloud-link        — unpair
 *
 * Auth: admin or owner role on the panel side; the per-server endpoints
 * additionally enforce server-scope via authForServer. Mirrors the existing
 * /api/citadel-license/* pattern — Cloud pairing is a per-install admin
 * concern, not a per-user one.
 */
const ctx = require('../lib/context');
const { auth, authForServer } = require('../middleware/auth');
const storage = require('../lib/cloud-bridge/storage');
const { addAudit } = require('../lib/audit');
const logger = require('../lib/logger');

// auth() takes a SINGLE permission string — it does
// `role.permissions.includes('*') || role.permissions.includes(requiredPermission)`.
// Passing an array (the old `['admin','owner','*']`) could never match: includes()
// on the permission string-array never equals an array value, so only the
// built-in wildcard ('*') role passed and the intended owner/admin custom roles
// silently 403'd. Gate on the real panel-admin permission used by the sibling
// roles/audit routes; wildcard roles still pass, and operators can grant
// `users.manage` to a custom role to delegate Cloud pairing management.
const requireAdmin = auth('users.manage');

// Raw key shape produced by /api/v1/plugin-servers on the Cloud side:
// 32 random bytes → base64url → 43 chars. We allow 32–256 to stay in lockstep
// with the cloud's plugin-auth schema in case the key format ever shifts.
const API_KEY_MIN = 32;
const API_KEY_MAX = 256;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registerCloudBridgeRoutes(app) {
  // ── List all link states ──────────────────────────────────────────────
  app.get('/api/cloud-bridge/status', requireAdmin, (_req, res) => {
    res.json({ links: storage.listPublic() });
  });

  // ── One server's link state ───────────────────────────────────────────
  // 200 + null body when no link exists, so the client can render
  // "not linked" without treating it as an error.
  app.get('/api/servers/:id/cloud-link', authForServer(), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    res.json({ link: storage.getPublic(req.params.id) });
  });

  // ── Create / replace link ─────────────────────────────────────────────
  // Idempotent on localServerId: pasting a new key for the same server
  // overwrites the previous one. Supervisor sees the new credentials on
  // its next tick and reopens the socket.
  app.post('/api/servers/:id/cloud-link', authForServer('server.settings'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const body = req.body || {};
    const cloudServerId = typeof body.cloudServerId === 'string' ? body.cloudServerId.trim() : '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';

    if (!UUID_RE.test(cloudServerId)) {
      return res.status(400).json({
        error: 'INVALID_SERVER_ID',
        message: 'Server ID must be a UUID from citadels.cc/account.',
      });
    }
    if (apiKey.length < API_KEY_MIN || apiKey.length > API_KEY_MAX) {
      return res.status(400).json({
        error: 'INVALID_API_KEY',
        message: `API key length must be ${API_KEY_MIN}–${API_KEY_MAX} characters.`,
      });
    }

    try {
      storage.setLink(req.params.id, { cloudServerId, apiKey, name });
    } catch (err) {
      logger.error({ err: err.message, serverId: req.params.id }, 'cloud-bridge: setLink failed');
      return res.status(500).json({ error: 'STORAGE_FAILED', message: err.message });
    }

    addAudit(req.user.id, req.user.username, 'cloud.link', `Linked server ${srv.name} to cloud ${cloudServerId}`);

    // Nudge the supervisor to reconcile right now instead of waiting for
    // its next tick. Lazy-required so circular deps in lib/cloud-bridge
    // don't bite at server boot.
    try {
      require('../lib/cloud-bridge/supervisor').reconcileOne(req.params.id);
    } catch (err) {
      logger.debug({ err: err.message }, 'cloud-bridge: supervisor nudge failed (will pick up on next tick)');
    }

    res.json({ ok: true, link: storage.getPublic(req.params.id) });
  });

  // ── Unlink ────────────────────────────────────────────────────────────
  app.delete('/api/servers/:id/cloud-link', authForServer('server.settings'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const removed = storage.removeLink(req.params.id);
    if (removed) {
      addAudit(req.user.id, req.user.username, 'cloud.unlink', `Unlinked server ${srv.name} from cloud`);
      try {
        require('../lib/cloud-bridge/supervisor').reconcileOne(req.params.id);
      } catch (err) {
        logger.debug({ err: err.message }, 'cloud-bridge: supervisor nudge failed');
      }
    }

    res.json({ ok: true, removed });
  });
}

module.exports = registerCloudBridgeRoutes;
