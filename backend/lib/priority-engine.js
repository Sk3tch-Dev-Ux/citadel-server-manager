/**
 * Priority Queue Engine.
 *
 * Manages VIP/priority queue entries with:
 *   - UUID-based entry IDs
 *   - Time-limited or permanent entries (expiresAt)
 *   - Automatic `priority.txt` sync for DayZ enforcement
 *   - Auto-expiration cleanup
 *   - Import / Export support
 *
 * DayZ reads `priority.txt` (Steam64 IDs, one per line) from the server
 * root directory. Players in this file are moved to the front of the
 * login queue. Since DayZ 1.13, the file is editable at runtime.
 */
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const logger = require('./logger');
const ctx = require('./context');
const { saveJSON } = require('./data-store');

// ─── Persistence ──────────────────────────────────────────

/** Debounced write of priorityQueue to disk */
function _persist() {
  saveJSON(ctx.CONFIG.dataDir, 'priority_queue.json', ctx.priorityQueue);
}

// ─── Query ────────────────────────────────────────────────

/** List all entries (including expired — caller can filter). */
function listEntries() {
  return ctx.priorityQueue;
}

/** Find an entry by UUID. */
function getEntryById(entryId) {
  return ctx.priorityQueue.find(e => e.id === entryId) || null;
}

/** Find an entry by SteamID64. */
function getEntryBySteamId(steamId) {
  return ctx.priorityQueue.find(e => e.steamId === steamId) || null;
}

/** Get only active (non-expired) entries. */
function _activeEntries() {
  const now = new Date().toISOString();
  return ctx.priorityQueue.filter(e => !e.expiresAt || e.expiresAt > now);
}

// ─── Write ────────────────────────────────────────────────

/**
 * Add an entry to the priority queue.
 * Deduplicates by steamId — if already queued, updates the existing entry.
 * Syncs to priority.txt for all servers.
 */
function addEntry({ steamId, name, role, expiresAt, addedBy, source }) {
  if (!steamId) throw new Error('steamId is required');

  let entry = ctx.priorityQueue.find(e => e.steamId === steamId);
  if (entry) {
    // Update existing entry
    if (name) entry.name = name;
    if (role) entry.role = role;
    if (expiresAt !== undefined) entry.expiresAt = expiresAt;
    if (addedBy) entry.addedBy = addedBy;
    if (source) entry.source = source;
  } else {
    entry = {
      id: uuid(),
      steamId,
      name: name || 'Unknown',
      role: role || 'VIP',
      addedAt: new Date().toISOString(),
      expiresAt: expiresAt || null,
      addedBy: addedBy || 'system',
      source: source || 'manual',
    };
    ctx.priorityQueue.push(entry);
  }

  _persist();

  // Sync to priority.txt for all servers
  for (const srv of ctx.servers) {
    _writePriorityFile(srv);
  }

  return entry;
}

/**
 * Update an existing entry (extend duration, change role, etc.).
 */
function updateEntry(entryId, updates) {
  const entry = ctx.priorityQueue.find(e => e.id === entryId);
  if (!entry) return null;

  if (updates.name !== undefined) entry.name = updates.name;
  if (updates.role !== undefined) entry.role = updates.role;
  if (updates.expiresAt !== undefined) entry.expiresAt = updates.expiresAt;

  _persist();

  // Re-sync priority.txt (expiration may have changed)
  for (const srv of ctx.servers) {
    _writePriorityFile(srv);
  }

  return entry;
}

/**
 * Remove an entry by UUID.
 * Removes from all server priority.txt files.
 */
function removeEntry(entryId) {
  const entry = ctx.priorityQueue.find(e => e.id === entryId);
  if (!entry) return null;

  ctx.priorityQueue = ctx.priorityQueue.filter(e => e.id !== entryId);
  _persist();

  // Re-sync priority.txt for all servers
  for (const srv of ctx.servers) {
    _writePriorityFile(srv);
  }

  return entry;
}

// ─── Expiration Cleanup ───────────────────────────────────

/**
 * Remove all expired entries from the queue.
 * Called periodically by a timer in server.js.
 * Returns the number of entries removed.
 */
