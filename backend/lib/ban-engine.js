/**
 * Global Ban Database Engine.
 *
 * Persistent ban storage in data/bans.json with:
 *   - UUID ban IDs (shareable between server owners)
 *   - ban.txt sync for DayZ enforcement
 *   - RCON ban + kick for immediate effect
 *   - Import / Export support
 */
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const logger = require('./logger');
const ctx = require('./context');
const CONFIG = require('./config');
const { saveJSON } = require('./data-store');

// ─── Persistence ──────────────────────────────────────────

/**
 * A valid ban identity: Steam64 (17 digits) or a BattlEye GUID (32 hex) — i.e.
 * alphanumeric, no whitespace/newlines/control chars. This guards the flat
 * ban.txt and bans.json writers against an id containing a newline injecting
 * extra ban entries.
 */
const _BAN_ID_RE = /^[A-Za-z0-9]{1,64}$/;
function _isValidBanId(id) { return typeof id === 'string' && _BAN_ID_RE.test(id); }

/** Debounced write of banDatabase to disk */
function _persist() {
  saveJSON(ctx.CONFIG.dataDir, 'bans.json', ctx.banDatabase);
}

// ─── Change Notification ──────────────────────────────────
// Fired after every ban-database mutation (add/remove/import). The
// cloud-bridge forwarders subscribe to push a fresh ban_list snapshot up to
// the cloud so the web console's Ban Manager stays in sync.

const _changeListeners = new Set();

/** Subscribe to ban-database mutations. Returns an unsubscribe function. */
function onBansChanged(fn) {
  _changeListeners.add(fn);
  return () => _changeListeners.delete(fn);
}

function _notifyBansChanged() {
  for (const fn of _changeListeners) {
    try { fn(); } catch { /* a listener must never break a ban write */ }
  }
}

// ─── Query ────────────────────────────────────────────────

/** List all bans. */
function listBans() {
  return ctx.banDatabase;
}

/** Find a ban by its UUID. */
function getBanById(banId) {
  return ctx.banDatabase.find(b => b.id === banId) || null;
}

/** Find a ban by SteamID64. */
function getBanBySteamId(steamId) {
  return ctx.banDatabase.find(b => b.steamId === steamId) || null;
}

// ─── Write ────────────────────────────────────────────────

/**
 * Add a ban to the global database.
 * Deduplicates by steamId — if already banned, updates the existing entry.
 * Syncs to ban.txt for all servers.
 */
function addBan({ steamId, playerName, reason, expiresAt, bannedBy, source }) {
  let ban = ctx.banDatabase.find(b => b.steamId === steamId);
  if (ban) {
    // Update existing ban
    if (reason) ban.reason = reason;
    if (expiresAt !== undefined) ban.expiresAt = expiresAt;
    if (bannedBy) ban.bannedBy = bannedBy;
    if (source) ban.source = source;
  } else {
    ban = {
      id: uuid(),
      steamId,
      playerName: playerName || 'Unknown',
      reason: reason || 'Banned',
      bannedAt: new Date().toISOString(),
      expiresAt: expiresAt || null,
      bannedBy: bannedBy || 'system',
      source: source || 'manual',
    };
    ctx.banDatabase.push(ban);
  }
  _persist();
  // Sync to ban.txt (BattlEye) + bans.json (mod reason-aware enforcement).
  for (const srv of ctx.servers) {
    _writeBanToFile(srv, steamId);
    syncBansJsonToProfile(srv);
  }
  _notifyBansChanged();
  return ban;
}

/**
 * Remove a ban by UUID.
 * Removes from all server ban.txt files.
 */
function removeBan(banId) {
  const ban = ctx.banDatabase.find(b => b.id === banId);
  if (!ban) return null;
  ctx.banDatabase = ctx.banDatabase.filter(b => b.id !== banId);
  _persist();
  // Remove from ban.txt and refresh the mod enforcement file.
  for (const srv of ctx.servers) {
    _removeBanFromFile(srv, ban.steamId);
    syncBansJsonToProfile(srv);
  }
  _notifyBansChanged();
  return ban;
}

// ─── Kick Message Formatting ─────────────────────────────

/**
 * Build the kick reason string shown to the player when banned.
 * Uses the configurable template from Settings → Ban Settings.
 *
 * Supported placeholders:
 *   {reason} — the admin-provided ban reason
 *   {banId}  — the UUID ban ID (for appeals)
 *
 * If an appealUrl is configured, it replaces "our Discord" in the message.
 */
function _formatKickMessage(reason, banId) {
  let msg = CONFIG.bans?.kickMessage || 'You have been banned. Reason: {reason}. To appeal, visit our Discord.';
  const appealUrl = CONFIG.bans?.appealUrl;

  // Substitute placeholders
  msg = msg.replace(/\{reason\}/g, reason || 'Banned');
  msg = msg.replace(/\{banId\}/g, banId || '');

  // If an appeal URL is configured and the message still has the default "our Discord", replace it
  if (appealUrl) {
    msg = msg.replace(/our Discord/gi, appealUrl);
  }

  return msg;
}

