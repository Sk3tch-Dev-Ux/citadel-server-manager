/**
 * Regression tests for the multi-tenant authorization fixes from the
 * June 2026 audit (see AUDIT_2026-06.md §9). These lock in the behaviour so a
 * future refactor can't silently reopen the cross-tenant gaps:
 *
 *   C3 — auth()/authForServer() accept an "any-of" permission ARRAY. The old
 *        code did role.permissions.includes(requiredPermission) which, for an
 *        array argument, scanned for the array object itself and silently 403'd
 *        every non-wildcard role (broke license activation, cloud-bans, pvp).
 *   C4 — getUserServerScope() limits a serverScope-restricted role to its own
 *        server ids (used to filter GET /api/servers and the batch route).
 *   C1 — emitServer() delivers per-server realtime events to the scoped
 *        'server:<id>' ∪ 'servers:all' rooms instead of broadcasting globally,
 *        so a scope-limited operator can't see another tenant's live data.
 *
 * Pure-unit on purpose: requires only the middleware + context singletons, so
 * it boots no server and opens no handles.
 */
const auth = require('../middleware/auth');
const ctx = require('../lib/context');

describe('C3 — roleHasPermission (any-of array support)', () => {
  const { roleHasPermission } = auth;

  test('single-string permission still matches exactly', () => {
    expect(roleHasPermission({ permissions: ['b'] }, 'b')).toBe(true);
    expect(roleHasPermission({ permissions: ['b'] }, 'a')).toBe(false);
  });

  test('any-of array matches when the role holds at least one (the C3 regression)', () => {
    expect(roleHasPermission({ permissions: ['b'] }, ['a', 'b'])).toBe(true);
    expect(roleHasPermission({ permissions: ['b'] }, ['a', 'c'])).toBe(false);
  });

  test('wildcard role satisfies any string or array requirement', () => {
    expect(roleHasPermission({ permissions: ['*'] }, 'anything')).toBe(true);
    expect(roleHasPermission({ permissions: ['*'] }, ['x', 'y'])).toBe(true);
  });

  test('no required permission is always allowed', () => {
    expect(roleHasPermission({ permissions: [] }, undefined)).toBe(true);
  });
});

describe('C4 — getUserServerScope', () => {
  let users; let roles;
  beforeEach(() => { users = ctx.users; roles = ctx.roles; });
  afterEach(() => { ctx.users = users; ctx.roles = roles; });

  test('wildcard role => null (sees all servers)', () => {
    ctx.users = [{ id: 'u1', role: 'admin' }];
    ctx.roles = [{ id: 'admin', permissions: ['*'] }];
    expect(auth.getUserServerScope('u1')).toBeNull();
  });

  test('role with no serverScope => null (sees all servers)', () => {
    ctx.users = [{ id: 'u2', role: 'mod' }];
    ctx.roles = [{ id: 'mod', permissions: ['server.view'] }];
    expect(auth.getUserServerScope('u2')).toBeNull();
  });

  test('scope-limited role => only its own server ids', () => {
    ctx.users = [{ id: 'u3', role: 'scoped' }];
    ctx.roles = [{ id: 'scoped', permissions: ['server.view'], serverScope: ['A', 'B'] }];
    expect(auth.getUserServerScope('u3')).toEqual(['A', 'B']);
  });

  test('unknown user => [] (no access, fail closed)', () => {
    ctx.users = [];
    ctx.roles = [];
    expect(auth.getUserServerScope('nope')).toEqual([]);
  });
});

describe('C1 — emitServer scopes per-server events to rooms', () => {
  let realIo;
  beforeEach(() => { realIo = ctx.io; });
  afterEach(() => { ctx.io = realIo; });

  // Records .to() room targets and whether emit went through the room chain
  // (scoped) or the bare io.emit (global).
  function fakeIo() {
    const calls = { to: [], emit: [] };
    const chain = {
      to(room) { calls.to.push(room); return chain; },
      emit(event, payload) { calls.emit.push({ event, payload, scoped: true }); },
    };
    return {
      calls,
      to(room) { calls.to.push(room); return chain; },
      emit(event, payload) { calls.emit.push({ event, payload, scoped: false }); },
    };
  }

  test('payload with serverId emits to server:<id> ∪ servers:all, never globally', () => {
    const io = fakeIo();
    ctx.io = io;
    ctx.emitServer('players', { serverId: 'A', list: [] });
    expect(io.calls.to).toEqual(['server:A', 'servers:all']);
    expect(io.calls.emit).toHaveLength(1);
    expect(io.calls.emit[0].scoped).toBe(true); // delivered via the room chain, not a global broadcast
    expect(io.calls.emit[0].event).toBe('players');
  });

  test('payload without a serverId falls back to a global emit (can\'t be attributed/scoped)', () => {
    const io = fakeIo();
    ctx.io = io;
    ctx.emitServer('notice', { msg: 'hi' });
    expect(io.calls.to).toEqual([]);
    expect(io.calls.emit).toHaveLength(1);
    expect(io.calls.emit[0].scoped).toBe(false); // bare io.emit
  });

  test('no-op when io is not initialised', () => {
    ctx.io = null;
    expect(() => ctx.emitServer('players', { serverId: 'A' })).not.toThrow();
  });
});
