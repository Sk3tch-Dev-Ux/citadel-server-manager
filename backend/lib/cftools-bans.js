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

/** Debounced write of banDatabase to disk */
function _persist() {
  saveJSON(ctx.CONFIG.dataDir, 'bans.json', ctx.banDatabase);
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
  // Sync to ban.txt for all servers
  for (const srv of ctx.servers) {
    _writeBanToFile(srv, steamId);
  }
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
  // Remove from all server ban.txt files
  for (const srv of ctx.servers) {
    _removeBanFromFile(srv, ban.steamId);
  }
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
async function banPlayer(serverId, playerId, reason, expiration, adminUsername) {
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
    if (ctx.io) ctx.io.emit('players', { serverId, players: state.players });
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
  const globalIds = ctx.banDatabase.map(b => b.steamId).filter(Boolean);
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
      if (!entry.steamId) { errors++; continue; }
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
  addBan, removeBan, banPlayer,
  syncAllBansToServer, importBans, exportBans,
};
