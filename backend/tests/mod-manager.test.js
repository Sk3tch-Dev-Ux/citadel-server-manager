'use strict';

const ctx = require('../lib/context');
const { flushAll } = require('../lib/data-store');
const {
  extractParamValue, updateLaunchParamsMods, reorderMods, setModType,
} = require('../lib/mod-manager');

// updateLaunchParamsMods queues a debounced saveJSON; flush it after each test
// so no write timer lingers as an open handle.
afterEach(() => flushAll());

// updateLaunchParamsMods persists via saveJSON(ctx.CONFIG.dataDir, ...). The
// test setup (tests/setup-env.js) already redirects the data dir to a temp
// location, so writes are harmless; we only assert in-memory effects.
function setupServer(modList, launchParams = '') {
  ctx.servers = [{ id: 's1', name: 'S1', installDir: 'C:/dz', launchParams }];
  ctx.serverStates = { s1: { modList } };
  ctx.io = null;
}

describe('extractParamValue', () => {
  test('extracts a single -mod value', () => {
    expect(extractParamValue('-config=x.cfg -mod=@A;@B -port=2302', 'mod')).toBe('@A;@B');
  });

  test('extracts a value at the end of the string', () => {
    expect(extractParamValue('-port=2302 -mod=@A;@B', 'mod')).toBe('@A;@B');
  });

  test('returns empty string when the param is absent', () => {
    expect(extractParamValue('-port=2302', 'mod')).toBe('');
  });

  test('strips surrounding quotes', () => {
    expect(extractParamValue('-mod="@A;@B"', 'mod')).toBe('@A;@B');
  });

  test('does not confuse -mod with -serverMod', () => {
    // Asking for 'mod' must not capture the -serverMod value.
    expect(extractParamValue('-serverMod=@S -port=2302', 'mod')).toBe('');
    expect(extractParamValue('-serverMod=@S', 'serverMod')).toBe('@S');
  });

  test('handles mod folder names containing spaces (no false cut)', () => {
    expect(extractParamValue('-mod=@Mod With Space;@B -port=2302', 'mod')).toBe('@Mod With Space;@B');
  });
});

describe('updateLaunchParamsMods', () => {
  test('builds -mod from enabled client mods and -serverMod from server mods', () => {
    setupServer([
      { name: '@A', enabled: true, type: 'client', order: 0 },
      { name: '@B', enabled: true, type: 'server', order: 1 },
      { name: '@C', enabled: false, type: 'client', order: 2 }, // disabled → excluded
    ], '-port=2302');
    updateLaunchParamsMods('s1');
    const p = ctx.servers[0].launchParams;
    expect(p).toContain('-port=2302');
    expect(p).toContain('-mod=@A');
    expect(p).toContain('-serverMod=@B');
    expect(p).not.toContain('@C');
  });

  test('strips and replaces existing -mod/-serverMod (no duplication)', () => {
    setupServer([{ name: '@A', enabled: true, type: 'client', order: 0 }],
      '-mod=@OLD;@STALE -serverMod=@OLDSRV -port=2302');
    updateLaunchParamsMods('s1');
    const p = ctx.servers[0].launchParams;
    expect((p.match(/-mod=/g) || []).length).toBe(1);
    expect(p).not.toContain('@OLD');
    expect(p).not.toContain('@OLDSRV');
    expect(p).toContain('-mod=@A');
    expect(p).toContain('-port=2302');
  });

  test('removes the -mod param entirely when no mods are enabled', () => {
    setupServer([{ name: '@A', enabled: false, type: 'client', order: 0 }], '-mod=@A -port=2302');
    updateLaunchParamsMods('s1');
    expect(ctx.servers[0].launchParams).not.toContain('-mod=');
    expect(ctx.servers[0].launchParams).toContain('-port=2302');
  });

  test('treats missing type as client', () => {
    setupServer([{ name: '@A', enabled: true, order: 0 }], '');
    updateLaunchParamsMods('s1');
    expect(ctx.servers[0].launchParams).toContain('-mod=@A');
  });
});

describe('reorderMods', () => {
  beforeEach(() => {
    setupServer([
      { name: '@A', enabled: true, type: 'client', order: 0 },
      { name: '@B', enabled: true, type: 'client', order: 1 },
      { name: '@C', enabled: true, type: 'client', order: 2 },
    ], '');
  });

  test('reorders to the requested order and renumbers', () => {
    reorderMods('s1', ['@C', '@A', '@B']);
    const names = ctx.serverStates.s1.modList.map((m) => m.name);
    expect(names).toEqual(['@C', '@A', '@B']);
    expect(ctx.serverStates.s1.modList.map((m) => m.order)).toEqual([0, 1, 2]);
  });

  test('appends mods not present in the ordered list', () => {
    reorderMods('s1', ['@C']); // only one specified
    const names = ctx.serverStates.s1.modList.map((m) => m.name);
    expect(names[0]).toBe('@C');
    expect(names).toContain('@A');
    expect(names).toContain('@B');
    expect(names).toHaveLength(3);
  });

  test('ignores unknown mod names in the order list', () => {
    reorderMods('s1', ['@DOESNOTEXIST', '@B']);
    const names = ctx.serverStates.s1.modList.map((m) => m.name);
    expect(names[0]).toBe('@B');
    expect(names).not.toContain('@DOESNOTEXIST');
    expect(names).toHaveLength(3);
  });

  test('reflects the new order in launch params', () => {
    reorderMods('s1', ['@C', '@B', '@A']);
    expect(ctx.servers[0].launchParams).toContain('-mod=@C;@B;@A');
  });
});

describe('setModType', () => {
  beforeEach(() => {
    setupServer([{ name: '@A', enabled: true, type: 'client', order: 0 }], '');
  });

  test('changes a mod type and moves it to -serverMod', () => {
    const result = setModType('s1', '@A', 'server');
    expect(result.type).toBe('server');
    expect(ctx.servers[0].launchParams).toContain('-serverMod=@A');
    expect(ctx.servers[0].launchParams).not.toContain('-mod=@A');
  });

  test('returns null for an unknown mod', () => {
    expect(setModType('s1', '@NOPE', 'server')).toBeNull();
  });
});
