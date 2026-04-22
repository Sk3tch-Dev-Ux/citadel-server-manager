/**
 * HTTP client for the citadels.cc license API.
 *
 * All three endpoints live at https://citadels.cc/api/v1/license/*.
 * The base URL is overridable via CITADEL_LICENSE_API for local development
 * against a dev citadels.cc server.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_BASE = 'https://citadels.cc';

function apiBase() {
  return (process.env.CITADEL_LICENSE_API || DEFAULT_BASE).replace(/\/$/, '');
}

function httpRequest({ method, url, headers, body, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      return reject(new Error(`Invalid URL: ${url}`));
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        method,
        host: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Citadel-DayZ-Controller/1.0',
          Accept: 'application/json',
          ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          ...(headers || {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let parsedBody = null;
          try {
            parsedBody = text ? JSON.parse(text) : null;
          } catch {
            parsedBody = text;
          }
          resolve({ status: res.statusCode, body: parsedBody });
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * POST /api/v1/license/activate
 * Exchange email+password+machineId for an RS256 license token.
 */
async function activate({ email, password, machineId, name }) {
  const { status, body } = await httpRequest({
    method: 'POST',
    url: `${apiBase()}/api/v1/license/activate`,
    body: { email, password, machineId, name },
  });
  if (status === 200) return body;
  const err = new Error(body?.message || `Activation failed (HTTP ${status})`);
  err.status = status;
  err.code = body?.error;
  throw err;
}

/**
 * GET /api/v1/license/verify
 * Refresh the cached token. Returns a fresh token on success.
 */
async function verify(token) {
  const { status, body } = await httpRequest({
    method: 'GET',
    url: `${apiBase()}/api/v1/license/verify`,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (status === 200) return body;
  const err = new Error(body?.message || `Verify failed (HTTP ${status})`);
  err.status = status;
  err.code = body?.error;
  throw err;
}

/**
 * DELETE /api/v1/license/deactivate
 * Free this device's slot on the user's account.
 */
async function deactivate(token) {
  const { status, body } = await httpRequest({
    method: 'DELETE',
    url: `${apiBase()}/api/v1/license/deactivate`,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (status === 204 || status === 200) return true;
  const err = new Error(body?.message || `Deactivate failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

module.exports = { activate, verify, deactivate, apiBase };
