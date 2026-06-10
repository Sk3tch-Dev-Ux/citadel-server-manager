/**
 * CitadelBridge — File-based bridge between the @CitadelAdmin DayZ mod
 * and the DayzServerController backend.
 *
 * The mod writes JSON data files to {profileDir}/Citadel/:
 *   - players.json      (every 5s)
 *   - metrics.json       (every 15s)
 *   - vehicles.json      (every 10s)
 *   - events_world.json  (every 10s)
 *   - events.jsonl       (append-only event log)
 *
 * Commands are sent via:
 *   - commands/{id}.cmd.json   (backend writes)
 *   - responses/{id}.res.json  (mod writes, backend reads)
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');
const { v4: uuid } = require('uuid');
const logger = require('./logger');
const ctx = require('./context');

/** How long before we consider mod data stale */
const STALE_THRESHOLD_MS = 30_000;
/** Default command response timeout */
const COMMAND_TIMEOUT_MS = 10_000;
/** Max events to keep in memory */
const MAX_CACHED_EVENTS = 500;

class CitadelBridge extends EventEmitter {
  /**
   * @param {object} server — server config object from ctx.servers
   */
  constructor(server) {
    super();
    this.serverId = server.id;
    this.server = server;
    this._dirWatcher = null;     // fs.watch on citadelDir (data files)
    this._fallbackTimer = null;  // coarse safety-net poll (watch can miss events)
    this._resWatcher = null;     // fs.watch on responsesDir (command responses)
    this._resBackstop = null;    // backstop poll while commands are pending
    this._pending = new Map();   // command id -> pending resolver entry
    this._polling = false;

    // Resolve the Citadel data directory
    const profileDir = server.profileDir
      ? path.resolve(server.installDir, server.profileDir)
      : path.join(server.installDir, 'profiles');
    this.citadelDir = path.join(profileDir, 'Citadel');
    this.commandsDir = path.join(this.citadelDir, 'commands');
    this.responsesDir = path.join(this.citadelDir, 'responses');

    // File paths
    this.files = {
      players: path.join(this.citadelDir, 'players.json'),
      metrics: path.join(this.citadelDir, 'metrics.json'),
      vehicles: path.join(this.citadelDir, 'vehicles.json'),
      worldEvents: path.join(this.citadelDir, 'events_world.json'),
      events: path.join(this.citadelDir, 'events.jsonl'),
    };

    // Cached data + mtimes for change detection
    this._cache = {
      players: { data: null, mtime: 0 },
      metrics: { data: null, mtime: 0 },
      vehicles: { data: null, mtime: 0 },
      worldEvents: { data: null, mtime: 0 },
    };

    // Events cache (tail of JSONL)
    this._eventsCache = [];
    this._eventsFileSize = 0;

    // Track subscriber count for auto-start/stop
    this._subscriberCount = 0;
  }

  // ─── Polling ─────────────────────────────────────────────

  /**
   * Start polling mod files for changes.
   * @param {number} intervalMs — poll interval (default 2000ms)
   */
  startPolling(intervalMs = 5000) {
    if (this._fallbackTimer || this._dirWatcher) return;
    this._polling = true;
    logger.info({ serverId: this.serverId, dir: this.citadelDir }, 'CitadelBridge: starting file watch + fallback poll');

    // Immediate first read so consumers have current state right away.
    this._poll();

    // Primary path: watch the Citadel dir and re-read only the file that
    // changed, instead of stat-ing every file on a fixed interval. fs.watch on
    // Windows (ReadDirectoryChangesW) is reliable; the fallback interval below
    // still runs (far slower than before) in case an event is ever coalesced
    // or dropped.
    try {
      fs.mkdirSync(this.citadelDir, { recursive: true });
      this._dirWatcher = fs.watch(this.citadelDir, (_evt, filename) => {
        if (!filename) { this._poll(); return; }
        const name = filename.toString();
        for (const [key, fp] of Object.entries(this.files)) {
          if (path.basename(fp) === name) {
            if (key === 'events') this._pollEvents();
            else this._pollFile(key, fp);
            return;
          }
        }
      });
      this._dirWatcher.on('error', (err) => {
        logger.debug({ err: err.message, serverId: this.serverId }, 'CitadelBridge: dir watcher error');
      });
    } catch (err) {
      logger.debug({ err: err.message, serverId: this.serverId }, 'CitadelBridge: fs.watch unavailable — interval poll only');
    }

    this._fallbackTimer = setInterval(() => this._poll(), intervalMs);
  }

