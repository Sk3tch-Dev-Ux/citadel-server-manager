/**
 * DSC Sidecar — Ban Storage
 *
 * File-based ban list persisted alongside the DayZ server.
 * Replaces CFTools ban management with local JSON storage.
 */
const fs = require('fs');
const { v4: uuid } = require('uuid');
const config = require('./config');
const logger = require('./logger');

let bans = [];

function load() {
  try {
    if (fs.existsSync(config.banFile)) {
      bans = JSON.parse(fs.readFileSync(config.banFile, 'utf-8'));
      logger.info({ count: bans.length }, 'Bans loaded');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to load bans');
    bans = [];
  }
}

function save() {
  try {
    fs.writeFileSync(config.banFile, JSON.stringify(bans, null, 2));
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to save bans');
  }
}

function list() {
  return bans;
}

function add(steamId, name, reason, expiration) {
  const entry = {
    id: uuid(),
    steamId,
    name: name || 'Unknown',
    reason: reason || 'Banned by admin',
    bannedAt: new Date().toISOString(),
    expiresAt: expiration instanceof Date ? expiration.toISOString()
      : (typeof expiration === 'string' && expiration !== 'permanent' && expiration !== 'Permanent')
        ? expiration : null,
    source: 'inhouse',
  };
  bans.push(entry);
  save();
  return entry;
}

function remove(banIdOrSteamId) {
  const before = bans.length;
  bans = bans.filter(b => b.id !== banIdOrSteamId && b.steamId !== banIdOrSteamId);
  if (bans.length !== before) save();
  return before !== bans.length;
}

function isBanned(steamId) {
  const now = new Date();
  return bans.some(b => {
    if (b.steamId !== steamId) return false;
    if (b.expiresAt && new Date(b.expiresAt) < now) return false;
    return true;
  });
}

/**
 * Cleanup expired bans.
 */
function purgeExpired() {
  const now = new Date();
  const before = bans.length;
  bans = bans.filter(b => !b.expiresAt || new Date(b.expiresAt) >= now);
  if (bans.length !== before) {
    save();
    logger.info({ purged: before - bans.length }, 'Expired bans purged');
  }
}

// Load on require
load();

module.exports = { list, add, remove, isBanned, purgeExpired, load, save };
