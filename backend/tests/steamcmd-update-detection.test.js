'use strict';

/**
 * Tests for root causes A (real-vs-false update detection) and C (update-path
 * retry skips auth failures) in lib/steamcmd.js.
 *
 * Strategy: mock child_process.spawn so SteamCMD never actually runs, but use
 * REAL temp directories on disk so the before/after content-mtime + manifest
 * fingerprinting in captureWorkshopState() exercises genuine fs behaviour.
 * The spawn mock runs a per-call side-effect (configurable) that simulates what
 * a real / false SteamCMD run would leave on disk, then emits process output
 * and exit. No network, no real SteamCMD.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── child_process mock ──────────────────────────────────────────────
// mockRun(args) is invoked synchronously per spawn; it returns a string of
// "stdout" to emit. It may also perform disk side-effects to simulate a real
// download advancing content mtime / manifest. (jest.mock factory may only
// reference vars prefixed `mock`.)
let mockRun = () => '';
jest.mock('child_process', () => ({
  spawn: jest.fn((cmd, args) => {
    const { EventEmitter } = require('events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => {
      let out = '';
      try { out = mockRun(args) || ''; } catch { out = ''; }
      if (out) proc.stdout.emit('data', Buffer.from(out));
      proc.emit('exit', 0);
    });
    return proc;
  }),
}));

const ctx = require('../lib/context');
const steamcmd = require('../lib/steamcmd');

// Run a promise to settlement while fast-forwarding the retry backoff timers
// (5s/15s) and the spawn-mock's setImmediate, so retry-exercising tests don't
// wait ~20s of real time. Returns a promise that resolves/rejects like `p`.
async function settleWithTimers(p) {
  const tracked = p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
  // Advance in chunks until the promise settles (retry uses 5s then 15s).
  for (let i = 0; i < 10; i++) {
    await jest.advanceTimersByTimeAsync(20_000);
  }
  const r = await tracked;
  if (r.ok) return r.v;
  throw r.e;
}

const APP_ID = '221100';
let tmp, installDir, contentDir, manifestPath, fakeExe;
const MOD_ID = '12345';

function workshopContentDir(base) {
  return path.join(base, 'steamapps', 'workshop', 'content', APP_ID, MOD_ID);
}
function workshopManifest(base) {
  return path.join(base, 'steamapps', 'workshop', `appworkshop_${APP_ID}.acf`);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-steamcmd-'));
  installDir = path.join(tmp, 'server');
  contentDir = workshopContentDir(installDir);
  manifestPath = workshopManifest(installDir);
  fs.mkdirSync(contentDir, { recursive: true });
  // Seed with one file so content already "exists" (mimics a previously
  // installed mod that the user is now updating).
  fs.writeFileSync(path.join(contentDir, 'config.cpp'), 'old');
  fs.writeFileSync(manifestPath, 'manifest-v1');

  // Fake steamcmd.exe that actually exists so ensureSteamCMD() short-circuits.
  fakeExe = path.join(tmp, 'steamcmd.exe');
  fs.writeFileSync(fakeExe, '');

  ctx.CONFIG = { steam: { appId: APP_ID }, dayz: { installDir } };
  ctx.servers = [{ id: 'srv1', installDir }];
  ctx.steamCmdPath = fakeExe;
  ctx.steamCredentials = { username: 'user', password: 'pass', guardCode: '' };
  ctx.steamLoginValidated = true;
  ctx.io = null;
  mockRun = () => '';
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ok */ }
});

