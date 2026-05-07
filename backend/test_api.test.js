/**
 * Backend test suite — Phase 5: Quality & DevOps
 *
 * Tests cover:
 *   - Pure utility functions (safePath, checkPasswordPolicy, sanitizeString, validateFields)
 *   - API endpoint authentication (via supertest)
 *   - Rate limiting headers
 */

// ─── Set env vars BEFORE any requires ──────────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.PORT = '0'; // Let OS assign port (avoids conflicts)
process.env.NODE_ENV = 'test'; // Test mode - prevents server.listen() and pino-pretty

// ─── Mock ESM-only deps that Jest can't parse ─────────────────
jest.mock('uuid', () => ({ v4: () => 'test-uuid-' + Math.random().toString(36).slice(2) }));
// node-fetch replaced by built-in fetch (Node 18+) — mock global fetch for tests
global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ─── Unit tests for pure utility functions ─────────────────────
const {
  safePath,
  checkPasswordPolicy,
  sanitizeString,
  validateFields,
} = require('./lib/helpers');

describe('Utility: sanitizeString', () => {
  it('should escape HTML special characters', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('should escape ampersands', () => {
    expect(sanitizeString('foo & bar')).toBe('foo &amp; bar');
  });

  it('should escape single quotes', () => {
    expect(sanitizeString("it's")).toBe('it&#39;s');
  });

  it('should return non-string values unchanged', () => {
    expect(sanitizeString(42)).toBe(42);
    expect(sanitizeString(null)).toBe(null);
  });

  it('should handle empty string', () => {
    expect(sanitizeString('')).toBe('');
  });
});

describe('Utility: checkPasswordPolicy', () => {
  it('should reject passwords shorter than 8 characters', () => {
    expect(checkPasswordPolicy('Ab1!xyz')).toBe(false); // 7 chars
  });

  it('should reject passwords without uppercase', () => {
    expect(checkPasswordPolicy('abcd1234!')).toBe(false);
  });

  it('should reject passwords without lowercase', () => {
    expect(checkPasswordPolicy('ABCD1234!')).toBe(false);
  });

  it('should reject passwords without numbers', () => {
    expect(checkPasswordPolicy('Abcdefgh!')).toBe(false);
  });

  it('should reject passwords without special characters', () => {
    expect(checkPasswordPolicy('Abcdefg1')).toBe(false);
  });

  it('should accept passwords meeting all requirements', () => {
    expect(checkPasswordPolicy('MyP@ss1!')).toBe(true);
  });

  it('should reject non-string input', () => {
    expect(checkPasswordPolicy(12345678)).toBe(false);
    expect(checkPasswordPolicy(undefined)).toBe(false);
    expect(checkPasswordPolicy(null)).toBe(false);
  });
});

describe('Utility: validateFields', () => {
  it('should return error for missing required field', () => {
    const result = validateFields({}, { name: { required: true } });
    expect(result).toMatch(/name is required/);
  });

  it('should return error for wrong type', () => {
    const result = validateFields({ age: '25' }, { age: { type: 'number' } });
    expect(result).toMatch(/age must be a number/);
  });

  it('should return error for too-short string', () => {
    const result = validateFields({ name: 'ab' }, { name: { minLength: 3 } });
    expect(result).toMatch(/name must be at least 3 characters/);
  });

  it('should return error for too-long string', () => {
    const result = validateFields({ name: 'abcdef' }, { name: { maxLength: 5 } });
    expect(result).toMatch(/name must be at most 5 characters/);
  });

  it('should return error for pattern mismatch', () => {
    const result = validateFields({ email: 'notanemail' }, { email: { pattern: /^.+@.+$/ } });
    expect(result).toMatch(/email is invalid/);
  });

  it('should return null when all fields are valid', () => {
    const result = validateFields(
      { name: 'John', age: 30 },
      { name: { required: true, type: 'string', minLength: 2 }, age: { type: 'number' } }
    );
    expect(result).toBeNull();
  });
});

describe('Utility: safePath', () => {
  let tempDir;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safepath-test-'));
    fs.mkdirSync(path.join(tempDir, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'subdir', 'file.txt'), 'test');
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should resolve valid paths within base directory', () => {
    const result = safePath(tempDir, 'subdir');
    expect(result).not.toBeNull();
    expect(result.startsWith(tempDir) || result === tempDir).toBe(true);
  });

  it('should return the base directory itself for empty path', () => {
    const result = safePath(tempDir, '');
    expect(result).not.toBeNull();
  });

  it('should block path traversal with ../', () => {
    const result = safePath(tempDir, '../../../etc/passwd');
    expect(result).toBeNull();
  });

  it('should block path traversal with ..\\ (on Windows only)', () => {
    if (process.platform !== 'win32') {
      // Skip on non-Windows platforms where backslash is not a path separator
      expect(true).toBe(true);
      return;
    }
    const result = safePath(tempDir, '..\\..\\..\\windows\\system32');
    expect(result).toBeNull();
  });

  it('should block absolute paths outside base', () => {
    const outsidePath = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
    const result = safePath(tempDir, outsidePath);
    expect(result).toBeNull();
  });

  it('should allow nested paths within base', () => {
    const result = safePath(tempDir, 'subdir/file.txt');
    expect(result).not.toBeNull();
    expect(result.endsWith('file.txt')).toBe(true);
  });

  // Regression for audit C2: prefix-only-collision in the cross-platform
  // (Windows-base on non-Windows host) branch. Prior to the fix,
  // safePath('C:/DayZServer', '../DayZServerEvil/x') normalized to
  // 'C:/DayZServerEvil/x', which startsWith('C:/DayZServer') passed,
  // and the function returned a path outside the intended base.
  it('should reject sibling-prefix paths in Windows cross-platform branch', () => {
    if (process.platform === 'win32') {
      // Native branch uses realpathSync — different code path. Skip.
      expect(true).toBe(true);
      return;
    }
    expect(safePath('C:\\DayZServer', '..\\DayZServerEvil\\foo')).toBeNull();
    expect(safePath('C:\\DayZServer', '../DayZServerEvil/foo')).toBeNull();
    expect(safePath('C:\\DayZ', '..\\DayZBackup')).toBeNull();
  });

  it('should accept the base directory itself in cross-platform branch', () => {
    if (process.platform === 'win32') {
      expect(true).toBe(true);
      return;
    }
    // Empty userPath should return the base, not null.
    const r = safePath('C:\\DayZServer', '');
    expect(r).not.toBeNull();
  });

  it('should accept legitimate sub-paths in cross-platform branch', () => {
    if (process.platform === 'win32') {
      expect(true).toBe(true);
      return;
    }
    const r = safePath('C:\\DayZServer', 'mpmissions\\dayzOffline.chernarusplus');
    expect(r).not.toBeNull();
    expect(r).toMatch(/dayzOffline\.chernarusplus$/);
  });
});

