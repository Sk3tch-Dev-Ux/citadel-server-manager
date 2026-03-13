/**
 * Shared exponential backoff utility.
 *
 * Used by:
 *   - server-lifecycle.js (restart backoff)
 *   - crash-detector.js (crash restart backoff)
 */

/**
 * Get the next backoff delay for a given key. Advances the backoff index.
 * If enough time has passed since the last event (> cooldownMs), resets to 0.
 *
 * @param {Map} stateMap - Per-key backoff state storage
 * @param {string} key - Identifier (e.g. serverId)
 * @param {number[]} delays - Array of delay values in ms (escalating)
 * @param {number} cooldownMs - If elapsed time since last event > this, reset backoff to 0
 * @returns {number} Next delay in ms
 */
function getNextBackoffDelay(stateMap, key, delays, cooldownMs) {
  if (!stateMap.has(key)) {
    stateMap.set(key, { backoffIndex: 0, lastTime: Date.now() });
  }

  const state = stateMap.get(key);
  const elapsed = Date.now() - state.lastTime;

  // If enough time has passed, reset backoff (server was stable)
  if (elapsed > cooldownMs) {
    state.backoffIndex = 0;
  }

  const delay = delays[state.backoffIndex] || delays[delays.length - 1];
  state.backoffIndex = Math.min(state.backoffIndex + 1, delays.length - 1);
  state.lastTime = Date.now();

  return delay;
}

module.exports = { getNextBackoffDelay };
