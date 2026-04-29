/**
 * CFTools → Citadel ban list importer.
 *
 * Two operations:
 *   preview() — token sanity-check + first page only; tells the customer
 *               what we found so they can confirm before committing.
 *   importAll() — page through every ban; filter to Steam64; dedupe
 *               against existing ctx.banDatabase; insert via
 *               ban-engine.addBan (which also writes ban.txt).
 *
 * Filtering: CFTools bans can target multiple identifier types
 * (steam64, cftools_id, ipv4, battleye_guid). DayZ's ban.txt only
 * understands Steam64; we drop everything else with a count of
 * "skipped (unsupported format)" returned to the customer.
 *
 * Hard cap: MAX_IMPORT_BANS prevents a runaway import. Most customer
 * banlists are well under this; it's a safety net, not a normal limit.
 *
 * Credentials: a single `apiToken` (from developer.cftools.cloud) is
 * passed in as an arg, used once, and never persisted. The customer
 * re-enters it for any future import.
 */
const ctx = require('../context');
const { addBan, listBans } = require('../ban-engine');
const logger = require('../logger');
const client = require('./client');

const MAX_IMPORT_BANS = 100_000;
const PREVIEW_SAMPLE_SIZE = 5;

// 17-digit number starting with 7656 — Steam64 format. Tight enough that
// false positives in the recursive scanner below are vanishingly rare:
// Steam64s sit in a very narrow numeric range and aren't easily confused
// with timestamps, IDs in other formats, or unrelated counters.
const STEAM64_RE = /^7656\d{13}$/;

/**
 * Recursively scan any object/array for the first string matching the
 * Steam64 format. Used as a shape-agnostic fallback when none of the
 * explicit field paths in normalizeBan() yield a Steam64.
 *
 * Why this works defensively: the only string in a CFTools ban record
 * that matches `^7656\d{13}$` is a Steam64. Other identifiers (CFTools
 * IDs, BattlEye GUIDs, BIS UIDs, server IDs, ban IDs) don't fit that
 * shape. So we can scan freely without worrying about grabbing the
 * wrong value.
 *
 * Cycle protection: a `seen` Set prevents infinite recursion if the
 * record contains circular references (rare but possible after JSON
 * deserialization of objects with $ref-style backlinks).
 */
function findSteam64Anywhere(value, seen = new Set()) {
  if (value == null) return null;
  if (typeof value === 'string') {
    return STEAM64_RE.test(value) ? value : null;
  }
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSteam64Anywhere(item, seen);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const found = findSteam64Anywhere(value[key], seen);
    if (found) return found;
  }
  return null;
}

/**
 * Normalize a CFTools ban record into our local shape.
 *
 * Per the CFTools data-api docs:
 *   GET /v1/banlist/{banlist_id}/bans returns ban records whose
 *   identifier `format` is one of:
 *     - 'cftools_id' — CFTools' internal player identifier
 *     - 'ipv4'       — an IP address ban
 *
 * DayZ's `ban.txt` only accepts Steam64 IDs. Neither of the two CFTools
 * formats is directly importable. We extract a Steam64 ONLY if the ban
 * record happens to include one alongside the CFTools account id —
 * common in CFTools' ban-evidence model where the original report
 * captured Steam metadata. (Field names: `steam_id`, `steam64`,
 * `steamid`, or `identifier.steam64` — we try each.)
 *
 * Records that don't yield a Steam64 are returned with `skip: true` and
 * a reason code so the customer can see exactly why they were excluded.
 *
 * NOTE: a future iteration could resolve missing Steam64s via
 * /v1/users/lookup, but that endpoint is rate-limited to 20/minute and
 * appears to only work in the Steam64 → CFTools direction. Without a
 * documented reverse-lookup, we skip cftools_id-only bans.
 */