// ─── API integration tests ─────────────────────────────────────
// These require the full Express app. The server.js IIFE starts
// polling and listening, but we use --forceExit to clean up.
const { app } = require('./server');

describe('API: Authentication', () => {
  let csrfToken = '';

  beforeAll(async () => {
    // Get CSRF token from a GET request (sets the csrf-token cookie)
    const res = await request(app).get('/api/servers');
    csrfToken = res.get('X-CSRF-Token');
  });

  it('should reject login with invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', `csrf-token=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'nonexistent', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/);
  });

  it('should reject requests without a token', async () => {
    const res = await request(app).get('/api/servers');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/No token/);
  });

  it('should reject requests with an invalid token', async () => {
    const res = await request(app)
      .get('/api/servers')
      .set('Authorization', 'Bearer invalid-token-here');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid.*token/);
  });

  it('should reject requests with an expired token', async () => {
    const expiredToken = jwt.sign(
      { id: 'test', username: 'test', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '0s' }
    );
    // Small delay to ensure expiry
    await new Promise(r => setTimeout(r, 100));
    const res = await request(app)
      .get('/api/servers')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });
});

describe('API: Rate Limiting', () => {
  it('should include rate limit headers on API responses', async () => {
    const res = await request(app).get('/api/servers');
    // express-rate-limit sets these headers
    expect(res.headers).toHaveProperty('ratelimit-limit');
  });
});

// Audit H6 Layer 1: every Discord-bot call now passes through the
// 'discord-bot' role's permission gate before being dispatched. Default
// role grants '*' so existing deployments keep working; narrowing the
// role makes denied actions return 403 with a useful error.
describe('API: Discord bot role gate', () => {
  const ctx = require('./lib/context');

  beforeAll(() => {
    process.env.DISCORD_BOT_API_KEY = process.env.DISCORD_BOT_API_KEY || 'test-discord-key';
  });

  it('should default-allow read actions when role has [*]', async () => {
    // Ensure role is at default (* permissions). The boot-time back-fill
    // in server.js inserts this role with '*' on cold start.
    const role = ctx.roles.find(r => r.id === 'discord-bot');
    expect(role).toBeDefined();
    expect(role.permissions).toContain('*');

    const res = await request(app)
      .post('/api/discord/action')
      .set('Authorization', `Bearer ${process.env.DISCORD_BOT_API_KEY}`)
      .send({ action: 'servers' });
    // 200 (servers list) or 500-from-internal-state — but NOT 403.
    // We just want to prove the gate didn't reject.
    expect(res.status).not.toBe(403);
  });

  it('should reject actions when discord-bot role is narrowed to exclude them', async () => {
    const role = ctx.roles.find(r => r.id === 'discord-bot');
    const original = [...role.permissions];
    // Narrow to view-only — restart should be denied.
    role.permissions = ['server.view'];

    try {
      const res = await request(app)
        .post('/api/discord/action')
        .set('Authorization', `Bearer ${process.env.DISCORD_BOT_API_KEY}`)
        .send({ action: 'restart' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/discord-bot.*role/);
      expect(res.body.error).toMatch(/server\.restart/);
    } finally {
      // Restore so other tests aren't affected.
      role.permissions = original;
    }
  });

  it('should still reject invalid actions before checking role permissions', async () => {
    const res = await request(app)
      .post('/api/discord/action')
      .set('Authorization', `Bearer ${process.env.DISCORD_BOT_API_KEY}`)
      .send({ action: 'definitely-not-a-valid-action' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid action/);
  });

  // Audit H6 Layer 2 — HMAC signature verification.
  it('should accept calls with a valid HMAC signature (verified attribution)', async () => {
    const crypto = require('crypto');
    const apiKey = process.env.DISCORD_BOT_API_KEY;
    const ts = Math.floor(Date.now() / 1000);
    const action = 'servers';
    const discordUserId = '123456789012345678';
    const payload = `${ts}.${action}.${discordUserId}`;
    const sig = crypto.createHmac('sha256', apiKey).update(payload).digest('hex');

    const res = await request(app)
      .post('/api/discord/action')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Discord-Ts', String(ts))
      .set('X-Discord-Sig', sig)
      .send({ action, params: { discordUserId } });
    expect(res.status).not.toBe(403);
  });

  it('should reject calls with an invalid HMAC signature (active forgery)', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const res = await request(app)
      .post('/api/discord/action')
      .set('Authorization', `Bearer ${process.env.DISCORD_BOT_API_KEY}`)
      .set('X-Discord-Ts', String(ts))
      .set('X-Discord-Sig', 'a'.repeat(64))  // wrong sig of correct length
      .send({ action: 'servers', params: { discordUserId: '1' } });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/signature.*rejected/i);
  });

  it('should reject calls with a stale timestamp (replay window)', async () => {
    const crypto = require('crypto');
    const apiKey = process.env.DISCORD_BOT_API_KEY;
    const ts = Math.floor(Date.now() / 1000) - 3600; // 1 hour old
    const action = 'servers';
    const discordUserId = '1';
    const payload = `${ts}.${action}.${discordUserId}`;
    const sig = crypto.createHmac('sha256', apiKey).update(payload).digest('hex');

    const res = await request(app)
      .post('/api/discord/action')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Discord-Ts', String(ts))
      .set('X-Discord-Sig', sig)
      .send({ action, params: { discordUserId } });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/stale/i);
  });

  it('should accept legacy bot calls without HMAC headers (unverified attribution)', async () => {
    // No X-Discord-Ts / X-Discord-Sig — the verifier returns no-sig and
    // the handler falls through to the unverified-attribution branch
    // instead of rejecting. Existing H6 Layer 1 'servers' test already
    // exercises this path; this test makes the contract explicit.
    const res = await request(app)
      .post('/api/discord/action')
      .set('Authorization', `Bearer ${process.env.DISCORD_BOT_API_KEY}`)
      .send({ action: 'servers' });
    expect(res.status).not.toBe(403);
  });
});

// Audit H6 Layer 3 — per-Discord-user → Citadel role mapping. When the
// HMAC-verified call's discordUserId appears in ctx.discordUserRoles,
// the mapped role's permissions decide what actions are allowed (instead
// of the default discord-bot role). Unmapped or unverified calls keep
// the default, so the upgrade is non-breaking.
describe('API: Discord per-user role mapping (audit H6 layer 3)', () => {
  const ctx = require('./lib/context');
  const crypto = require('crypto');
  const apiKey = process.env.DISCORD_BOT_API_KEY || 'test-discord-key';

  // Helper — sign a call exactly the way discord-bot/api.js does.
  function makeSignedCall(action, discordUserId) {
    const ts = Math.floor(Date.now() / 1000);
    const payload = `${ts}.${action}.${discordUserId}`;
    const sig = crypto.createHmac('sha256', apiKey).update(payload).digest('hex');
    return { ts, sig };
  }

  beforeAll(() => {
    process.env.DISCORD_BOT_API_KEY = apiKey;
    // Custom narrow role so we can prove a per-user mapping promotes the
    // user's permissions above what the default discord-bot role allows.
    ctx.roles.push({
      id: 'h6l3-restart-only',
      name: 'H6L3 Restart-Only',
      permissions: ['server.view', 'server.restart'],
    });
    if (!ctx.discordUserRoles) ctx.discordUserRoles = {};
  });

  afterAll(() => {
    ctx.roles = ctx.roles.filter(r => r.id !== 'h6l3-restart-only');
    delete ctx.discordUserRoles['111111111111111111'];
    delete ctx.discordUserRoles['222222222222222222'];
    // Restore default discord-bot role permissions in case a test mutated.
    const defRole = ctx.roles.find(r => r.id === 'discord-bot');
    if (defRole && !defRole.permissions.includes('*')) defRole.permissions = ['*'];
  });

  it('should resolve to per-user role on HMAC-verified call when mapped', async () => {
    // Narrow the default role and add a mapping that grants more.
    const defRole = ctx.roles.find(r => r.id === 'discord-bot');
    const originalDefault = [...defRole.permissions];
    defRole.permissions = ['server.view'];                     // default = read-only
    ctx.discordUserRoles['111111111111111111'] = 'h6l3-restart-only'; // user gets restart

    try {
      const action = 'restart';
      const userId = '111111111111111111';
      const { ts, sig } = makeSignedCall(action, userId);
      const res = await request(app)
        .post('/api/discord/action')
        .set('Authorization', `Bearer ${apiKey}`)
        .set('X-Discord-Ts', String(ts))
        .set('X-Discord-Sig', sig)
        .send({ action, params: { discordUserId: userId } });
      // We expect either 200 (no servers configured -> 400 "No server")
      // or some operational error from the lifecycle code, but NOT 403.
      // The role gate must NOT reject because the mapped role allows it.
      expect(res.status).not.toBe(403);
    } finally {
      defRole.permissions = originalDefault;
    }
  });

  it('should fall back to default role for unmapped Discord users', async () => {
    const defRole = ctx.roles.find(r => r.id === 'discord-bot');
    const originalDefault = [...defRole.permissions];
    defRole.permissions = ['server.view'];        // default does NOT allow restart
    // No mapping for user 222... — must use default and get denied.

    try {
      const action = 'restart';
      const userId = '222222222222222222';
      const { ts, sig } = makeSignedCall(action, userId);
      const res = await request(app)
        .post('/api/discord/action')
        .set('Authorization', `Bearer ${apiKey}`)
        .set('X-Discord-Ts', String(ts))
        .set('X-Discord-Sig', sig)
        .send({ action, params: { discordUserId: userId } });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/discord-bot/);
    } finally {
      defRole.permissions = originalDefault;
    }
  });

  it('should NOT use per-user mapping for unsigned legacy calls (identity is not trusted)', async () => {
    // If a legacy bot call could pick its mapping by setting
    // discordUserId in the body, the whole point of HMAC verification
    // (Layer 2) collapses. Verify the mapping is only applied when
    // verified.ok is true.
    const defRole = ctx.roles.find(r => r.id === 'discord-bot');
    const originalDefault = [...defRole.permissions];
    defRole.permissions = ['server.view'];
    ctx.discordUserRoles['111111111111111111'] = 'h6l3-restart-only';

    try {
      // Legacy unsigned call claiming to be the privileged user.
      const res = await request(app)
        .post('/api/discord/action')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ action: 'restart', params: { discordUserId: '111111111111111111' } });
      // Must be denied: the claimed userId is unverified, so the per-user
      // mapping is ignored and the narrow default-role permissions apply.
      expect(res.status).toBe(403);
    } finally {
      defRole.permissions = originalDefault;
    }
  });
});

describe('API: Discord user-role mapping CRUD', () => {
  const ctx = require('./lib/context');
  let agent;
  let csrfNonce = '';
  let adminToken = '';
  const adminId = 'h6l3-crud-admin';

  beforeAll(async () => {
    agent = request.agent(app);
    const ping = await agent.get('/api/servers');
    csrfNonce = ping.get('X-CSRF-Token');

    ctx.users.push({ id: adminId, username: 'h6l3admin', role: 'admin', passwordHash: '$2a$10$fake' });
    adminToken = jwt.sign({ id: adminId, username: 'h6l3admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' });

    if (!ctx.discordUserRoles) ctx.discordUserRoles = {};
  });

  afterAll(() => {
    ctx.users = ctx.users.filter(u => u.id !== adminId);
    delete ctx.discordUserRoles['333333333333333333'];
  });

  it('should reject mapping requests without admin auth', async () => {
    const res = await agent
      .put('/api/discord/user-roles/333333333333333333')
      .set('X-CSRF-Token', csrfNonce)
      .send({ roleId: 'admin' });
    expect(res.status).toBe(401);
  });

  it('should reject malformed Discord snowflake in URL', async () => {
    const res = await agent
      .put('/api/discord/user-roles/not-a-snowflake')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ roleId: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/snowflake/);
  });

  it('should reject mapping to a non-existent role', async () => {
    const res = await agent
      .put('/api/discord/user-roles/333333333333333333')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ roleId: 'role-that-does-not-exist' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown role/);
  });

  it('should create a mapping then list it then delete it', async () => {
    const userId = '333333333333333333';

    const create = await agent
      .put(`/api/discord/user-roles/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ roleId: 'admin' });
    expect(create.status).toBe(200);
    expect(create.body.discordUserId).toBe(userId);
    expect(create.body.roleId).toBe('admin');

    const list = await agent
      .get('/api/discord/user-roles')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const found = list.body.mappings.find(m => m.discordUserId === userId);
    expect(found).toBeDefined();
    expect(found.roleId).toBe('admin');
    expect(found.orphaned).toBe(false);

    const del = await agent
      .delete(`/api/discord/user-roles/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrfNonce);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
  });
});

// Audit H8: writing a script file (.bat/.cmd/.ps1/.sh) requires the new
// 'files.edit-scripts' permission AND the destination must be inside the
// server's lifecycle_hooks/ directory. Plain 'files.edit' is no longer
// sufficient on its own. The auto-executed-by-lifecycle-hooks risk is
// the reason this gate exists; see backend/lib/lifecycle-hooks.js.
//
// Uses request.agent(app) so supertest captures the signed csrf-token
// cookie issued on the first GET. The pre-existing tests in this file
// hand-build a 'csrf-token=<nonce>' header which is wrong — the cookie
// must hold the SIGNED nonce, not the nonce itself. The agent does that
// correctly. (That's also why the password-policy test fails in baseline.)
describe('API: files.edit-scripts gate', () => {
  const ctx = require('./lib/context');
  let agent;
  let csrfNonce = '';
  let serverId;
  let installDir;
  let tokenScriptOnly = '';
  let tokenWildcard = '';

  beforeAll(async () => {
    agent = request.agent(app);
    const ping = await agent.get('/api/servers');
    csrfNonce = ping.get('X-CSRF-Token');

    // Build a temp server we can write scripts into so we don't accidentally
    // touch a real server's installDir during the test run.
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h8-server-'));
    fs.mkdirSync(path.join(installDir, 'lifecycle_hooks'), { recursive: true });
    serverId = 'h8-test-server';
    ctx.servers.push({ id: serverId, name: 'H8 Test', installDir });

    // Two test roles: one with files.edit + files.edit-scripts (allowed),
    // one with only files.edit (blocked by the new gate).
    ctx.roles.push({
      id: 'h8-script-writer',
      name: 'H8 Script Writer',
      permissions: ['files.edit', 'files.edit-scripts', 'server.view'],
    });
    ctx.roles.push({
      id: 'h8-config-only',
      name: 'H8 Config Only',
      permissions: ['files.edit', 'server.view'],
    });

    // Two test users sharing the same installDir.
    const u1 = { id: 'h8-u1', username: 'h8scripts', role: 'h8-script-writer', passwordHash: '$2a$10$fake' };
    const u2 = { id: 'h8-u2', username: 'h8config', role: 'h8-config-only', passwordHash: '$2a$10$fake' };
    ctx.users.push(u1, u2);

    tokenScriptOnly = jwt.sign({ id: u2.id, username: u2.username, role: u2.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
    tokenWildcard = jwt.sign({ id: u1.id, username: u1.username, role: u1.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
  });

  afterAll(() => {
    ctx.servers = ctx.servers.filter(s => s.id !== serverId);
    ctx.users = ctx.users.filter(u => u.id !== 'h8-u1' && u.id !== 'h8-u2');
    ctx.roles = ctx.roles.filter(r => r.id !== 'h8-script-writer' && r.id !== 'h8-config-only');
    try { fs.rmSync(installDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('should allow .cfg writes for files.edit users (no script-perm needed)', async () => {
    const res = await agent
      .put(`/api/servers/${serverId}/files/write`)
      .set('Authorization', `Bearer ${tokenScriptOnly}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ file: 'test.cfg', content: 'hello = world;' });
    expect(res.status).toBe(200);
  });

  it('should reject .ps1 writes when role lacks files.edit-scripts', async () => {
    const res = await agent
      .put(`/api/servers/${serverId}/files/write`)
      .set('Authorization', `Bearer ${tokenScriptOnly}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ file: 'lifecycle_hooks/lifecycle.pre-start.ps1', content: 'Write-Host "hi"' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/files\.edit-scripts/);
  });

  it('should reject .ps1 writes outside lifecycle_hooks/ even with files.edit-scripts', async () => {
    const res = await agent
      .put(`/api/servers/${serverId}/files/write`)
      .set('Authorization', `Bearer ${tokenWildcard}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ file: 'evil.ps1', content: 'Write-Host "pwn"' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/lifecycle_hooks/);
  });

  it('should accept .ps1 writes inside lifecycle_hooks/ with files.edit-scripts', async () => {
    const res = await agent
      .put(`/api/servers/${serverId}/files/write`)
      .set('Authorization', `Bearer ${tokenWildcard}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ file: 'lifecycle_hooks/lifecycle.pre-start.ps1', content: 'Write-Host "hi"' });
    expect(res.status).toBe(200);
    // Verify the file actually landed where the gate said it must.
    expect(fs.existsSync(path.join(installDir, 'lifecycle_hooks', 'lifecycle.pre-start.ps1'))).toBe(true);
  });
});

describe('API: Password Policy Enforcement', () => {
  const testAdminId = 'test-admin-for-jest';
  // Use request.agent so supertest captures the SIGNED csrf-token cookie
  // from the first GET. The hand-built 'csrf-token=<nonce>' approach is
  // wrong (cookie should hold the signed token, not the nonce); see the
  // comment in the H8 test block above for the full reasoning.
  let agent;
  let csrfNonce = '';

  beforeAll(async () => {
    agent = request.agent(app);
    const res = await agent.get('/api/servers');
    csrfNonce = res.get('X-CSRF-Token');

    // Inject a test admin user into the runtime context so auth middleware passes
    const ctx = require('./lib/context');
    ctx.users.push({
      id: testAdminId,
      username: 'jestadmin',
      passwordHash: '$2a$10$fakehash',
      role: 'admin',
    });
  });

  afterAll(() => {
    const ctx = require('./lib/context');
    ctx.users = ctx.users.filter(u => u.id !== testAdminId);
  });

  it('should reject user creation with weak password', async () => {
    const token = jwt.sign(
      { id: testAdminId, username: 'jestadmin', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const res = await agent
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ username: 'testuser', password: 'short', role: 'viewer' });
    expect(res.status).toBe(400);
    // validateFields checks minLength first, then checkPasswordPolicy runs
    expect(res.body.error).toMatch(/password/i);
  });
});

describe('API: Backup Endpoint Auth', () => {
  it('should require authentication for backup endpoint', async () => {
    const res = await request(app).get('/api/backup/users');
    expect(res.status).toBe(401);
  });
});

// Audit M11 — JWT now travels in an HttpOnly auth-token cookie set by
// /api/auth/login. The middleware reads from the cookie first and falls
// back to Authorization: Bearer. Tests below cover both paths so a
// future refactor that breaks one form is caught immediately.
describe('API: auth cookie (audit M11)', () => {
  const ctx = require('./lib/context');
  const m11AdminId = 'm11-cookie-admin';

  beforeAll(() => {
    ctx.users.push({
      id: m11AdminId,
      username: 'm11admin',
      passwordHash: '$2a$10$fake',
      role: 'admin',
    });
  });

  afterAll(() => {
    ctx.users = ctx.users.filter(u => u.id !== m11AdminId);
  });

  it('should accept a valid auth-token cookie (no Bearer header)', async () => {
    const token = jwt.sign(
      { id: m11AdminId, username: 'm11admin', role: 'admin' },
      process.env.JWT_SECRET, { expiresIn: '5m' }
    );
    const res = await request(app)
      .get('/api/servers')
      .set('Cookie', `auth-token=${token}`);
    expect(res.status).toBe(200);
  });

  it('should still accept Bearer header (compat fallback)', async () => {
    const token = jwt.sign(
      { id: m11AdminId, username: 'm11admin', role: 'admin' },
      process.env.JWT_SECRET, { expiresIn: '5m' }
    );
    const res = await request(app)
      .get('/api/servers')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('should prefer cookie over Bearer when both are present', async () => {
    const cookieToken = jwt.sign(
      { id: m11AdminId, username: 'm11admin', role: 'admin' },
      process.env.JWT_SECRET, { expiresIn: '5m' }
    );
    const res = await request(app)
      .get('/api/servers')
      .set('Cookie', `auth-token=${cookieToken}`)
      .set('Authorization', 'Bearer this-is-deliberately-garbage');
    // Cookie wins → request succeeds despite the garbage Bearer header.
    expect(res.status).toBe(200);
  });

  it('should 401 when neither cookie nor Bearer is present', async () => {
    const res = await request(app).get('/api/servers');
    expect(res.status).toBe(401);
  });

  it('should clear the auth-token cookie on /api/auth/logout', async () => {
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
    // Set-Cookie should include a clearing directive for auth-token.
    const setCookies = res.headers['set-cookie'] || [];
    const found = setCookies.find(c => c.startsWith('auth-token='));
    expect(found).toBeDefined();
    // clearCookie sends an empty value with Expires=Thu, 01 Jan 1970...
    expect(/auth-token=;/.test(found) || /auth-token=$/.test(found.split(';')[0])).toBe(true);
  });
});

// ─── Audit L30 — smoke tests for the deep paths the audit found issues in.
// Each describe block is independent; uses request.agent(app) for correct
// CSRF cookie capture (see H8 block for rationale).

// Audit C5 regression: once the first-run marker exists, every setup
// endpoint must return 403 — even if data/setup_complete.json was deleted.
// Without this lock, deleting setup_complete.json re-armed the wizard and
// allowed an unauthenticated caller to overwrite the root admin's
// username + password. See backend/routes/setup.routes.js getSetupState().
describe('API: setup wizard lock (audit C5)', () => {
  const fs = require('fs');
  const path = require('path');
  const ctx = require('./lib/context');

  // Ensure the marker exists for these tests. Boot path normally writes it
  // when the admin is created or any non-default state is detected; we
  // force it here so the wizard is locked regardless of test-app state.
  let markerPath;
  let createdMarker = false;

  beforeAll(() => {
    markerPath = path.join(ctx.CONFIG.dataDir, '.first-run-completed');
    if (!fs.existsSync(markerPath)) {
      fs.mkdirSync(ctx.CONFIG.dataDir, { recursive: true });
      fs.writeFileSync(markerPath, JSON.stringify({ completedAt: new Date().toISOString() }) + '\n');
      createdMarker = true;
    }
  });

  afterAll(() => {
    // Only remove the marker if we created it — don't clobber a real one.
    if (createdMarker) {
      try { fs.unlinkSync(markerPath); } catch { /* best effort */ }
    }
  });

  it('should refuse /api/setup/admin once the first-run marker exists', async () => {
    const agent = request.agent(app);
    const ping = await agent.get('/api/servers');
    const csrf = ping.get('X-CSRF-Token');

    const res = await agent
      .post('/api/setup/admin')
      .set('X-CSRF-Token', csrf)
      .send({ username: 'attacker', password: 'NewPassword!1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/setup.*completed/i);
  });

  it('should refuse /api/setup/network once the first-run marker exists', async () => {
    const agent = request.agent(app);
    const ping = await agent.get('/api/servers');
    const csrf = ping.get('X-CSRF-Token');

    const res = await agent
      .post('/api/setup/network')
      .set('X-CSRF-Token', csrf)
      .send({ ip: '10.0.0.1' });
    expect(res.status).toBe(403);
  });

  it('should report needsSetup=false on /api/setup/status when marker exists', async () => {
    const res = await request(app).get('/api/setup/status');
    expect(res.status).toBe(200);
    expect(res.body.needsSetup).toBe(false);
  });
});

// CSRF enforcement on /api/* state-changing requests. The double-submit
// pattern requires both:
//   - the SIGNED token in the csrf-token cookie, and
//   - the matching nonce echoed back in the X-CSRF-Token header.
// A request missing either should be rejected. The exempt list in
// backend/middleware/csrf.js covers /api/auth/login, /api/setup/, /api/health,
// /api/store/webhook, /api/discord/ — everything else must verify.
describe('API: CSRF enforcement (audit C1+C4)', () => {
  it('should reject POST /api/users without an X-CSRF-Token header', async () => {
    const agent = request.agent(app);
    // Capture the signed cookie so we know it's not the cookie that's missing.
    await agent.get('/api/servers');
    const res = await agent.post('/api/users').send({ username: 'x', password: 'y' });
    // No header → 403 'CSRF token missing' from the middleware (precedes auth).
    expect(res.status).toBe(403);
  });

  it('should reject POST /api/users with a wrong X-CSRF-Token nonce', async () => {
    const agent = request.agent(app);
    await agent.get('/api/servers');
    const res = await agent
      .post('/api/users')
      .set('X-CSRF-Token', 'not-a-real-nonce-' + Date.now())
      .send({ username: 'x', password: 'y' });
    expect(res.status).toBe(403);
  });

  it('should accept the request once both cookie + matching nonce are present', async () => {
    const agent = request.agent(app);
    const ping = await agent.get('/api/servers');
    const csrf = ping.get('X-CSRF-Token');

    // No auth token → 401, but that's PAST CSRF (CSRF would have 403'd first).
    // The point of this test is to prove the CSRF gate opens for valid pairs.
    const res = await agent
      .post('/api/users')
      .set('X-CSRF-Token', csrf)
      .send({ username: 'x', password: 'y' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });
});

// Audit M13 regression: the 'can edit other users' check now reads the
// role's permissions instead of comparing role.id literally to 'admin'.
// A non-admin user with users.manage can edit themselves but not others.
describe('API: users.routes permission gate (audit M13)', () => {
  const ctx = require('./lib/context');
  let agent;
  let csrfNonce = '';
  const userManagerId = 'l30-user-manager';
  const targetUserId = 'l30-target';

  beforeAll(async () => {
    agent = request.agent(app);
    const ping = await agent.get('/api/servers');
    csrfNonce = ping.get('X-CSRF-Token');

    ctx.roles.push({
      id: 'l30-user-manager-role',
      name: 'L30 User Manager (Self-Only)',
      // Has users.manage but not '*' — middleware lets them in, but the
      // canManageOthers helper inside users.routes.js should still block
      // edits to other users.
      permissions: ['users.manage', 'server.view'],
    });
    ctx.users.push(
      { id: userManagerId, username: 'l30mgr', role: 'l30-user-manager-role', passwordHash: '$2a$10$fake' },
      { id: targetUserId, username: 'l30target', role: 'viewer', passwordHash: '$2a$10$fake' },
    );
  });

  afterAll(() => {
    ctx.users = ctx.users.filter(u => u.id !== userManagerId && u.id !== targetUserId);
    ctx.roles = ctx.roles.filter(r => r.id !== 'l30-user-manager-role');
  });

  it('should reject editing another user when the actor lacks wildcard permission', async () => {
    const token = jwt.sign(
      { id: userManagerId, username: 'l30mgr', role: 'l30-user-manager-role' },
      process.env.JWT_SECRET, { expiresIn: '5m' }
    );
    const res = await agent
      .patch(`/api/users/${targetUserId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ username: 'pwned' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/your own/i);
  });

  it('should allow editing self even with non-wildcard role', async () => {
    const token = jwt.sign(
      { id: userManagerId, username: 'l30mgr', role: 'l30-user-manager-role' },
      process.env.JWT_SECRET, { expiresIn: '5m' }
    );
    const res = await agent
      .patch(`/api/users/${userManagerId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrfNonce)
      .send({ description: 'self-update test' });
    expect(res.status).toBe(200);
  });

  it('should allow admin (wildcard) to edit any non-root user', async () => {
    // Use a synthetic admin user that won't collide with the running app's
    // real admin. Role 'admin' has '*' permissions in the default seed.
    const adminId = 'l30-admin-edit-test';
    ctx.users.push({ id: adminId, username: 'l30admin', role: 'admin', passwordHash: '$2a$10$fake' });
    try {
      const token = jwt.sign(
        { id: adminId, username: 'l30admin', role: 'admin' },
        process.env.JWT_SECRET, { expiresIn: '5m' }
      );
      const res = await agent
        .patch(`/api/users/${targetUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', csrfNonce)
        .send({ description: 'admin-edit test' });
      expect(res.status).toBe(200);
    } finally {
      ctx.users = ctx.users.filter(u => u.id !== adminId);
    }
  });
});
