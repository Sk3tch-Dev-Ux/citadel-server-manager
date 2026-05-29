'use strict';

const { createMutex } = require('../lib/async-mutex');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

describe('createMutex', () => {
  test('serializes tasks in arrival order', async () => {
    const lock = createMutex();
    const events = [];
    const d1 = deferred();

    const p1 = lock(async () => { events.push('start1'); await d1.promise; events.push('end1'); });
    const p2 = lock(async () => { events.push('start2'); });

    await tick();
    expect(events).toEqual(['start1']); // p2 blocked behind p1
    d1.resolve();
    await Promise.all([p1, p2]);
    expect(events).toEqual(['start1', 'end1', 'start2']);
  });

  test('a rejection does not wedge the queue', async () => {
    const lock = createMutex();
    await expect(lock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(lock(async () => 'ok')).resolves.toBe('ok');
  });

  test('propagates resolved values', async () => {
    const lock = createMutex();
    await expect(lock(async () => 42)).resolves.toBe(42);
  });

  test('pending() reflects queued + running tasks', async () => {
    const lock = createMutex();
    const d = deferred();
    const p = lock(async () => { await d.promise; });
    lock(async () => {});
    await tick();
    expect(lock.pending()).toBe(2);
    d.resolve();
    await p;
    await tick();
    expect(lock.pending()).toBe(0);
  });

  test('independent mutexes do not block each other', async () => {
    const a = createMutex();
    const b = createMutex();
    const order = [];
    const da = deferred();
    const pa = a(async () => { order.push('a-start'); await da.promise; });
    await b(async () => { order.push('b-ran'); }); // b runs even though a is held
    expect(order).toEqual(['a-start', 'b-ran']);
    da.resolve();
    await pa;
  });
});