describe('A. real-vs-false update detection (updateWorkshopMod)', () => {
  test('REJECTS when no success marker AND content/manifest unchanged', async () => {
    // SteamCMD "succeeds" (exit 0) but writes nothing new — the login-timeout /
    // stale-manifest false-success case. Old content is still there.
    mockRun = () => 'Logged in OK\nWaiting for user info...OK\n';
    await expect(settleWithTimers(steamcmd.updateWorkshopMod('srv1', installDir, MOD_ID)))
      .rejects.toThrow(/did not fetch a new version|already up to date/i);
  });

  test('RESOLVES when output contains "Success. Downloaded item"', async () => {
    mockRun = () => 'Success. Downloaded item ' + MOD_ID + '\n';
    await expect(settleWithTimers(steamcmd.updateWorkshopMod('srv1', installDir, MOD_ID))).resolves.toBeUndefined();
  });

  test('RESOLVES when content mtime advances (new bytes written) even without marker', async () => {
    // Simulate a real download: rewrite the mod file with a newer mtime.
    mockRun = () => {
      const f = path.join(contentDir, 'config.cpp');
      fs.writeFileSync(f, 'NEW VERSION');
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(f, future, future);
      return 'downloading item...\n'; // no explicit success marker
    };
    await expect(settleWithTimers(steamcmd.updateWorkshopMod('srv1', installDir, MOD_ID))).resolves.toBeUndefined();
  });

  test('RESOLVES when the workshop manifest advances even if content untouched', async () => {
    mockRun = () => {
      // SteamCMD rewrote appworkshop_<appid>.acf (new build id) — size changes.
      fs.writeFileSync(manifestPath, 'manifest-v2-longer-content');
      return 'update complete\n';
    };
    await expect(settleWithTimers(steamcmd.updateWorkshopMod('srv1', installDir, MOD_ID))).resolves.toBeUndefined();
  });

  test('messages the stale-manifest hint when SteamCMD says "already up to date"', async () => {
    mockRun = () => 'Success! App ... already up to date\n';
    await expect(settleWithTimers(steamcmd.updateWorkshopMod('srv1', installDir, MOD_ID)))
      .rejects.toThrow(/appworkshop_221100\.acf/);
  });
});

describe('A. download path no longer false-succeeds on stale content', () => {
  test('REJECTS download when content pre-exists but nothing was fetched', async () => {
    // Content already on disk, but the run writes nothing and prints no marker.
    mockRun = () => 'Logged in OK\n';
    await expect(settleWithTimers(steamcmd.downloadWorkshopMod(MOD_ID, 'Mod', 'srv1')))
      .rejects.toThrow(/did not fetch the mod|appworkshop_221100\.acf/);
  });

  test('RESOLVES download with success marker and returns content path', async () => {
    mockRun = () => 'Success. Downloaded item ' + MOD_ID + '\n';
    const p = await settleWithTimers(steamcmd.downloadWorkshopMod(MOD_ID, 'Mod', 'srv1'));
    expect(p).toBe(path.resolve(contentDir));
  });
});

describe('C. update-path retry skips auth failures', () => {
  test('does NOT retry on Invalid Password (single spawn) and rejects', async () => {
    const cp = require('child_process');
    cp.spawn.mockClear();
    mockRun = () => 'Invalid Password\nLogin Failure\n';
    await expect(settleWithTimers(steamcmd.updateWorkshopMod('srv1', installDir, MOD_ID)))
      .rejects.toThrow(/Invalid Steam credentials/);
    // updateWorkshopMod is the retry wrapper — exactly one attempt for auth fail.
    expect(cp.spawn).toHaveBeenCalledTimes(1);
  });

  test('does NOT retry on Steam Guard required', async () => {
    const cp = require('child_process');
    cp.spawn.mockClear();
    mockRun = () => 'Enter the current code from your Steam Guard\n';
    await expect(settleWithTimers(steamcmd.updateWorkshopMod('srv1', installDir, MOD_ID)))
      .rejects.toThrow(/Steam Guard/);
    expect(cp.spawn).toHaveBeenCalledTimes(1);
  });

  test('RETRIES on transient false-success (no auth keyword) — 3 spawns', async () => {
    const cp = require('child_process');
    cp.spawn.mockClear();
    // Never fetches anything and never prints an auth keyword → retried fully.
    mockRun = () => 'Logged in OK\n';
    await expect(settleWithTimers(steamcmd.updateWorkshopMod('srv1', installDir, MOD_ID)))
      .rejects.toThrow(/did not fetch a new version/i);
    expect(cp.spawn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
