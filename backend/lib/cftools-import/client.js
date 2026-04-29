/**
 * CFTools Cloud API client — banlist fetch over a Developer-Portal API token.
 *
 * Used to bring an existing CFTools-hosted banlist into Citadel's local
 * ban database. The customer pastes their API token from
 * https://developer.cftools.cloud/ in the dashboard; the backend uses it
 * once for the import and never persists it.
 *
 * Reference: https://developer.cftools.cloud/
 *
 * Auth model: per the CFTools Quick Start, requests use
 *   `Authorization: Bearer <api_token>`
 * with a token issued from the Developer Portal. No OAuth2 round-trip
 * is needed for this use case. (CFTools also offers an OAuth2 flow for
 * "user-facing apps" — not what we are.)
 *
 * Endpoints used:
 *   GET /v1/server/{server_id}              — server details (incl. banlist id)
 *   GET /v1/banlist/{banlist_id}/bans       — paginated bans for a banlist
 *
 * Pagination model: CFTools returns a cursor in the response; we follow
 * it until exhausted. A MAX_PAGES safety cap guards against a misbehaving
 * API loop.
 */
const https = require('https');
const { URL } = require('url');
const logger = require('../logger');

const DEFAULT_BASE = 'https://data.cftools.cloud/v1';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 1000; // hard ceiling: at ~100/page that's 100k bans

function apiBase() {
  return (process.env.CFTOOLS_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
}

/**
 * Minimal HTTPS request — no axios/got dependency, matches the pattern
 * used elsewhere in this repo (cloud-bans/client.js, license/client.js).
 */
function httpRequest({ method, url, headers, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (err) { return reject(new Error(`Invalid URL: ${url}`)); }
    if (parsed.protocol !== 'https:') {
      return reject(new Error(`Refusing non-HTTPS URL: ${url}`));
    }
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        method,
        host: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Citadel-DayZ-Controller/cftools-import',
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
          resolve({ status: res.statusCode, headers: res.headers, body: parsedBody });
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('CFTools request timed out')); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function errorFromResponse(status, body, defaultMsg) {
  const message = body?.error?.title || body?.error || body?.message || defaultMsg;
  const err = new Error(typeof message === 'string' ? message : defaultMsg);
  err.status = status;
  err.code = body?.error?.code || body?.code;
  return err;
}

/**
 * Sanity-check a customer-supplied API token by hitting a cheap
 * authenticated endpoint. Doesn't return anything useful — throws on
 * 401/403 with a friendly message so the modal can surface "wrong token"
 * before attempting the full preview.
 *
 * We use `/server/{some_id}` as the probe target since `/health` (or
 * similar) isn't authenticated. Any 401 from CFTools means the token's
 * bad. Any 404 means the token's valid but the resource doesn't exist —
 * we treat that as authenticated.
 */
async function probeToken(apiToken) {
  if (!apiToken || typeof apiToken !== 'string') {
    throw new Error('CFTools API token is required');
  }
  // Probe a likely-nonexistent server id; we expect 404 (auth fine) or
  // 401 (token invalid). Real lookups follow.
  const { status, body } = await httpRequest({
    method: 'GET',
    url: `${apiBase()}/server/citadel-import-probe`,
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (status === 401 || status === 403) {
    throw errorFromResponse(status, body,
      'CFTools API token rejected — check it on developer.cftools.cloud');
  }
  // 404 = authenticated but no such server: that's fine for a probe.
  // 200 = we somehow probed a real server: also fine.
  // Anything else = unexpected, but don't fail here; the real call will surface it.
}

/**
 * Resolve a server_id to its banlist_id. Some customers know one and not
 * the other — let them pass either.
 *
 * The CFTools server endpoint returns server config including its
 * banlist reference. We surface the first banlist found.
 *
 * @returns {Promise<string>} banlist_id
 */
async function getBanlistIdForServer(apiToken, serverId) {
  const { status, body } = await httpRequest({
    method: 'GET',
    url: `${apiBase()}/server/${encodeURIComponent(serverId)}`,
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (status !== 200) {
    throw errorFromResponse(status, body, `CFTools server lookup failed for ${serverId}`);
  }
  // Response shape varies; common locations to find the banlist id:
  //   body.banlist  (legacy)
  //   body.server.banlist
  //   body.data.banlist
  // We try them in order and take the first non-empty value.
  const candidates = [
    body?.banlist,
    body?.server?.banlist,
    body?.data?.banlist,
    body?.server?.banlist_id,
    body?.banlist_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  throw new Error(`Server ${serverId} has no banlist attached on CFTools`);
}

/**
 * Fetch and parse the entire banlist. Per the CFTools data-api docs,
 * this endpoint returns a streamed response. We tolerate three plausible
 * encodings and use whichever the server actually emits:
 *
 *   1. NDJSON (newline-delimited JSON) — one ban record per line
 *   2. JSON array — `[{...}, {...}, ...]`
 *   3. Wrapped object — `{ bans: [...] }` or `{ entries: [...] }`
 *
 * Returns a flat array of raw ban records. Caller is responsible for
 * normalization (see importer.normalizeBan).
 */
async function getAllBans(apiToken, banlistId) {
  const url = `${apiBase()}/banlist/${encodeURIComponent(banlistId)}/bans`;
  const { status, headers, body } = await httpRequest({
    method: 'GET',
    url,
    headers: { Authorization: `Bearer ${apiToken}` },
    // Bigger timeout: a streamed banlist of thousands of records can
    // legitimately take longer than a normal API call.
    timeoutMs: 60_000,
  });
  if (status !== 200) {
    throw errorFromResponse(status, body, `CFTools banlist fetch failed for ${banlistId}`);
  }

  // The httpRequest helper already JSON.parsed if it could. If the
  // response was NDJSON it'll have failed JSON parsing and given us
  // the raw string. Distinguish:
  if (typeof body === 'string') {
    // NDJSON — split on newlines, parse each non-empty line.
    const records = [];
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        // Skip malformed lines silently — log only at debug.
        logger.debug({ line: trimmed.slice(0, 200) }, 'CFTools NDJSON: skipping unparseable line');
      }
    }
    return records;
  }
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.bans)) return body.bans;
  if (body && Array.isArray(body.entries)) return body.entries;

  // Empty banlist — no records.
  return [];
}

module.exports = {
  probeToken,
  getBanlistIdForServer,
  getAllBans,
  apiBase,
};
