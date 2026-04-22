/**
 * Backend service health check — polls /api/health/ping until ready or timeout.
 *
 * This is intentionally identical in behavior to backend/lib/wait-for-ready.js
 * but lives in the Electron main process (so it runs without spawning Node).
 */
const http = require('http');
const https = require('https');

const POLL_INTERVAL_MS = 750;

function checkOnce(urlString) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return resolve(false);
    }
    const lib = url.protocol === 'https:' ? https : http;
    const port = url.port || (url.protocol === 'https:' ? 443 : 80);
    const req = lib.get(
      {
        host: url.hostname,
        port,
        path: '/api/health/ping',
        timeout: 2000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * @param {string} url - e.g. "http://localhost:3001"
 * @param {number} timeoutMs - total time to wait before giving up
 * @returns {Promise<boolean>} true if ready, false if timed out
 */
async function waitForBackend(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkOnce(url)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

module.exports = { waitForBackend, checkOnce };
