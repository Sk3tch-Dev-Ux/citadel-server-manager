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
/** How many lines to read from the tail of events.jsonl */
const EVENTS_TAIL_LINES = 500;

class CitadelBridge extends EventEmitter {
  /**
   * @param {object} server — server config object from ctx.servers
   */
  constructor(server) {
    super();
    this.serverId = server.id;
    this.server = server;
    this._pollTimer = null;
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
  startPolling(intervalMs = 2000) {
    if (this._pollTimer) return;
    this._polling = true;
    logger.info({ serverId: this.serverId, dir: this.citadelDir }, 'CitadelBridge: starting file polling');

    // Immediate first poll
    this._poll();

    this._pollTimer = setInterval(() => this._poll(), intervalMs);
  }

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
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
  _pollFile(key, filePath) {
    try {
      const stat = fs.statSync(filePath);
      const mtime = stat.mtimeMs;
      if (mtime === this._cache[key].mtime) return; // No change

      const raw = fs.readFileSync(filePath, 'utf-8');
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

    // Poll for response
    const resPath = path.join(this.responsesDir, `${id}.res.json`);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        if (Date.now() - startTime > timeoutMs) {
          // Clean up command file if mod hasn't picked it up
          try { fs.unlinkSync(cmdPath); } catch { /* ok */ }
          return reject(new Error(`Command timed out after ${timeoutMs}ms (action: ${action})`));
        }

        try {
          if (fs.existsSync(resPath)) {
            const raw = fs.readFileSync(resPath, 'utf-8');
            const response = JSON.parse(raw);

            // Clean up response file
            try { fs.unlinkSync(resPath); } catch { /* ok */ }

            logger.debug({ serverId: this.serverId, action, id, ok: response.ok }, 'CitadelBridge: command response');
            return resolve(response);
          }
        } catch (err) {
          logger.debug({ err: err.message }, 'CitadelBridge: error reading response');
        }

        setTimeout(check, 200); // Poll every 200ms
      };

      check();
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
