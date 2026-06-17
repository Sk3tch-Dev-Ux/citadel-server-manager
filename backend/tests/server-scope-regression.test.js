/**
 * Regression tests for the server-scope (multi-tenant) authorization fixes.
 *
 * RBUILD-SCOPE — POST /api/servers/:id/rebuild used auth('server.rebuild'),
 *   which checks the PERMISSION but NOT the role's serverScope. A scope-limited
 *   admin could therefore trigger a full wipe + reinstall (fs.rmSync over the
 *   install dir) of ANY server, including ones outside its scope. The route now
 *   uses auth.authForServer('server.rebuild') (mirroring the dangerzone wipe
 *   route), which additionally enforces serverScope. These tests lock that in
 *   by driving the real authForServer() middleware with a scope-limited token.
 *
 * Structured so the next agent can drop PVP-SCOPE (and any other
 * server-scoped permission) cases into the shared `runScopeMiddleware` harness
 * below — see the `describe.each` permission table.
 *
 * Pure-unit on purpose: exercises only the middleware + context singletons, so
 * it boots no HTTP server and opens no handles. A real JWT is minted with the
 * test JWT secret and verified through the middleware exactly as a live request
 * would be.
 */
const os = require('os');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const ctx = require('../lib/context');

// ─── Test harness ────────────────────────────────────────
const TEST_SECRET = process.env.JWT_SECRET || 'ci-test-secret';

/**
 * Run a *ForServer permission middleware against a synthetic request and
 * capture the response it produced. Resolves with { status, body, nextCalled }.
 */
function runScopeMiddleware(middleware, { token, serverId }) {
  return new Promise((resolve) => {
    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {},
      params: { id: serverId },
      originalUrl: `/api/servers/${serverId}/rebuild`,
      method: 'POST',
      path: `/api/servers/${serverId}/rebuild`,
    };
    let settled = false;
    const finish = (payload) => { if (!settled) { settled = true; resolve(payload); } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { finish({ status: this.statusCode, body, nextCalled: false }); return this; },
    };
    const next = () => finish({ status: 200, body: null, nextCalled: true });
    middleware(req, res, next);
  });
}

function mintToken(user, { secret = TEST_SECRET } = {}) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    secret,
    { expiresIn: '8h' },
  );
}