  stopPolling() {
    if (this._dirWatcher) {
      try { this._dirWatcher.close(); } catch { /* ok */ }
      this._dirWatcher = null;
    }
    if (this._fallbackTimer) {
      clearInterval(this._fallbackTimer);
      this._fallbackTimer = null;
    }
    this._polling = false;
    logger.info({ serverId: this.serverId }, 'CitadelBridge: stopped polling');
  }

  /** Increment subscriber count; auto-start polling if first subscriber */
  addSubscriber() {
    this._subscriberCount++;
    if (this._subscriberCount === 1) this.startPolling();
  }

  /** Decrement subscriber count; auto-stop polling if no subscribers left */
  removeSubscriber() {
    this._subscriberCount = Math.max(0, this._subscriberCount - 1);
    if (this._subscriberCount === 0) this.stopPolling();
  }

  async _poll() {
    // Poll each data file for changes
    this._pollFile('players', this.files.players);
    this._pollFile('metrics', this.files.metrics);
    this._pollFile('vehicles', this.files.vehicles);
    this._pollFile('worldEvents', this.files.worldEvents);
    this._pollEvents();
  }

  /**
   * Check a JSON file's mtime and re-parse if changed.
   * Emits an event when data changes.
   */
  async _pollFile(key, filePath) {
    try {
      const stat = await fsp.stat(filePath);
      const mtime = stat.mtimeMs;
      if (mtime === this._cache[key].mtime) return; // No change

      const raw = await fsp.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      this._cache[key].data = data;
      this._cache[key].mtime = mtime;

      this.emit(key, data);
    } catch (err) {
      // File doesn't exist or can't be parsed — that's fine, mod may not be running
      if (err.code !== 'ENOENT') {
        logger.debug({ err: err.message, serverId: this.serverId, file: key }, 'CitadelBridge: error reading file');
      }
    }
  }

