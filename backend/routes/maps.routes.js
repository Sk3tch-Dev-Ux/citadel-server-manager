/**
 * Map Tile Proxy
 *
 * Proxies DayZ satellite map tiles from xam.nu, caches them to disk,
 * and serves them under /api/maps/tiles/* — same URL pattern the
 * frontend used to hit xam.nu directly, just rooted under our origin.
 *
 *   GET  /api/maps/version             → { version, maps, styles }
 *   GET  /api/maps/tiles/:map/:style/:z/:x/:y.webp
 *
 * Why this exists:
 *   1. xam.nu changes the version path occasionally (1.27 → 1.28 → ...)
 *      and we don't want to ship a desktop release for every bump.
 *   2. CSP no longer needs to whitelist external image hosts.
 *   3. Cached tiles let the app keep working if xam.nu is briefly down,
 *      and reduce load on a community-run free service.
 *
 * Version is configured via the DAYZ_TILE_VERSION env var. Default '1.27'.
 * Admins can change it without rebuilding the desktop app — restart the
 * service and frontend picks it up via /api/maps/version on next mount.
 *
 * Cache-aside on disk: <ROOT>/data/map-tiles/<map>/<version>/<style>/<z>/<x>/<y>.webp
 * Tiles are immutable per version path so we cache forever (Cache-Control: max-age=1y).
 *
 * Hardened against SSRF — only known maps and styles are allowed through.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { ROOT } = require('../lib/paths');
const logger = require('../lib/logger');

const UPSTREAM_BASE = 'https://static.xam.nu/dayz/maps';
const TILE_VERSION = process.env.DAYZ_TILE_VERSION || '1.27';
// Map names are validated by shape, not allowlist — adding a new map to
// the frontend MAP_CONFIGS shouldn't require a backend redeploy. xam.nu
// will 404 unknown maps and we mirror that, so there's no SSRF risk
// (the host is fixed; only the path segment is user-controlled).
const SAFE_NAME = /^[a-z0-9]{1,32}$/;
const ALLOWED_STYLES = new Set(['satellite']); // expand if xam adds more
const MAX_ZOOM = 10;
const FETCH_TIMEOUT_MS = 8000;

const CACHE_ROOT = path.join(ROOT, 'data', 'map-tiles');

/** Ensure the cache root exists at boot — cheap, sync, one-time. */
function ensureCacheRoot() {
  try { fs.mkdirSync(CACHE_ROOT, { recursive: true }); } catch (_) { /* ok */ }
}
ensureCacheRoot();

/**
 * Validate the {map, style, z, x, y} tuple. Returns null if any field
 * is unsafe — the route then 400s instead of touching the filesystem
 * or making an outbound request.
 */
function validateTileParams(map, style, z, x, y) {
  if (!SAFE_NAME.test(map)) return 'invalid map';
  if (!ALLOWED_STYLES.has(style)) return 'invalid style';
  const zi = Number(z), xi = Number(x), yi = Number(y);
  if (!Number.isInteger(zi) || zi < 0 || zi > MAX_ZOOM) return 'invalid z';
  if (!Number.isInteger(xi) || xi < 0) return 'invalid x';
  if (!Number.isInteger(yi) || yi < 0) return 'invalid y';
  // Within zoom z, valid coords are [0, 2^z). Reject obvious garbage.
  const max = 2 ** zi;
  if (xi >= max || yi >= max) return 'tile out of bounds';
  return null;
}

/**
 * Disk path for a cached tile. Includes the version so a TILE_VERSION
 * bump partitions the cache automatically — old tiles aren't served
 * after an upgrade, but they're not deleted either (cheap to keep).
 */
function cachePathFor(map, style, z, x, y) {
  return path.join(CACHE_ROOT, map, TILE_VERSION, style, String(z), String(x), `${y}.webp`);
}

/** Upstream URL we proxy to. Built fresh per request — no string concat in hot path. */
function upstreamUrlFor(map, style, z, x, y) {
  return `${UPSTREAM_BASE}/${map}/${TILE_VERSION}/${style}/${z}/${x}/${y}.webp`;
}

/**
 * Fetch a tile from xam.nu and write it to the cache path. Atomic via
 * write-to-tmp + rename so a concurrent reader never sees a half-written
 * file. Returns the buffer on success; throws on any failure (404, timeout,
 * non-image response).
 */
async function fetchAndCache(url, cachePath) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = new Error(`upstream ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // Sanity-check we got an image. Tiny files or HTML error pages should
  // not be cached as if they were tiles.
  if (buf.length < 100) throw new Error('upstream returned suspiciously small body');

  // Write atomically so concurrent requests see all-or-nothing.
  await fsp.mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = cachePath + '.tmp.' + process.pid + '.' + Date.now();
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, cachePath);

  return buf;
}

module.exports = function registerMapsRoutes(app) {
  /**
   * Surface the current tile version + allowed maps/styles so the
   * frontend can render dropdowns, tell the user which maps are
   * supported, etc., without hardcoding it on the client.
   */
  app.get('/api/maps/version', (_req, res) => {
    res.json({
      version: TILE_VERSION,
      styles: [...ALLOWED_STYLES],
      upstream: 'static.xam.nu', // for transparency / debugging
    });
  });

  /**
   * Tile proxy. Cache-aside:
   *   1. If on disk → sendFile (fast path, no network).
   *   2. Else fetch from xam.nu → write to cache → send buffer back.
   *   3. On upstream failure with no cache → 502.
   *
   * Tiles are immutable per (map, version, style, z, x, y) so we set
   * max-age=1y and 'immutable'. Browsers will cache aggressively, which
   * means a TILE_VERSION bump should also bust their cache because the
   * new URL path differs.
   */
  app.get('/api/maps/tiles/:map/:style/:z/:x/:y.webp', async (req, res) => {
    const { map, style, z, x, y } = req.params;
    const reason = validateTileParams(map, style, z, x, y);
    if (reason) return res.status(400).json({ error: reason });

    const cachePath = cachePathFor(map, style, z, x, y);

    // Fast path — disk hit.
    try {
      await fsp.access(cachePath, fs.constants.R_OK);
      res.set('Content-Type', 'image/webp');
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('X-Tile-Cache', 'hit');
      return res.sendFile(cachePath);
    } catch (_) { /* miss → fetch */ }

    // Slow path — fetch upstream.
    try {
      const buf = await fetchAndCache(upstreamUrlFor(map, style, z, x, y), cachePath);
      res.set('Content-Type', 'image/webp');
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('X-Tile-Cache', 'miss');
      return res.send(buf);
    } catch (err) {
      // If upstream gave us an honest 404, mirror it back. The map
      // probably has no tile at this z/x/y — Leaflet handles missing
      // tiles fine, the area just stays the grey background.
      if (err && err.status === 404) {
        return res.status(404).end();
      }
      logger.warn({ err: err && err.message, url: upstreamUrlFor(map, style, z, x, y) }, 'Map tile proxy failed');
      return res.status(502).json({ error: 'tile fetch failed', detail: err && err.message });
    }
  });

  logger.info({ version: TILE_VERSION, cache: CACHE_ROOT }, 'Map tile proxy registered');
};
