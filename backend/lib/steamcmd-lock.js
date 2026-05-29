'use strict';

/**
 * Global in-process mutex for SteamCMD operations.
 *
 * SteamCMD keeps a single content/staging directory and a single cached auth
 * token (config/config.vdf) per install. Running two SteamCMD processes at once
 * — e.g. the auto-updater validating the server app while a user installs a
 * workshop mod — races on those shared resources and can corrupt downloads or
 * the token cache. This serializes every SteamCMD invocation so at most one
 * runs at a time, regardless of which caller triggered it.
 *
 * The lock is intentionally NOT reentrant: callers must not nest withSteamLock
 * inside another withSteamLock (e.g. ensureSteamCMD is deliberately left
 * unlocked because the locked operations call it internally).
 *
 * Tasks queue in arrival order; a task only starts once the previous one has
 * settled (resolved or rejected), so a failure never wedges the queue.
 */
const logger = require('./logger');

let _tail = Promise.resolve();
let _running = false;
let _queued = 0;

/**
 * Run `fn` exclusively with respect to all other SteamCMD operations.
 *
 * @template T
 * @param {string|function} label - a short label for logging (optional)
 * @param {function(): Promise<T>} [fn] - the operation to run
 * @returns {Promise<T>} the operation's result
 */
function withSteamLock(label, fn) {
  if (typeof label === 'function') { fn = label; label = 'steamcmd'; }
  _queued++;
  const start = _tail.then(() => {
    _queued--;
    _running = true;
    logger.debug({ op: label }, 'SteamCMD lock acquired');
    return fn();
  });
  // Keep the chain alive regardless of success/failure, and clear the running
  // flag once this task settles.
  _tail = start.then(
    () => { _running = false; },
    () => { _running = false; }
  );
  return start;
}

/** @returns {boolean} whether a SteamCMD operation is currently running */
function isSteamLocked() { return _running; }

/** @returns {number} number of operations waiting to acquire the lock */
function steamLockQueueDepth() { return _queued; }

module.exports = { withSteamLock, isSteamLocked, steamLockQueueDepth };
