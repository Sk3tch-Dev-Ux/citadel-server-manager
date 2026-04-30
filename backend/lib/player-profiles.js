/**
 * Player profile store — persistent, cross-wipe.
 *
 * Unlike pvp-stats (which wipes with the server), profiles persist forever.
 * They're an admin's memory: "who is this player, when did we last see them,
 * how many sessions, any admin notes, what have they said, who have they killed".
 *
 * Lifecycle:
 *   - `touchSeen(steamId, name, ip?)` is called on every player-list diff when
 *     a steamId appears (connect) or stays (still online). It opens a session,
 *     tracks aliases/IPs, updates lastSeen.
 *   - `closeSession(steamId)` is called when a steamId disappears from the
 *     online list (disconnect). It finalizes the session and accumulates
 *     total play time.
 *   - `recordChat/recordKill/recordDeath` append to the rolling timeline and
 *     lifetime counters.
 *   - `addNote / deleteNote` manage admin notes (persistent).
 *
 * Data is kept in `data/player-profiles-{serverId}.json`. Writes are debounced
 * at 800ms (we tolerate a bit more lag here than pvp-stats — profile writes
 * can be fatter).
 *
 * Caps are applied to keep JSON size reasonable:
 *   aliases: 10   ips: 5   sessions: 50   recentChat: 100   recentEvents: 150
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const WRITE_DEBOUNCE_MS = 800;
const CAP_ALIASES = 10;
const CAP_IPS = 5;
const CAP_SESSIONS = 50;
const CAP_CHAT = 100;
const CAP_EVENTS = 150;
const CAP_NOTES = 200;

/** @type {Map<string, { path: string, state: object, dirty: boolean, timer: NodeJS.Timeout | null }>} */
const _stores = new Map();

function _storePath(dataDir, serverId) {
  return path.join(dataDir, `player-profiles-${serverId}.json`);
}

function _emptyState() {
  return {
    version: 1,
    players: {}, // steamId → profile
  };
}

function _loadStore(dataDir, serverId) {
  const existing = _stores.get(serverId);
  if (existing) return existing;

  const filePath = _storePath(dataDir, serverId);
  let state = _emptyState();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.players) {
        state = parsed;
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, serverId }, 'player-profiles: failed to load — starting fresh');
  }

  const store = { path: filePath, state, dirty: false, timer: null };
  _stores.set(serverId, store);
  return store;
}

function _scheduleWrite(store) {
  store.dirty = true;
  if (store.timer) return;
  store.timer = setTimeout(() => {
    store.timer = null;
    if (!store.dirty) return;
    store.dirty = false;
    try {
      fs.mkdirSync(path.dirname(store.path), { recursive: true });
      fs.writeFileSync(store.path, JSON.stringify(store.state, null, 2), 'utf-8');
    } catch (err) {
      logger.error({ err: err.message, path: store.path }, 'player-profiles: failed to write');
    }
  }, WRITE_DEBOUNCE_MS);
}

/** Lazily create a per-player record. */
function _profile(state, steamId, name) {
  if (!state.players[steamId]) {
    const now = new Date().toISOString();
    state.players[steamId] = {
      steamId,
      name: name || 'Unknown',
      aliases: name ? [name] : [],
      firstSeen: now,
      lastSeen: now,
      ips: [],
      totalSessions: 0,
      totalPlayMs: 0,
      currentSessionStart: null,
      sessions: [],            // { start, end, durationMs }
      totalMessages: 0,
      recentChat: [],          // { channel, message, timestamp }
      lifetimeKills: 0,
      lifetimeDeaths: 0,
      lifetimeHeadshots: 0,
      lastKillAt: null,
      lastDeathAt: null,
      recentEvents: [],        // timeline: { type, timestamp, ...meta }
      notes: [],               // { id, authorId, authorName, text, timestamp }
      // Latest live snapshot from player.getFull (info/stats/gear). Saved
      // any time an admin opens the player's profile or hits "Get Info".
      // Survives logout: when a player disconnects, this is the last
      // known state. Used for forensics ("what gear did they have?").
      snapshot: null,          // { capturedAt, online, info, stats, gear }
    };
  }
  const p = state.players[steamId];
  if (name && p.name !== name) {
    p.name = name;
    if (!p.aliases.includes(name)) {
      p.aliases = [name, ...p.aliases].slice(0, CAP_ALIASES);
    }
  }
  return p;
}

function _pushEvent(profile, event) {
  profile.recentEvents.unshift(event);
  if (profile.recentEvents.length > CAP_EVENTS) profile.recentEvents.length = CAP_EVENTS;
}

/**
 * Mark a steamId as currently online. Opens a session if not already open.
 * Called on every tick where the player is present — cheap no-op after first.
 */
