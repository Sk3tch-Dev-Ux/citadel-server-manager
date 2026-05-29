'use strict';

const { EventEmitter } = require('events');

// Mock child_process.spawn so we never touch the real (Windows-only) tasklist
// and can count how many OS calls the cache actually issues.
jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { spawn } = require('child_process');

// Fake child process that emits the given stdout then closes on the next tick.
function fakeProc(stdout) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.kill = () => {};
  setImmediate(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', 0);
  });
  return proc;
}

const { detectRunningProcess, detectProcessByPid } = require('../lib/process-manager');

beforeEach(() => {
  spawn.mockReset();
});

describe('process detection TTL cache', () => {
  test('detectRunningProcess caches within the TTL (one spawn for two calls)', async () => {
    spawn.mockImplementation(() => fakeProc('"DZ-cache-exe-1.exe","1234"\n'));
    const a = await detectRunningProcess('DZ-cache-exe-1.exe');
    const b = await detectRunningProcess('DZ-cache-exe-1.exe');
    expect(a).toBe(1234);
    expect(b).toBe(1234);
    expect(spawn).toHaveBeenCalledTimes(1); // second call served from cache
  });

  test('detectProcessByPid caches a positive result within the TTL', async () => {
    spawn.mockImplementation(() => fakeProc('"img","4321"\n'));
    const a = await detectProcessByPid(4321);
    const b = await detectProcessByPid(4321);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('distinct executables are cached independently', async () => {
    spawn.mockImplementation(() => fakeProc('"Other.exe","9"\n'));
    await detectRunningProcess('DZ-cache-exe-A.exe');
    await detectRunningProcess('DZ-cache-exe-B.exe');
    expect(spawn).toHaveBeenCalledTimes(2); // different keys → not shared
  });

  test('invalid pid short-circuits without spawning', async () => {
    spawn.mockImplementation(() => fakeProc(''));
    expect(await detectProcessByPid(0)).toBe(false);
    expect(await detectProcessByPid(-1)).toBe(false);
    expect(await detectProcessByPid('abc')).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  test('transient failure (spawn error) is not cached — retried next call', async () => {
    let calls = 0;
    spawn.mockImplementation(() => {
      calls++;
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.kill = () => {};
      setImmediate(() => proc.emit('error', new Error('boom')));
      return proc;
    });
    const a = await detectRunningProcess('DZ-cache-exe-err.exe');
    const b = await detectRunningProcess('DZ-cache-exe-err.exe');
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(calls).toBe(2); // error path not cached → spawned twice
  });
});