function cleanExpired() {
  const now = new Date().toISOString();
  const expired = ctx.priorityQueue.filter(e => e.expiresAt && e.expiresAt <= now);
  if (expired.length === 0) return 0;

  ctx.priorityQueue = ctx.priorityQueue.filter(e => !e.expiresAt || e.expiresAt > now);
  _persist();

  // Re-sync priority.txt for all servers (expired IDs need removal)
  for (const srv of ctx.servers) {
    _writePriorityFile(srv);
  }

  logger.info({ count: expired.length }, 'Cleaned expired priority queue entries');
  return expired.length;
}

// ─── Server Sync ──────────────────────────────────────────

/**
 * Sync ALL active priority entries to a specific server's priority.txt.
 * Called on server start/restart to ensure priority.txt is up-to-date.
 */
function syncToServer(serverId) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv?.installDir) return;
  _writePriorityFile(srv);
}

// ─── Import / Export ──────────────────────────────────────

/**
 * Import entries from a JSON array.
 * Generates new UUIDs for each imported entry. Skips duplicates by steamId.
 */
function importEntries(entriesArray, adminUsername) {
  let added = 0, skipped = 0, errors = 0;
  for (const entry of entriesArray) {
    try {
      if (!entry.steamId) { errors++; continue; }
      const existing = ctx.priorityQueue.find(e => e.steamId === entry.steamId);
      if (existing) { skipped++; continue; }
      ctx.priorityQueue.push({
        id: uuid(),
        steamId: entry.steamId,
        name: entry.name || entry.playerName || 'Unknown',
        role: entry.role || 'VIP',
        addedAt: entry.addedAt || new Date().toISOString(),
        expiresAt: entry.expiresAt || null,
        addedBy: adminUsername || 'import',
        source: 'import',
      });
      added++;
    } catch { errors++; }
  }
  _persist();
  // Sync to all server priority.txt files
  for (const srv of ctx.servers) {
    _writePriorityFile(srv);
  }
  return { added, skipped, errors, total: ctx.priorityQueue.length };
}

/** Export all entries as a clean array for JSON download. */
function exportEntries() {
  return ctx.priorityQueue.map(e => ({
    id: e.id,
    steamId: e.steamId,
    name: e.name,
    role: e.role,
    addedAt: e.addedAt,
    expiresAt: e.expiresAt,
    addedBy: e.addedBy,
    source: e.source,
  }));
}

// ─── File Helpers ─────────────────────────────────────────

/**
 * Write priority.txt for a server.
 * Only includes active (non-expired) entries.
 * Merges with any existing entries in the file not in our database
 * (preserves manually-added IDs).
 */
function _writePriorityFile(srv) {
  try {
    if (!srv?.installDir) return;
    const filePath = path.join(srv.installDir, 'priority.txt');
    const activeIds = _activeEntries().map(e => e.steamId).filter(Boolean);

    // Read existing file and preserve entries not in our database
    let existing = [];
    try {
      if (fs.existsSync(filePath)) {
        existing = fs.readFileSync(filePath, 'utf-8')
          .split('\n')
          .map(l => l.replace(/\/\/.*$/, '').trim()) // strip comments
          .filter(l => l && /^\d+$/.test(l)); // only valid Steam64 IDs
      }
    } catch { /* ok */ }

    const merged = [...new Set([...existing, ...activeIds])];

    // Remove expired IDs that are in our database but expired
    const now = new Date().toISOString();
    const expiredIds = ctx.priorityQueue
      .filter(e => e.expiresAt && e.expiresAt <= now)
      .map(e => e.steamId);
    const final = merged.filter(id => !expiredIds.includes(id));

    const content = '// Managed by Citadel — do not edit manually\n' +
      (final.length ? final.join('\n') + '\n' : '');
    fs.writeFileSync(filePath, content);
    logger.debug({ server: srv.name, count: final.length }, 'Wrote priority.txt');
  } catch (err) {
    logger.warn({ err: err.message, server: srv?.name }, 'Failed to write priority.txt');
  }
}

module.exports = {
  listEntries, getEntryById, getEntryBySteamId,
  addEntry, updateEntry, removeEntry,
  cleanExpired, syncToServer,
  importEntries, exportEntries,
};