function touchSeen(dataDir, serverId, steamId, name, ip) {
  if (!steamId) return;
  const store = _loadStore(dataDir, serverId);
  const p = _profile(store.state, steamId, name);
  const now = new Date().toISOString();
  p.lastSeen = now;

  if (ip && !p.ips.includes(ip)) {
    p.ips = [ip, ...p.ips].slice(0, CAP_IPS);
  }

  // Fresh session? This is a join. Check the watchlist for this player —
  // done inside the "currentSessionStart is null" branch so we only fire
  // once per session, not every poll tick.
  if (!p.currentSessionStart) {
    p.currentSessionStart = now;
    _pushEvent(p, { type: 'connect', timestamp: now });
    try {
      // Lazy require to avoid circular deps — watchlist pulls in notifications
      // which pulls in context which pulls in logger…
      const { alertOnWatchlistHit } = require('./watchlist');
      alertOnWatchlistHit(serverId, { steamId, name });
    } catch {
      // Best-effort — never fail a session open because the watchlist
      // module had a hiccup.
    }
  }

  _scheduleWrite(store);
}

/**
 * A steamId disappeared from the online roster. Finalize their session.
 */
function closeSession(dataDir, serverId, steamId) {
  if (!steamId) return;
  const store = _loadStore(dataDir, serverId);
  const p = store.state.players[steamId];
  if (!p || !p.currentSessionStart) return;

  const start = p.currentSessionStart;
  const end = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(end) - Date.parse(start));

  p.sessions.unshift({ start, end, durationMs });
  if (p.sessions.length > CAP_SESSIONS) p.sessions.length = CAP_SESSIONS;
  p.totalSessions += 1;
  p.totalPlayMs += durationMs;
  p.currentSessionStart = null;
  p.lastSeen = end;

  _pushEvent(p, { type: 'disconnect', timestamp: end, durationMs });
  _scheduleWrite(store);
}

/**
 * Roster diff helper. Pass the current list of online steamIds; we open
 * sessions for new ones, close sessions for anyone who dropped.
 * `players` is the enriched list (name, ip) so we can annotate connects.
 */
function syncRoster(dataDir, serverId, players) {
  const store = _loadStore(dataDir, serverId);
  const online = new Set();
  for (const pl of players || []) {
    const sid = pl.steamId || pl.id;
    if (!sid) continue;
    online.add(sid);
    touchSeen(dataDir, serverId, sid, pl.name, pl.ip);
  }
  // Close sessions for anyone whose currentSessionStart is set but who is
  // no longer in the online set.
  for (const [sid, p] of Object.entries(store.state.players)) {
    if (p.currentSessionStart && !online.has(sid)) {
      closeSession(dataDir, serverId, sid);
    }
  }
}

function recordChat(dataDir, serverId, event) {
  if (!event || !event.steamId) return;
  const store = _loadStore(dataDir, serverId);
  const p = _profile(store.state, event.steamId, event.name);
  p.totalMessages += 1;
  const entry = {
    channel: event.channel || 'unknown',
    message: event.message || '',
    timestamp: event.timestamp || new Date().toISOString(),
  };
  p.recentChat.unshift(entry);
  if (p.recentChat.length > CAP_CHAT) p.recentChat.length = CAP_CHAT;
  _pushEvent(p, { type: 'chat', ...entry });
  _scheduleWrite(store);
}

function recordKill(dataDir, serverId, event) {
  if (!event || !event.steamId) return;
  // Self-kill: don't double-count; the death path will log it.
  if (event.victimSteamId && event.steamId === event.victimSteamId) return;
  const store = _loadStore(dataDir, serverId);
  const ts = event.timestamp || new Date().toISOString();
  const headshot = (event.zone || '').toLowerCase() === 'head';

  const killer = _profile(store.state, event.steamId, event.name);
  killer.lifetimeKills += 1;
  killer.lastKillAt = ts;
  if (headshot) killer.lifetimeHeadshots += 1;
  _pushEvent(killer, {
    type: 'kill',
    timestamp: ts,
    victim: event.victimName || event.victimSteamId || 'Unknown',
    victimSteamId: event.victimSteamId,
    weapon: event.weapon || null,
    distance: Number(event.distance) || 0,
    headshot,
  });

  if (event.victimSteamId) {
    const victim = _profile(store.state, event.victimSteamId, event.victimName);
    victim.lifetimeDeaths += 1;
    victim.lastDeathAt = ts;
    _pushEvent(victim, {
      type: 'death',
      timestamp: ts,
      killer: event.name || event.steamId,
      killerSteamId: event.steamId,
      weapon: event.weapon || null,
      distance: Number(event.distance) || 0,
      headshot,
    });
  }

  _scheduleWrite(store);
}

function recordDeath(dataDir, serverId, event) {
  if (!event || !event.steamId) return;
  const store = _loadStore(dataDir, serverId);
  const p = _profile(store.state, event.steamId, event.name);
  p.lifetimeDeaths += 1;
  const ts = event.timestamp || new Date().toISOString();
  p.lastDeathAt = ts;
  _pushEvent(p, {
    type: event.type === 'suicide' ? 'suicide' : 'death',
    timestamp: ts,
    cause: event.cause || event.reason || null,
  });
  _scheduleWrite(store);
}

