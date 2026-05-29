'use strict';

/**
 * Minimal async mutex.
 *
 * `createMutex()` returns a `runExclusive(fn)` function that serializes calls:
 * each invocation waits for the previous one to settle (resolve OR reject)
 * before running, so the wrapped critical sections never interleave across
 * `await` points. A rejection in one task never wedges the queue.
 *
 * Use when independent async operations mutate shared state across awaits and
 * could clobber each other (e.g. license activate/refresh/deactivate all write
 * the same in-memory `_state`).
 */
function createMutex() {
  let tail = Promise.resolve();
  let depth = 0;

  function runExclusive(fn) {
    depth++;
    const result = tail.then(() => fn());
    // Keep the chain alive regardless of outcome, and decrement once settled.
    tail = result.then(() => { depth--; }, () => { depth--; });
    return result;
  }

  /** @returns {number} queued + running task count (for tests/introspection) */
  runExclusive.pending = () => depth;
  return runExclusive;
}

module.exports = { createMutex };
