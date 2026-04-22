#!/usr/bin/env node
/**
 * Wait for the Citadel API to become ready.
 *
 * Used by the NSIS installer's LaunchDashboard finish-page action so the
 * browser does not open until the backend service is actually responding.
 * Without this, users clicking "Open Citadel Dashboard" right after install
 * can hit a connection-refused page before node.exe has bound the port.
 *
 * Polls http://127.0.0.1:{port}/api/health/ping until a 200 response or timeout.
 *
 * Exit codes:
 *   0 — API is ready
 *   1 — timed out
 *
 * Tunable via env:
 *   PORT                        — port to poll (default 3001)
 *   CITADEL_WAIT_TIMEOUT_MS     — total timeout in ms (default 60000)
 */
const http = require('http');

const PORT = Number(process.env.PORT || 3001);
const TIMEOUT_MS = Number(process.env.CITADEL_WAIT_TIMEOUT_MS || 60000);
const POLL_INTERVAL_MS = 500;

function checkOnce() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/health/ping', timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  const deadline = Date.now() + TIMEOUT_MS;
  process.stdout.write(`Waiting for Citadel API on 127.0.0.1:${PORT}`);
  while (Date.now() < deadline) {
    if (await checkOnce()) {
      process.stdout.write(' [READY]\n');
      process.exit(0);
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  process.stdout.write(' [TIMEOUT]\n');
  console.error(`Timed out after ${TIMEOUT_MS}ms — service may still be starting.`);
  process.exit(1);
})();