function normalizeBan(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // Format + primary identifier (one of cftools_id / ipv4 per docs).
  let format, identifier;
  if (typeof raw.identifier === 'object' && raw.identifier !== null) {
    format = raw.identifier.format || raw.format;
    identifier = raw.identifier.value || raw.identifier.identifier;
  } else {
    format = raw.format;
    identifier = raw.identifier;
  }

  // Extract any Steam64 the record happens to carry. CFTools' ban records
  // may include this in the player metadata even when format=cftools_id,
  // because the original ban event captured the Steam side.
  //
  // Two-stage lookup:
  //   1. Try the obvious explicit field paths first (fast, deterministic
  //      preference for the most semantically meaningful location).
  //   2. Fall back to a recursive scan of the entire record. Steam64s
  //      have a tight format (^7656\d{13}$) that nothing else in CFTools'
  //      data model uses, so this is safe.
  //
  // Stage 2 is the safety net for response shapes I haven't seen yet —
  // it makes the importer robust to any field-naming convention CFTools
  // might use without us having to enumerate them.
  const steamCandidates = [
    raw.steam_id, raw.steam64, raw.steamid,
    raw.identifier?.steam64, raw.identifier?.steam_id,
    raw.player?.steam64, raw.player?.steam_id,
    raw.profile?.steam64, raw.profile?.steam_id,
  ];
  let steamId = steamCandidates.find(
    (v) => typeof v === 'string' && STEAM64_RE.test(v),
  );
  if (!steamId) {
    // Stage 2: recursive scan as a shape-agnostic fallback.
    steamId = findSteam64Anywhere(raw);
  }

  if (steamId) {
    return {
      skip: false,
      steamId,
      reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 500) : 'Imported from CFTools',
      expiresAt: typeof raw.expires_at === 'string' ? raw.expires_at : null,
      cftoolsId: typeof raw.id === 'string' ? raw.id : null,
    };
  }

  // No Steam64 in the record — we can't import it into ban.txt.
  if (format === 'ipv4') {
    return { skip: true, reason: 'unsupported-format:ipv4' };
  }
  if (format === 'cftools_id' || (typeof identifier === 'string' && identifier.length > 0)) {
    return { skip: true, reason: 'no-steam64-on-record:cftools_id' };
  }
  return { skip: true, reason: 'malformed-record' };
}

// ─── preview() ────────────────────────────────────────────────

/**
 * Probe the API token, fetch a single page, and return summary stats so
 * the customer can sanity-check before committing.
 *
 * @param {object} args
 * @param {string} args.apiToken      — Bearer token from developer.cftools.cloud
 * @param {string} [args.banlistId]
 * @param {string} [args.serverId]    — alternate to banlistId
 *
 * @returns {Promise<{
 *   banlistId: string,
 *   firstPageCount: number,
 *   estimatedSteam64: number,
 *   estimatedSkipped: number,
 *   sample: Array<{ steamId, reason, cftoolsId }>,
 * }>}
 */
async function preview({ apiToken, banlistId, serverId }) {
  if (!banlistId && !serverId) {
    throw new Error('Either banlistId or serverId is required');
  }

  // Fail fast on bad tokens before the streamed fetch surfaces a
  // less-friendly error.
  await client.probeToken(apiToken);

  const resolvedBanlistId = banlistId
    ? banlistId
    : await client.getBanlistIdForServer(apiToken, serverId);

  // CFTools' bans endpoint returns a streamed response. Per their docs
  // there's no pagination — we get the whole list in one call. Categorize
  // every record so the customer knows up-front how many are importable
  // (Steam64 in payload), how many are skipped (no Steam64 / IPv4), etc.
  const all = await client.getAllBans(apiToken, resolvedBanlistId);

  const counts = {
    importable: 0,
    skipNoSteam64: 0,
    skipIpv4: 0,
    skipMalformed: 0,
  };
  const sample = [];
  for (const raw of all) {
    const n = normalizeBan(raw);
    if (!n) {
      counts.skipMalformed++;
      continue;
    }
    if (n.skip) {
      if (n.reason === 'unsupported-format:ipv4') counts.skipIpv4++;
      else if (n.reason === 'no-steam64-on-record:cftools_id') counts.skipNoSteam64++;
      else counts.skipMalformed++;
      continue;
    }
    counts.importable++;
    if (sample.length < PREVIEW_SAMPLE_SIZE) {
      sample.push({ steamId: n.steamId, reason: n.reason, cftoolsId: n.cftoolsId });
    }
  }

  return {
    banlistId: resolvedBanlistId,
    totalRecords: all.length,
    estimatedSteam64: counts.importable,
    estimatedSkipped: counts.skipNoSteam64 + counts.skipIpv4 + counts.skipMalformed,
    skipBreakdown: counts,
    sample,
  };
}

