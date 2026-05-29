'use strict';

const { getNextBackoffDelay } = require('../lib/backoff');

const DELAYS = [3000, 6000, 12000, 24000, 120000];
const COOLDOWN = 5 * 60 * 1000;

describe('getNextBackoffDelay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('escalates through the delay schedule on rapid successive calls', () => {
    const state = new Map();
    const seen = [];
    for (let i = 0; i < 5; i++) {
      seen.push(getNextBackoffDelay(state, 'srv', DELAYS, COOLDOWN));
      jest.advanceTimersByTime(100); // well under the cooldown
    }
    expect(seen).toEqual([3000, 6000, 12000, 24000, 120000]);
  });

  test('clamps at the final delay once the schedule is exhausted', () => {
    const state = new Map();
    for (let i = 0; i < 5; i++) {
      getNextBackoffDelay(state, 'srv', DELAYS, COOLDOWN);
      jest.advanceTimersByTime(100);
    }
    // Further calls keep returning the last delay, never overflow/undefined.
    expect(getNextBackoffDelay(state, 'srv', DELAYS, COOLDOWN)).toBe(120000);
    expect(getNextBackoffDelay(state, 'srv', DELAYS, COOLDOWN)).toBe(120000);
  });

  test('resets to the first delay after the cooldown window elapses', () => {
    const state = new Map();
    getNextBackoffDelay(state, 'srv', DELAYS, COOLDOWN); // 3000
    getNextBackoffDelay(state, 'srv', DELAYS, COOLDOWN); // 6000
    // Server stays up longer than the cooldown → next event should reset.
    jest.advanceTimersByTime(COOLDOWN + 1);
    expect(getNextBackoffDelay(state, 'srv', DELAYS, COOLDOWN)).toBe(3000);
  });

  test('does NOT reset while events keep occurring inside the cooldown', () => {
    const state = new Map();
    let last;
    for (let i = 0; i < 3; i++) {
      last = getNextBackoffDelay(state, 'srv', DELAYS, COOLDOWN);
      jest.advanceTimersByTime(COOLDOWN - 1); // just under the window, repeatedly
    }
    expect(last).toBe(12000); // kept escalating, no reset
  });

  test('tracks backoff independently per key', () => {
    const state = new Map();
    getNextBackoffDelay(state, 'a', DELAYS, COOLDOWN); // a: 3000
    getNextBackoffDelay(state, 'a', DELAYS, COOLDOWN); // a: 6000
    // b is a fresh key → starts at the beginning.
    expect(getNextBackoffDelay(state, 'b', DELAYS, COOLDOWN)).toBe(3000);
    expect(getNextBackoffDelay(state, 'a', DELAYS, COOLDOWN)).toBe(12000);
  });
});