/**
 * Persist a live snapshot from player.getFull. The mod returns:
 *   { info: { steamId, name, position, health, blood, ... },
 *     stats: { shotsFired, killsPlayers, distance, ... },
 *     gear:  { slots: { Back, Body, Feet, Legs, ... } } }
 *
 * We capture the whole thing under `profile.snapshot` plus a timestamp
 * so the UI can show "captured 2 minutes ago" alongside the data.
 *
 * Best-effort — if the input doesn't look right, we silently skip rather
 * than corrupting the profile.
 */
function recordSnapshot(dataDir, serverId, steamId, data) {
  if (!steamId || !data || typeof data !== 'object') return;
  // The mod can also return a flat object with steamId at top level when
  // the player isn't online. Accept either shape.
  const info = data.info || (data.steamId ? data : null);
  if (!info) return;

  const store = _loadStore(dataDir, serverId);
  const p = _profile(store.state, steamId, info.name);
  p.snapshot = {
    capturedAt: new Date().toISOString(),
    online: !!info.alive && info.position != null,
    info: info,
    stats: data.stats || null,
    gear: data.gear || null,
  };
  // Mirror common fields onto the top-level profile so search/list views
  // can show "last position" without parsing the snapshot blob.
  if (info.position) p.lastKnownPosition = info.position;
  _scheduleWrite(store);
  return p.snapshot;
}

// ─── Read APIs ──────────────────────────────────────────────

/**
 * Search profiles by name substring or exact steamId. Returns lightweight
 * summaries suitable for an autocomplete / player list sidebar.
 */
function search(dataDir, serverId, { q = '', limit = 30 } = {}) {
  const store = _loadStore(dataDir, serverId);
  const needle = String(q || '').toLowerCase().trim();
  const all = Object.values(store.state.players);
  const matches = needle
    ? all.filter((p) =>
        p.steamId === q ||
        (p.name || '').toLowerCase().includes(needle) ||
        p.aliases.some((a) => (a || '').toLowerCase().includes(needle))
      )
    : all;
  matches.sort((a, b) => Date.parse(b.lastSeen || 0) - Date.parse(a.lastSeen || 0));
  return {
    total: matches.length,
    results: matches.slice(0, limit).map((p) => ({
      steamId: p.steamId,
      name: p.name,
      aliases: p.aliases.slice(0, 5),
      lastSeen: p.lastSeen,
      firstSeen: p.firstSeen,
      totalSessions: p.totalSessions,
      totalPlayMs: p.totalPlayMs,
      lifetimeKills: p.lifetimeKills,
      lifetimeDeaths: p.lifetimeDeaths,
      online: !!p.currentSessionStart,
      notesCount: p.notes.length,
    })),
  };
}

/** Full profile with everything — used by the profile page. */
function getProfile(dataDir, serverId, steamId) {
  const store = _loadStore(dataDir, serverId);
  const p = store.state.players[steamId];
  if (!p) return null;
  return {
    ...p,
    kd: p.lifetimeDeaths > 0 ? p.lifetimeKills / p.lifetimeDeaths : p.lifetimeKills,
    headshotPct: p.lifetimeKills > 0 ? p.lifetimeHeadshots / p.lifetimeKills : 0,
    online: !!p.currentSessionStart,
  };
}

// ─── Notes ──────────────────────────────────────────────────

function addNote(dataDir, serverId, steamId, { authorId, authorName, text }) {
  if (!text || !text.trim()) throw new Error('Note text required');
  const store = _loadStore(dataDir, serverId);
  const p = _profile(store.state, steamId, null);
  const note = {
    id: crypto.randomBytes(8).toString('hex'),
    authorId: authorId || null,
    authorName: authorName || 'Unknown',
    text: text.trim().slice(0, 2000),
    timestamp: new Date().toISOString(),
  };
  p.notes.unshift(note);
  if (p.notes.length > CAP_NOTES) p.notes.length = CAP_NOTES;
  _scheduleWrite(store);
  return note;
}

function deleteNote(dataDir, serverId, steamId, noteId) {
  const store = _loadStore(dataDir, serverId);
  const p = store.state.players[steamId];
  if (!p) return false;
  const before = p.notes.length;
  p.notes = p.notes.filter((n) => n.id !== noteId);
  if (p.notes.length === before) return false;
  _scheduleWrite(store);
  return true;
}

/** Remove cached store (used for tests). */
function _clearCache() {
  for (const store of _stores.values()) {
    if (store.timer) clearTimeout(store.timer);
  }
  _stores.clear();
}

module.exports = {
  touchSeen,
  closeSession,
  syncRoster,
  recordChat,
  recordKill,
  recordDeath,
  recordSnapshot,
  search,
  getProfile,
  addNote,
  deleteNote,
  _clearCache,
};
