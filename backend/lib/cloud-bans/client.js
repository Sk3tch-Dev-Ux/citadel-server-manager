/**
 * HTTP client for the citadels.cc Cloud Bans API.
 *
 * Mirrors backend/lib/license/client.js patterns — same lightweight
 * Node http/https with no axios/got dependency.
 *
 * Base URL: CITADEL_LICENSE_API or default https://api.citadels.cc.
 * The Fastify API lives on the `api.` subdomain; the marketing Next.js site is
 * at the apex `citadels.cc` and does NOT serve /api routes — so the default
 * MUST be the api. host (matches license/update-checker/cloud-bridge clients),
 * otherwise every cloud-bans call 404s on the marketing site.
 * Auth: Bearer license JWT from the license module's state.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_BASE = 'https://api.citadels.cc';

function apiBase() {
  return (process.env.CITADEL_LICENSE_API || DEFAULT_BASE).replace(/\/$/, '');
}

/**
 * Lazy-load the license module to avoid circular requires.
 */
function getLicenseToken() {
  try {
    const license = require('../license');
    const state = license.getState();
    return state?.token || null;
  } catch {
    return null;
  }
}

function httpRequest({ method, url, headers, body, timeoutMs = 15000 }) {
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
          'User-Agent': 'Citadel-DayZ-Controller/cloud-bans',
          Accept: 'application/json',
          ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          ...(headers || {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let parsedBody = null;
          try { parsedBody = text ? JSON.parse(text) : null; } catch { parsedBody = text; }
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

function authHeaders() {
  const token = getLicenseToken();
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

/**
 * Build a structured error from an HTTP response.
 */
function errorFromResponse(status, body, defaultMsg) {
  const err = new Error(body?.message || defaultMsg);
  err.status = status;
  err.code = body?.error;
  err.retryAfter = body?.retryAfterSeconds;
  return err;
}

// ─── /submit ──────────────────────────────────────────────────
async function submit({ steamId, reasonCategory, notesLocal }) {
  const headers = authHeaders();
  if (!headers) throw new Error('Cloud Bans submit requires an active Citadel Cloud subscription');
  const { status, body } = await httpRequest({
    method: 'POST',
    url: `${apiBase()}/api/v1/cloud-bans/submit`,
    headers,
    body: { steamId, reasonCategory, notesLocal },
  });
  if (status === 201 || status === 200) return body;
  throw errorFromResponse(status, body, `Cloud Bans submit failed (HTTP ${status})`);
}

// ─── /unenroll ────────────────────────────────────────────────
async function unenroll({ steamId }) {
  const headers = authHeaders();
  if (!headers) throw new Error('Cloud Bans unenroll requires an active Citadel Cloud subscription');
  const { status, body } = await httpRequest({
    method: 'POST',
    url: `${apiBase()}/api/v1/cloud-bans/unenroll`,
    headers,
    body: { steamId },
  });
  if (status === 200) return body;
  throw errorFromResponse(status, body, `Cloud Bans unenroll failed (HTTP ${status})`);
}

// ─── /sync ────────────────────────────────────────────────────
async function sync({ since, limit = 500 } = {}) {
  const headers = authHeaders();
  if (!headers) throw new Error('Cloud Bans sync requires an active Citadel Cloud subscription');
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  params.set('limit', String(limit));
  const url = `${apiBase()}/api/v1/cloud-bans/sync?${params.toString()}`;
  const { status, body } = await httpRequest({ method: 'GET', url, headers });
  if (status === 200) return body;
  throw errorFromResponse(status, body, `Cloud Bans sync failed (HTTP ${status})`);
}

// ─── /check ───────────────────────────────────────────────────
async function check(steamId) {
  const headers = authHeaders();
  if (!headers) throw new Error('Cloud Bans check requires an active Citadel Cloud subscription');
  const params = new URLSearchParams({ steamId });
  const url = `${apiBase()}/api/v1/cloud-bans/check?${params.toString()}`;
  const { status, body } = await httpRequest({ method: 'GET', url, headers });
  if (status === 200) return body;
  throw errorFromResponse(status, body, `Cloud Bans check failed (HTTP ${status})`);
}

// ─── /stats ───────────────────────────────────────────────────
// No auth required — used to display "X bans community-wide" on the
// dashboard even before the customer has activated.
async function stats() {
  const url = `${apiBase()}/api/v1/cloud-bans/stats`;
  const { status, body } = await httpRequest({ method: 'GET', url });
  if (status === 200) return body;
  throw errorFromResponse(status, body, `Cloud Bans stats failed (HTTP ${status})`);
}

module.exports = { submit, unenroll, sync, check, stats, apiBase };
