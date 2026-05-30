'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ctx = require('../lib/context');
// server.js normally does this; tests load lib modules without it.
ctx.CONFIG = require('../lib/config');
const { flushAll } = require('../lib/data-store');
const integrity = require('../lib/integrity-engine');

let installDir;
let sid;          // unique per test so the engine's persisted store can't bleed across cases
let _counter = 0;

function writePbo(folder, rel, content) {
  const full = path.join(installDir, folder, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function setupServer() {
  installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-integrity-'));
  sid = `srv-${++_counter}`;
  // Two enabled mods, each with a PBO in addons/.
  writePbo('@ModA', 'addons/a.pbo', 'AAAA');
  writePbo('@ModB', 'addons/b.pbo', 'BBBB');
  ctx.servers = [{ id: sid, name: 'S1', installDir, gameTitle: 'DayZ, PC' }];
  ctx.serverStates = { [sid]: { logs: [], modList: [
    { name: '@ModA', enabled: true },
    { name: '@ModB', enabled: true },
  ] } };
  ctx.notifications = [];
  ctx.io = null;
}

afterEach(() => { flushAll(); if (installDir) fs.rmSync(installDir, { recursive: true, force: true }); });
beforeEach(() => setupServer());

describe('fingerprintFolder', () => {
  test('is stable for unchanged bytes and changes when a PBO changes', async () => {
    const a1 = await integrity.fingerprintFolder(path.join(installDir, '@ModA'));
    const a2 = await integrity.fingerprintFolder(path.join(installDir, '@ModA'));
    expect(a1.hash).toBe(a2.hash);
    expect(a1.pboCount).toBe(1);
    writePbo('@ModA', 'addons/a.pbo', 'AAAA-CHANGED');
    const a3 = await integrity.fingerprintFolder(path.join(installDir, '@ModA'));
    expect(a3.hash).not.toBe(a1.hash);
  });

  test('returns null for a missing folder', async () => {
    expect(await integrity.fingerprintFolder(path.join(installDir, '@Nope'))).toBeNull();
  });
});

describe('snapshot + drift', () => {
  test('a fresh snapshot reports no drift', async () => {
    const { count } = await integrity.snapshotServer(sid);
    expect(count).toBe(2);
    const drift = await integrity.checkServerDrift(sid, { notify: false });
    expect(drift.ok).toBe(true);
    expect(drift.drifted).toEqual([]);
  });

  test('detects a changed mod as drift', async () => {
    await integrity.snapshotServer(sid);
    writePbo('@ModB', 'addons/b.pbo', 'BBBB-TAMPERED');
    const drift = await integrity.checkServerDrift(sid, { notify: false });
    expect(drift.ok).toBe(false);
    expect(drift.drifted).toContain('@ModB');
    expect(drift.drifted).not.toContain('@ModA');
  });

  test('detects a missing mod folder', async () => {
    await integrity.snapshotServer(sid);
    fs.rmSync(path.join(installDir, '@ModA'), { recursive: true, force: true });
    const drift = await integrity.checkServerDrift(sid, { notify: false });
    expect(drift.missing).toContain('@ModA');
    expect(drift.ok).toBe(false);
  });

  test('auto-baselines a mod that has no snapshot yet', async () => {
    // No snapshotServer() call — first check adopts current state as trusted.
    const first = await integrity.checkServerDrift(sid, { notify: false });
    expect(first.unsnapshotted.sort()).toEqual(['@ModA', '@ModB']);
    expect(first.ok).toBe(true);
    // Second check now has a baseline and sees no drift.
    const second = await integrity.checkServerDrift(sid, { notify: false });
    expect(second.unsnapshotted).toEqual([]);
    expect(second.ok).toBe(true);
  });

  test('forgetMod drops a baseline', async () => {
    await integrity.snapshotServer(sid);
    integrity.forgetMod(sid, '@ModA');
    const report = integrity.getReport(sid);
    expect(report.mods['@ModA']).toBeUndefined();
    expect(report.mods['@ModB']).toBeDefined();
  });
});

describe('installed build tracking', () => {
  test('reads buildid from the Steam appmanifest', () => {
    const steamapps = path.join(installDir, 'steamapps');
    fs.mkdirSync(steamapps, { recursive: true });
    fs.writeFileSync(path.join(steamapps, 'appmanifest_223350.acf'),
      '"AppState"\n{\n\t"appid"\t"223350"\n\t"buildid"\t"19551234"\n}\n');
    expect(integrity.readInstalledBuildId(ctx.servers[0])).toBe('19551234');
  });

  test('returns null when no manifest exists', () => {
    expect(integrity.readInstalledBuildId(ctx.servers[0])).toBeNull();
  });

  test('recordInstalledBuild flags a change', () => {
    const steamapps = path.join(installDir, 'steamapps');
    fs.mkdirSync(steamapps, { recursive: true });
    const manifest = path.join(steamapps, 'appmanifest_223350.acf');
    fs.writeFileSync(manifest, '"buildid"\t"100"');
    expect(integrity.recordInstalledBuild(sid)).toMatchObject({ id: '100', changed: false });
    fs.writeFileSync(manifest, '"buildid"\t"200"');
    expect(integrity.recordInstalledBuild(sid)).toMatchObject({ id: '200', changed: true });
  });
});