// ─── Full Ban Flow (from Players page) ───────────────────

/**
 * Ban a live player: add to global DB + write ban.txt + kick + update player list.
 *
 * Enforcement strategy:
 *   1. Persist to bans.json (global database)
 *   2. Write steamId to ban.txt for all servers (DayZ reads this on connect)
 *   3. RCON kick with configurable ban message (shows reason + appeal info)
 *   4. Update in-memory player list + notify frontend
 *
 * Note: We do NOT use RCON `ban` because it requires a BattlEye session slot
 * number (0, 1, 2...) not a Steam64 ID. ban.txt is the reliable persistence
 * mechanism — DayZ checks it on every connection attempt.
 */
async function banPlayer(serverId, playerId, reason, expiration, adminUsername, reasonCategory) {
  const state = ctx.serverStates[serverId];
  const player = state?.players?.find(p => p.id === playerId || p.steamId === playerId);
  const steamId = player?.steamId || player?.id || playerId;

  // 1. Add to global ban database (also writes ban.txt for all servers)
  const ban = addBan({
    steamId,
    playerName: player?.name || 'Unknown',
    reason: reason || 'Banned',
    expiresAt: expiration || null,
    bannedBy: adminUsername || 'system',
    source: 'manual',
  });

  // 2. RCON kick with ban message (shows reason + appeal info to the player)
  if (state?.rcon) {
    try {
      const rconId = player?.rconSlot != null ? String(player.rconSlot) : playerId;
      const kickMessage = _formatKickMessage(reason, ban.id);
      await state.rcon.kick(rconId, kickMessage);
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'RCON kick after ban failed');
    }
  }

  // 3. Remove from player list and notify frontend
  if (state?.players) {
    state.players = state.players.filter(p => p.id !== playerId && p.steamId !== playerId);
    if (ctx.io) ctx.emitServer('players', { serverId, players: state.players });
  }

  // 4. Contribute to the Trust Network — ONLY when the admin explicitly
  // categorized the ban (cheating/griefing/exploiting). The shared DB is a
  // *cheater* network; auto-guessing a category from free-text would pollute
  // it, so an uncategorized ban stays local. submitFromLocalBan self-gates on
  // the Cloud entitlement.
  if (reasonCategory) {
    try {
      require('./cloud-bans')
        .submitFromLocalBan({ steamId, reasonCategory, notesLocal: reason || '' })
        .then((r) => { if (r?.ok) logger.info({ steamId, reasonCategory }, 'Contributed ban to Trust Network'); })
        .catch(() => {});
    } catch { /* cloud-bans unavailable */ }
  }

  return ban;
}

// ─── Server Sync ──────────────────────────────────────────

/**
 * Sync ALL global bans to a specific server's ban.txt.
 * Called on server start to ensure ban.txt is up-to-date.
 */
function syncAllBansToServer(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv?.installDir) return;
  const banPath = path.join(srv.installDir, 'ban.txt');
  const globalIds = ctx.banDatabase.map(b => b.steamId).filter(_isValidBanId);
  // Merge with existing ban.txt (preserve manual entries not in our database)
  let existing = [];
  try {
    if (fs.existsSync(banPath)) {
      existing = fs.readFileSync(banPath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    }
  } catch { /* ok */ }
  const merged = [...new Set([...existing, ...globalIds])];
  try {
    fs.writeFileSync(banPath, merged.join('\n') + (merged.length ? '\n' : ''));
    logger.info({ serverId, count: globalIds.length }, 'Synced global bans to ban.txt');
  } catch (err) {
    logger.warn({ err: err.message, serverId }, 'Failed to sync bans to ban.txt');
  }
  // Also write the richer JSON the @CitadelAdmin mod loads, so in-game
  // enforcement can show ban reasons (ban.txt carries SteamIDs only).
  syncBansJsonToProfile(srv);
}

/**
 * Resolve a server's profile Citadel directory (mirrors citadel-bridge):
 *   {profileDir or installDir/profiles}/Citadel
 */
function _citadelProfileDir(srv) {
  const profileDir = srv.profileDir
    ? path.resolve(srv.installDir, srv.profileDir)
    : path.join(srv.installDir, 'profiles');
  return path.join(profileDir, 'Citadel');
}

/**
 * Write $profile:Citadel/bans.json (the file CitadelBanManager loads) from the
 * global ban database. Reasons + names are included so the mod can reject a
 * banned player on connect with a meaningful message.
 */
