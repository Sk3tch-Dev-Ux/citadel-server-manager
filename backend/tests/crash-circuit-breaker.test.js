'use strict';

// crash-detector pulls in ctx/logger/notifications transitively; requiring it
// is side-effect-safe (no timers start until handleCrash runs, which we don't
// call here — we exercise the circuit-breaker helpers directly).
const { canAttemptCrashRestart, recordCrashRestart } = require('../lib/crash-detector');

const MAX = 10; // MAX_CRASH_RESTARTS_PER_HOUR
const HOUR = 60 * 60 * 1000;

describe('crash auto-restart circuit breaker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // Use a unique serverId per test so the module-level history map stays isolated.
  test('allows up to the per-hour limit, then blocks', () => {
    const id = 'srv-limit';
    for (let i = 0; i < MAX; i++) {
      expect(canAttemptCrashRestart(id)).toBe(true);
      recordCrashRestart(id);
    }
    // 10 attempts recorded within the hour → the 11th must be blocked.
    expect(canAttemptCrashRestart(id)).toBe(false);
  });

  test('recovers after attempts age out of the rolling hour window', () => {
    const id = 'srv-rolling';
    for (let i = 0; i < MAX; i++) recordCrashRestart(id);
    expect(canAttemptCrashRestart(id)).toBe(false);

    // Advance just past one hour so every recorded attempt is now stale.
    jest.advanceTimersByTime(HOUR + 1);
    expect(canAttemptCrashRestart(id)).toBe(true);
  });

  test('partial aging frees exactly the attempts that expired', () => {
    const id = 'srv-partial';
    // 5 attempts at t=0
    for (let i = 0; i < 5; i++) recordCrashRestart(id);
    // 30 minutes later, 5 more → 10 total, blocked.
    jest.advanceTimersByTime(30 * 60 * 1000);
    for (let i = 0; i < 5; i++) recordCrashRestart(id);
    expect(canAttemptCrashRestart(id)).toBe(false);

    // At t=61min, the first 5 (from t=0) have aged out; 5 remain → allowed again.
    jest.advanceTimersByTime(31 * 60 * 1000);
    expect(canAttemptCrashRestart(id)).toBe(true);
  });

  test('tracks each server independently', () => {
    const a = 'srv-a';
    const b = 'srv-b';
    for (let i = 0; i < MAX; i++) recordCrashRestart(a);
    expect(canAttemptCrashRestart(a)).toBe(false);
    expect(canAttemptCrashRestart(b)).toBe(true); // b untouched
  });
});