  /**
   * Tail the events.jsonl file for new entries.
   * Only reads bytes past the last known file size.
   */
  _pollEvents() {
    try {
      const stat = fs.statSync(this.files.events);
      // Rotation/truncation guard: if the file shrank below our cursor, the
      // log was rotated — reset so we don't compute a negative read length.
      if (stat.size < this._eventsFileSize) this._eventsFileSize = 0;
      if (stat.size === this._eventsFileSize) return; // No change

      const isFirstRead = this._eventsFileSize === 0;
      const readFrom = isFirstRead ? Math.max(0, stat.size - 64 * 1024) : this._eventsFileSize;

      const fd = fs.openSync(this.files.events, 'r');
      const buf = Buffer.alloc(stat.size - readFrom);
      fs.readSync(fd, buf, 0, buf.length, readFrom);
      fs.closeSync(fd);

      const chunk = buf.toString('utf-8');
      const lines = chunk.split('\n').filter(l => l.trim());

      const newEvents = [];
      for (const line of lines) {
        try {
          newEvents.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }

      this._eventsFileSize = stat.size;

      if (newEvents.length > 0) {
        // Append to cache, cap at MAX_CACHED_EVENTS
        this._eventsCache = [...this._eventsCache, ...newEvents].slice(-MAX_CACHED_EVENTS);

        // Only emit new events (not the initial bulk read on first poll)
        if (!isFirstRead) {
          this.emit('events', newEvents);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.debug({ err: err.message, serverId: this.serverId }, 'CitadelBridge: error reading events.jsonl');
      }
    }
  }

  // ─── Durable event tail (G1 — cloud forwarder) ───────────
  //
  // The methods below give the cloud forwarder its OWN byte-cursor over
  // events.jsonl, independent of the live _pollEvents cursor (which serves
  // local dashboard consumers). This is what makes cloud delivery survive
  // backend restarts and cloud outages: the forwarder persists how far it
  // got and resumes from there, instead of the in-memory _eventsFileSize
  // that resets every process start.

  /** Current size of events.jsonl in bytes (0 if absent/unreadable). */
  getEventsSize() {
    try {
      return fs.statSync(this.files.events).size;
    } catch {
      return 0;
    }
  }

  /**
   * Read complete event lines from events.jsonl starting at `fromOffset`.
   * Line-boundary safe (never splits a partial trailing line still being
   * appended) and rotation safe (if the file shrank below the offset, re-tail
   * from the start). Pure read — does not mutate any bridge cursor.
   *
   * @param {number} fromOffset — byte offset to read from
   * @returns {{ events: object[], nextOffset: number }}
   */
  readEventsFrom(fromOffset) {
    let stat;
    try {
      stat = fs.statSync(this.files.events);
    } catch {
      return { events: [], nextOffset: fromOffset };
    }

    let from = (typeof fromOffset === 'number' && fromOffset >= 0) ? fromOffset : 0;
    if (from > stat.size) from = 0; // rotated/truncated — re-tail from start
    if (from >= stat.size) return { events: [], nextOffset: from };

    const len = stat.size - from;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(this.files.events, 'r');
    try {
      fs.readSync(fd, buf, 0, len, from);
    } finally {
      fs.closeSync(fd);
    }

    // Only consume through the last newline so a partial final line (mid-append)
    // is left for the next read rather than being split and lost.
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl === -1) return { events: [], nextOffset: from };
    const consumed = buf.subarray(0, lastNl + 1);
    const nextOffset = from + consumed.length;

    const events = [];
    for (const line of consumed.toString('utf-8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        events.push(JSON.parse(t));
      } catch {
        // skip malformed line
      }
    }
    return { events, nextOffset };
  }

  // ─── Data Readers ────────────────────────────────────────

  getPlayers() {
    return this._cache.players.data || [];
  }

  getMetrics() {
    return this._cache.metrics.data || {};
  }

  getVehicles() {
    return this._cache.vehicles.data || [];
  }

  getWorldEvents() {
    return this._cache.worldEvents.data || [];
  }

  /**
   * Get recent events from the cache.
   * @param {number} limit — max events to return
   * @param {string} [type] — filter by event type
   */
  getRecentEvents(limit = 100, type = null) {
    let events = this._eventsCache;
    if (type) {
      events = events.filter(e => e.type === type);
    }
    return events.slice(-limit);
  }

  // ─── Command System ──────────────────────────────────────

  /**
   * Send a command to the mod and wait for a response.
   *
   * @param {string} action — e.g. "player.heal"
   * @param {object} params — action parameters
   * @param {number} [timeoutMs] — override default timeout
   * @returns {Promise<object>} — the response payload
   */
  async sendCommand(action, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    const id = uuid();

    // Ensure directories exist
    try {
      fs.mkdirSync(this.commandsDir, { recursive: true });
    } catch { /* already exists */ }

    // Write command file
    const cmdPayload = { id, action, params };
    const cmdPath = path.join(this.commandsDir, `${id}.cmd.json`);
    fs.writeFileSync(cmdPath, JSON.stringify(cmdPayload), 'utf-8');

    logger.debug({ serverId: this.serverId, action, id }, 'CitadelBridge: command sent');

    // Wait for the response file. Resolved by fs.watch on the responses dir
    // (near-instant) with a slower backstop poll in case an event is missed —
    // replaces the old 200ms synchronous busy-poll.
    const resPath = path.join(this.responsesDir, `${id}.res.json`);

    return new Promise((resolve, reject) => {
      const entry = { resPath, done: false, timer: null };

      const finish = (fn, arg) => {
        if (entry.done) return;
        entry.done = true;
        if (entry.timer) clearTimeout(entry.timer);
        this._pending.delete(id);
        this._maybeStopResWatcher();
        fn(arg);
      };

      // Read + consume the response if present; no-op (ENOENT) if not yet written.
      entry.tryResolve = async () => {
        if (entry.done) return;
        try {
          const raw = await fsp.readFile(resPath, 'utf-8');
          const response = JSON.parse(raw);
          fsp.unlink(resPath).catch(() => {});
          logger.debug({ serverId: this.serverId, action, id, ok: response.ok }, 'CitadelBridge: command response');
          finish(resolve, response);
        } catch (err) {
          if (err.code !== 'ENOENT') {
            logger.debug({ err: err.message }, 'CitadelBridge: error reading response');
          }
        }
      };

      entry.timer = setTimeout(() => {
        fsp.unlink(cmdPath).catch(() => {}); // mod never picked it up
        finish(reject, new Error(`Command timed out after ${timeoutMs}ms (action: ${action})`));
      }, timeoutMs);

      this._pending.set(id, entry);
      this._ensureResWatcher();
      entry.tryResolve(); // resolve immediately if the response already exists
    });
  }

  /**
   * Send multiple commands in sequence.
   * @param {Array<{action: string, params: object}>} commands
   * @returns {Promise<Array<object>>}
   */
  async sendBatch(commands) {
    const results = [];
    for (const cmd of commands) {
      try {
        const res = await this.sendCommand(cmd.action, cmd.params);
        results.push(res);
      } catch (err) {
        results.push({ id: null, ok: false, data: {}, error: err.message });
      }
    }
    return results;
  }

  // Lazily watch the responses dir while one or more commands are in flight.
  _ensureResWatcher() {
    if (this._resBackstop) return; // already armed
    try {
      fs.mkdirSync(this.responsesDir, { recursive: true });
      this._resWatcher = fs.watch(this.responsesDir, (_evt, filename) => {
        if (!filename) {
          for (const e of this._pending.values()) e.tryResolve();
          return;
        }
        const name = filename.toString();
        for (const e of this._pending.values()) {
          if (path.basename(e.resPath) === name) e.tryResolve();
        }
      });
      this._resWatcher.on('error', () => { /* backstop poll still covers us */ });
    } catch { /* fs.watch unavailable — backstop poll covers us */ }

    // Backstop: catch any create event fs.watch coalesces/drops. Runs only
    // while commands are pending, then is torn down by _maybeStopResWatcher.
    this._resBackstop = setInterval(() => {
      for (const e of this._pending.values()) e.tryResolve();
    }, 500);
  }

  // Tear down the responses watcher once no commands are pending.
  _maybeStopResWatcher() {
    if (this._pending.size > 0) return;
    if (this._resWatcher) {
      try { this._resWatcher.close(); } catch { /* ok */ }
      this._resWatcher = null;
    }
    if (this._resBackstop) {
      clearInterval(this._resBackstop);
      this._resBackstop = null;
    }
  }
  // ─── Status ──────────────────────────────────────────────

  /**
   * Check if the mod is active by testing whether data files exist
   * and were recently modified (< 30s).
   */
  isModActive() {
    try {
      const stat = fs.statSync(this.files.players);
      return (Date.now() - stat.mtimeMs) < STALE_THRESHOLD_MS;
    } catch {
      return false;
    }
  }

  /**
   * Get detailed status of all mod data files.
   */
  getStatus() {
    const result = { active: false, files: {} };

    for (const [key, filePath] of Object.entries(this.files)) {
      try {
        const stat = fs.statSync(filePath);
        const age = Date.now() - stat.mtimeMs;
        result.files[key] = {
          exists: true,
          lastModified: new Date(stat.mtimeMs).toISOString(),
          ageMs: age,
          stale: age > STALE_THRESHOLD_MS,
          size: stat.size,
        };
      } catch {
        result.files[key] = { exists: false };
      }
    }

    // Active if players.json or metrics.json was updated recently
    result.active = (
      (result.files.players?.exists && !result.files.players?.stale) ||
      (result.files.metrics?.exists && !result.files.metrics?.stale)
    );

    return result;
  }
}

// ─── Bridge Registry ──────────────────────────────────────
// One bridge per server, lazily created

const _bridges = {};

/**
 * Get or create a CitadelBridge for a server.
 * @param {string} serverId
 * @returns {CitadelBridge|null}
 */
function getBridge(serverId) {
  if (_bridges[serverId]) return _bridges[serverId];

  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return null;

  const bridge = new CitadelBridge(srv);
  _bridges[serverId] = bridge;
  return bridge;
}

/**
 * Destroy a bridge (e.g., when a server is deleted).
 */
function destroyBridge(serverId) {
  const bridge = _bridges[serverId];
  if (bridge) {
    bridge.stopPolling();
    bridge.removeAllListeners();
    delete _bridges[serverId];
  }
}

/**
 * Stop all bridges (for graceful shutdown).
 */
function shutdownAll() {
  for (const id of Object.keys(_bridges)) {
    destroyBridge(id);
  }
}

module.exports = { CitadelBridge, getBridge, destroyBridge, shutdownAll };
