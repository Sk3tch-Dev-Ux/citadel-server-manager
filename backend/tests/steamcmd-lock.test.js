'use strict';

const { withSteamLock, isSteamLocked, steamLockQueueDepth } = require('../lib/steamcmd-lock');

// A controllable deferred: lets a test hold a locked task "running" until released.
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

describe('SteamCMD concurrency lock', () => {
  test('runs operations one at a time, in arrival order', async () => {
    const events = [];
    const d1 = deferred();
    const d2 = deferred();

    const p1 = withSteamLock('op1', async () => { events.push('start1'); await d1.promise; events.push('end1'); });
    const p2 = withSteamLock('op2', async () => { events.push('start2'); await d2.promise; events.push('end2'); });

    await tick();
    // Only op1 should have started; op2 waits behind it.
    expect(events).toEqual(['start1']);
    expect(steamLockQueueDepth()).toBe(1); // op2 queued

    d1.resolve();
    await tick();
    expect(events).toEqual(['start1', 'end1', 'start2']);

    d2.resolve();
    await p1; await p2;
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2']);
  });

  test('a rejected operation does not wedge the queue', async () => {
    const ran = [];
    const failing = withSteamLock('bad', async () => { ran.push('bad'); throw new Error('boom'); });
    await expect(failing).rejects.toThrow('boom');

    const after = await withSteamLock('good', async () => { ran.push('good'); return 42; });
    expect(after).toBe(42);
    expect(ran).toEqual(['bad', 'good']);
  });

  test('propagates the resolved value to the caller', async () => {
    await expect(withSteamLock('v', async () => 'result')).resolves.toBe('result');
  });

  test('isSteamLocked reflects an in-flight operation', async () => {
    const d = deferred();
    const p = withSteamLock('hold', async () => { await d.promise; });
    await tick();
    expect(isSteamLocked()).toBe(true);
    d.resolve();
    await p;
    await tick();
    expect(isSteamLocked()).toBe(false);
  });

  test('supports the (fn) single-argument form', async () => {
    await expect(withSteamLock(async () => 'ok')).resolves.toBe('ok');
  });
});