describe('Server-scope authorization regressions', () => {
  let savedUsers; let savedRoles; let savedServers; let savedConfig; let savedAudit;

  beforeEach(() => {
    savedUsers = ctx.users;
    savedRoles = ctx.roles;
    savedServers = ctx.servers;
    savedConfig = ctx.CONFIG;
    savedAudit = ctx.auditLog;

    // Two tenants: server A and server B.
    ctx.servers = [
      { id: 'srv-A', name: 'Alpha' },
      { id: 'srv-B', name: 'Bravo' },
    ];
    ctx.auditLog = [];
    // ctx.CONFIG is normally wired in server.js; the middleware only reads
    // jwtSecret. addAudit (fired on denial) also writes audit.json under
    // dataDir, so point it at the hermetic temp dir the jest setup created.
    const dataDir = (savedConfig && savedConfig.dataDir) || process.env.CITADEL_DATA_DIR || os.tmpdir();
    ctx.CONFIG = { ...(savedConfig || {}), jwtSecret: TEST_SECRET, dataDir };
  });

  afterEach(() => {
    ctx.users = savedUsers;
    ctx.roles = savedRoles;
    ctx.servers = savedServers;
    ctx.CONFIG = savedConfig;
    ctx.auditLog = savedAudit;
  });

  // Each server-scoped permission gets the same battery of cases. Add new rows
  // (e.g. ['PVP-SCOPE', 'server.pvp']) as those routes adopt authForServer().
  describe.each([
    ['RBUILD-SCOPE', 'server.rebuild'],
  ])('%s — authForServer(%s) enforces serverScope', (label, permission) => {
    test('scope-limited admin is DENIED (403) on a server outside its scope', async () => {
      ctx.users = [{ id: 'scoped-admin', username: 'scoped', role: 'scoped-admin' }];
      // Has the permission, but scope is restricted to srv-A only.
      ctx.roles = [{ id: 'scoped-admin', permissions: [permission], serverScope: ['srv-A'] }];

      const token = mintToken(ctx.users[0]);
      const result = await runScopeMiddleware(auth.authForServer(permission), { token, serverId: 'srv-B' });

      expect(result.nextCalled).toBe(false);
      expect(result.status).toBe(403);
      expect(result.body.error).toMatch(/no access to this server/i);
    });

    test('scope-limited admin is ALLOWED on a server inside its scope', async () => {
      ctx.users = [{ id: 'scoped-admin', username: 'scoped', role: 'scoped-admin' }];
      ctx.roles = [{ id: 'scoped-admin', permissions: [permission], serverScope: ['srv-A'] }];

      const token = mintToken(ctx.users[0]);
      const result = await runScopeMiddleware(auth.authForServer(permission), { token, serverId: 'srv-A' });

      expect(result.nextCalled).toBe(true);
      expect(result.status).toBe(200);
    });

    test('wildcard admin bypasses scope (can act on any server)', async () => {
      ctx.users = [{ id: 'root', username: 'root', role: 'admin' }];
      ctx.roles = [{ id: 'admin', permissions: ['*'] }];

      const token = mintToken(ctx.users[0]);
      const result = await runScopeMiddleware(auth.authForServer(permission), { token, serverId: 'srv-B' });

      expect(result.nextCalled).toBe(true);
      expect(result.status).toBe(200);
    });

    test('unscoped (no serverScope) admin can act on any server — backward compatible', async () => {
      ctx.users = [{ id: 'admin2', username: 'admin2', role: 'global-admin' }];
      ctx.roles = [{ id: 'global-admin', permissions: [permission] }]; // no serverScope key

      const token = mintToken(ctx.users[0]);
      const result = await runScopeMiddleware(auth.authForServer(permission), { token, serverId: 'srv-B' });

      expect(result.nextCalled).toBe(true);
      expect(result.status).toBe(200);
    });

    test('a denial writes an access.denied audit row (FRAG-2 observability)', async () => {
      // Distinct user id so this test's denial lands in its own
      // per-user-per-minute coalesce bucket, independent of the DENIED case
      // above that runs in the same wall-clock minute.
      const uid = `audit-probe-${permission}`;
      ctx.users = [{ id: uid, username: 'probe', role: 'scoped-admin' }];
      ctx.roles = [{ id: 'scoped-admin', permissions: [permission], serverScope: ['srv-A'] }];

      const token = mintToken(ctx.users[0]);
      await runScopeMiddleware(auth.authForServer(permission), { token, serverId: 'srv-B' });

      const denial = ctx.auditLog.find(e => e.action === 'access.denied');
      expect(denial).toBeTruthy();
      expect(denial.userId).toBe(uid);
      expect(denial.details.serverId).toBe('srv-B');
      expect(denial.details.reason).toBe('server-scope-denied');
    });
  });

  // PVP-SCOPE — POST /api/servers/:id/pvp/reset used auth(['admin','owner','*']),
  // which checks the any-of permission but NOT the role's serverScope, so a
  // scope-limited admin could wipe the PvP leaderboard of ANY server. The route
  // now uses authForServer(['admin','owner','*']). This drives the middleware
  // with the route's *exact* any-of permission array (the describe.each battery
  // above only covers single-string permissions).
  describe('PVP-SCOPE — authForServer([admin,owner,*]) enforces serverScope on pvp/reset', () => {
    const PVP_PERM = ['admin', 'owner', '*'];

    function runPvpReset({ token, serverId }) {
      return new Promise((resolve) => {
        const req = {
          headers: { authorization: `Bearer ${token}` },
          cookies: {},
          params: { id: serverId },
          originalUrl: `/api/servers/${serverId}/pvp/reset`,
          method: 'POST',
          path: `/api/servers/${serverId}/pvp/reset`,
        };
        let settled = false;
        const finish = (payload) => { if (!settled) { settled = true; resolve(payload); } };
        const res = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(body) { finish({ status: this.statusCode, body, nextCalled: false }); return this; },
        };
        const next = () => finish({ status: 200, body: null, nextCalled: true });
        auth.authForServer(PVP_PERM)(req, res, next);
      });
    }

    test('scope-limited admin is DENIED (403) resetting PvP on a server outside its scope', async () => {
      ctx.users = [{ id: 'pvp-scoped', username: 'pvp-scoped', role: 'pvp-scoped' }];
      ctx.roles = [{ id: 'pvp-scoped', permissions: ['admin'], serverScope: ['srv-A'] }];

      const token = mintToken(ctx.users[0]);
      const result = await runPvpReset({ token, serverId: 'srv-B' });

      expect(result.nextCalled).toBe(false);
      expect(result.status).toBe(403);
      expect(result.body.error).toMatch(/no access to this server/i);
    });

    test('scope-limited admin is ALLOWED resetting PvP on a server inside its scope', async () => {
      ctx.users = [{ id: 'pvp-scoped', username: 'pvp-scoped', role: 'pvp-scoped' }];
      ctx.roles = [{ id: 'pvp-scoped', permissions: ['admin'], serverScope: ['srv-A'] }];

      const token = mintToken(ctx.users[0]);
      const result = await runPvpReset({ token, serverId: 'srv-A' });

      expect(result.nextCalled).toBe(true);
      expect(result.status).toBe(200);
    });

    test('wildcard (*) role bypasses scope on any server', async () => {
      ctx.users = [{ id: 'pvp-root', username: 'pvp-root', role: 'pvp-root' }];
      ctx.roles = [{ id: 'pvp-root', permissions: ['*'] }];

      const token = mintToken(ctx.users[0]);
      const result = await runPvpReset({ token, serverId: 'srv-B' });

      expect(result.nextCalled).toBe(true);
      expect(result.status).toBe(200);
    });

    test('a role lacking admin/owner/* is DENIED (403) for insufficient permissions', async () => {
      ctx.users = [{ id: 'pvp-mod', username: 'pvp-mod', role: 'pvp-mod' }];
      ctx.roles = [{ id: 'pvp-mod', permissions: ['priority.manage'], serverScope: ['srv-A'] }];

      const token = mintToken(ctx.users[0]);
      const result = await runPvpReset({ token, serverId: 'srv-A' });

      expect(result.nextCalled).toBe(false);
      expect(result.status).toBe(403);
      expect(result.body.error).toMatch(/insufficient permissions/i);
    });
  });
});