// ─── importAll() ──────────────────────────────────────────────

/**
 * Page through the entire CFTools banlist and import to local. Filters
 * to Steam64-format bans, dedupes against the existing local ban DB
 * (per ban-engine.addBan dedup-by-steamId), and returns counts.
 *
 * @param {object} args
 * @param {string} args.apiToken      — Bearer token from developer.cftools.cloud
 * @param {string} [args.banlistId]
 * @param {string} [args.serverId]
 * @param {string} [args.bannedBy]   — recorded as the importer username
 *
 * @returns {Promise<{
 *   added: number,
 *   updated: number,        — existing local ban refreshed with CFTools metadata
 *   skipped: number,        — non-Steam64 or malformed records
 *   pagesProcessed: number,
 *   errors: Array<{ steamId?: string, message: string }>,
 *   capped: boolean,
 * }>}
 */
async function importAll({ apiToken, banlistId, serverId, bannedBy }) {
  if (!banlistId && !serverId) {
    throw new Error('Either banlistId or serverId is required');
  }

  await client.probeToken(apiToken);

  const resolvedBanlistId = banlistId
    ? banlistId
    : await client.getBanlistIdForServer(apiToken, serverId);

  // Snapshot existing local SteamIDs so we can distinguish "added new"
  // vs "updated existing" without hitting ctx.banDatabase repeatedly.
  const existingSteamIds = new Set();
  try {
    for (const b of listBans()) {
      if (b?.steamId) existingSteamIds.add(b.steamId);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'cftools-import: failed to read existing bans for dedupe — will still import (with possible duplicates handled by addBan)');
  }

  const result = {
    added: 0,
    updated: 0,
    skipped: 0,
    skipBreakdown: { skipNoSteam64: 0, skipIpv4: 0, skipMalformed: 0 },
    errors: [],
    capped: false,
    totalRecords: 0,
  };

  // CFTools returns a streamed response, but per their docs there's no
  // explicit pagination — we get the whole list in one call.
  const all = await client.getAllBans(apiToken, resolvedBanlistId);
  result.totalRecords = all.length;

  if (all.length > MAX_IMPORT_BANS) {
    result.capped = true;
    logger.warn(
      { banlistId: resolvedBanlistId, total: all.length, max: MAX_IMPORT_BANS },
      'cftools-import: list exceeds MAX_IMPORT_BANS — truncating',
    );
  }

  const records = result.capped ? all.slice(0, MAX_IMPORT_BANS) : all;

  for (const raw of records) {
    const n = normalizeBan(raw);
    if (!n) {
      result.skipped++;
      result.skipBreakdown.skipMalformed++;
      continue;
    }
    if (n.skip) {
      result.skipped++;
      if (n.reason === 'unsupported-format:ipv4') result.skipBreakdown.skipIpv4++;
      else if (n.reason === 'no-steam64-on-record:cftools_id') result.skipBreakdown.skipNoSteam64++;
      else result.skipBreakdown.skipMalformed++;
      continue;
    }

    try {
      const wasExisting = existingSteamIds.has(n.steamId);
      addBan({
        steamId: n.steamId,
        playerName: 'CFTools import',
        reason: n.reason,
        expiresAt: n.expiresAt,
        bannedBy: bannedBy || 'cftools-import',
        source: 'cftools-import',
      });
      if (wasExisting) {
        result.updated++;
      } else {
        result.added++;
        existingSteamIds.add(n.steamId);
      }
    } catch (err) {
      result.errors.push({
        steamId: n.steamId,
        message: err.message?.slice(0, 200) || 'unknown',
      });
    }
  }

  logger.info(
    {
      banlistId: resolvedBanlistId,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      skipBreakdown: result.skipBreakdown,
      errors: result.errors.length,
      total: result.totalRecords,
    },
    'cftools-import: complete',
  );

  return result;
}

module.exports = {
  preview,
  importAll,
  normalizeBan,
  findSteam64Anywhere,
  MAX_IMPORT_BANS,
  PREVIEW_SAMPLE_SIZE,
};