function syncBansJsonToProfile(srv) {
  if (!srv?.installDir) return;
  try {
    const dir = _citadelProfileDir(srv);
    fs.mkdirSync(dir, { recursive: true });
    // Build the union of local/global bans and Trust-Network community bans,
    // keyed by SteamID. Local entries win (they carry an admin reason + name);
    // community entries fill in the rest so the mod can reject a community-banned
    // player on connect with a "Trust Network: <category>" message — previously
    // community bans only reached ban.txt (BattlEye), with no reason shown.
    const byId = new Map();
    for (const b of ctx.banDatabase) {
      if (!_isValidBanId(String(b.steamId || ''))) continue;
      byId.set(String(b.steamId), {
        player_id: String(b.steamId),
        player_name: b.playerName || 'Unknown',
        reason: b.reason || 'Banned',
        // Match the mod's "YYYY-MM-DD HH:MM:SS" format (from ISO).
        banned_at: (b.bannedAt || '').replace('T', ' ').slice(0, 19),
      });
    }
    let community = [];
    try { community = require('./cloud-bans').listCachedBans() || []; } catch { community = []; }
    for (const c of community) {
      if (!_isValidBanId(String(c.steamId || '')) || byId.has(String(c.steamId))) continue;
      byId.set(String(c.steamId), {
        player_id: String(c.steamId),
        player_name: 'Unknown',
        reason: `Trust Network: ${c.reasonCategory || 'banned'}`,
        banned_at: (c.activatedAt || '').replace('T', ' ').slice(0, 19),
      });
    }
    fs.writeFileSync(path.join(dir, 'bans.json'), JSON.stringify({ bans: [...byId.values()] }, null, 2));
  } catch (err) {
    logger.warn({ err: err.message, serverId: srv.id }, 'Failed to write bans.json for mod enforcement');
  }
}

/** Refresh the mod enforcement file (bans.json) for every managed server. */
function syncBansJsonToAllServers() {
  for (const srv of ctx.servers) syncBansJsonToProfile(srv);
}

// ─── Import / Export ──────────────────────────────────────

/**
 * Import bans from a JSON array.
 * Generates new UUIDs for each imported ban. Skips duplicates by steamId.
 */
function importBans(bansArray, adminUsername) {
  let added = 0, skipped = 0, errors = 0;
  for (const entry of bansArray) {
    try {
      if (!_isValidBanId(String(entry.steamId || ''))) { errors++; continue; }
      const existing = ctx.banDatabase.find(b => b.steamId === entry.steamId);
      if (existing) { skipped++; continue; }
      ctx.banDatabase.push({
        id: uuid(),
        steamId: entry.steamId,
        playerName: entry.playerName || entry.name || 'Unknown',
        reason: entry.reason || 'Imported',
        bannedAt: entry.bannedAt || new Date().toISOString(),
        expiresAt: entry.expiresAt || null,
        bannedBy: adminUsername || 'import',
        source: 'import',
      });
      added++;
    } catch { errors++; }
  }
  _persist();
  // Sync to all server ban.txt files
  for (const srv of ctx.servers) {
    syncAllBansToServer(srv.id);
  }
  if (added > 0) _notifyBansChanged();
  return { added, skipped, errors, total: ctx.banDatabase.length };
}

/** Export all bans as a clean array for JSON download. */
function exportBans() {
  return ctx.banDatabase.map(b => ({
    id: b.id,
    steamId: b.steamId,
    playerName: b.playerName,
    reason: b.reason,
    bannedAt: b.bannedAt,
    expiresAt: b.expiresAt,
    bannedBy: b.bannedBy,
    source: b.source,
  }));
}

// ─── File Helpers ─────────────────────────────────────────

function _writeBanToFile(srv, steamId) {
  try {
    if (!srv?.installDir) return;
    if (!_isValidBanId(steamId)) { logger.warn({ steamId }, 'Refused to write invalid SteamID to ban.txt'); return; }
    const banPath = path.join(srv.installDir, 'ban.txt');
    let existing = '';
    if (fs.existsSync(banPath)) existing = fs.readFileSync(banPath, 'utf-8');
    const lines = existing.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.includes(steamId)) {
      lines.push(steamId);
      fs.writeFileSync(banPath, lines.join('\n') + '\n');
    }
  } catch (err) {
    logger.warn({ err: err.message, server: srv.name }, 'Failed to write ban.txt');
  }
}

function _removeBanFromFile(srv, steamId) {
  try {
    if (!srv?.installDir) return;
    const banPath = path.join(srv.installDir, 'ban.txt');
    if (!fs.existsSync(banPath)) return;
    const lines = fs.readFileSync(banPath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    const filtered = lines.filter(l => l !== steamId);
    fs.writeFileSync(banPath, filtered.join('\n') + (filtered.length ? '\n' : ''));
  } catch (err) {
    logger.warn({ err: err.message, server: srv.name }, 'Failed to remove from ban.txt');
  }
}

module.exports = {
  listBans, getBanById, getBanBySteamId,
  addBan, removeBan, banPlayer, onBansChanged,
  syncAllBansToServer, syncBansJsonToProfile, syncBansJsonToAllServers, importBans, exportBans,
};
