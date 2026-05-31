'use strict';

/**
 * Persistent server-metrics store (SQLite via better-sqlite3).
 *
 * Complements the in-memory rolling window (audit.pushMetrics): every sample is
 * also written here so CPU/RAM/FPS/player history survives restarts and can be
 * queried over arbitrary time ranges (dashboards, trends, exports) instead of
 * the ~90-minute in-RAM window.
 *
 * Beyond OS counters (cpu/ram) and the basic game signals (players/fps), this
 * also persists the *in-game* telemetry the @CitadelAdmin mod already produces —
 * simulation tick time (avg/low/high) and entity/AI/vehicle/animal counts. These
 * are the signals that actually predict a DayZ server dying (entity creep, tick
 * spikes) and were previously forwarded to the cloud but discarded locally.
 *
 * Resilience: better-sqlite3 is a native module. If it is unavailable on the
 * host, or init fails, the whole store degrades to a silent no-op — the Agent
 * keeps working with the in-memory window, just without persistence. Nothing
 * here ever throws into a caller.
 */
const path = require('path');
const logger = require('./logger');

let Database = null;
try {
  Database = require('better-sqlite3');
} catch (err) {
  logger.warn({ err: err.message }, 'metrics-store: better-sqlite3 unavailable — metrics persistence disabled');
}

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ROWS = 50_000;
// Per-server row cap (backstop against runaway growth between time-based prunes).
// ~250k rows ≈ 43 days at a 15s cadence — comfortably above the 30-day window.
const MAX_ROWS_PER_SERVER = 250_000;

let db = null;
let insertStmt = null;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function int(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }

// Columns persisted per sample, in insert order. cpu/ram/players/fps are the
// original set; the rest are the in-game metrics from the mod. Adding a name
// here (plus its kind) is all it takes to widen the store — init() migrates
// existing DBs and query() selects every column automatically.
const NUMERIC_COLUMNS = [
  { name: 'cpu', kind: 'REAL', map: num },
  { name: 'ram', kind: 'REAL', map: num },
  { name: 'players', kind: 'INTEGER', map: int },
  { name: 'fps', kind: 'REAL', map: num },
  { name: 'tick_avg', kind: 'REAL', map: num },
  { name: 'tick_low', kind: 'REAL', map: num },
  { name: 'tick_high', kind: 'REAL', map: num },
  { name: 'ai_count', kind: 'INTEGER', map: int },
  { name: 'active_ai', kind: 'INTEGER', map: int },
  { name: 'animal_count', kind: 'INTEGER', map: int },
  { name: 'vehicle_count', kind: 'INTEGER', map: int },
  { name: 'entity_count', kind: 'INTEGER', map: int },
];
const COLUMN_NAMES = NUMERIC_COLUMNS.map((c) => c.name);

/**
 * Open (or reopen) the metrics database.
 * @param {string} dataDir - directory for metrics.db, or ':memory:' for tests
 * @returns {boolean} true if persistence is active
 */
function init(dataDir) {
  if (!Database) return false;
  if (db) return true;
  try {
    const file = dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'metrics.db');
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    const cols = NUMERIC_COLUMNS.map((c) => `${c.name} ${c.kind}`).join(', ');
    db.exec(`CREATE TABLE IF NOT EXISTS server_metrics (
      server_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      ${cols}
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sm_server_ts ON server_metrics(server_id, ts);');
    migrateColumns(); // add any columns missing from an older on-disk schema
    const placeholders = COLUMN_NAMES.map(() => '?').join(', ');
    insertStmt = db.prepare(
      `INSERT INTO server_metrics (server_id, ts, ${COLUMN_NAMES.join(', ')}) VALUES (?, ?, ${placeholders})`
    );
    prune(); // drop anything already past retention on boot
    logger.info({ file }, 'metrics-store: initialized');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'metrics-store: init failed — persistence disabled');
    db = null;
    insertStmt = null;
    return false;
  }
}

/** @returns {boolean} whether persistence is currently active */
function isEnabled() { return !!db; }

/**
 * Add any columns that exist in NUMERIC_COLUMNS but not yet in the on-disk
 * table — lets an Agent that already has a metrics.db pick up the wider schema
 * without losing existing history. SQLite ALTER TABLE ADD COLUMN is cheap and
 * leaves old rows NULL (read back as 0 by query()).
 */
function migrateColumns() {
  const existing = new Set(db.prepare('PRAGMA table_info(server_metrics)').all().map((r) => r.name));
  for (const col of NUMERIC_COLUMNS) {
    if (!existing.has(col.name)) {
      db.exec(`ALTER TABLE server_metrics ADD COLUMN ${col.name} ${col.kind}`);
    }
  }
}

/**
 * Persist one metrics sample. No-op if persistence is disabled.
 * Unknown/missing fields default to 0, so callers may pass just the basics
 * (cpu/ram/players/fps) or the full in-game set.
 * @param {string} serverId
 * @param {{ts?:number, cpu?:number, ram?:number, players?:number, fps?:number,
 *           tick_avg?:number, tick_low?:number, tick_high?:number, ai_count?:number,
 *           active_ai?:number, animal_count?:number, vehicle_count?:number,
 *           entity_count?:number}} sample
 */
function record(serverId, sample) {
  if (!db || !serverId || !sample) return;
  try {
    const values = NUMERIC_COLUMNS.map((c) => c.map(sample[c.name]));
    insertStmt.run(serverId, sample.ts || Date.now(), ...values);
  } catch (err) {
    logger.debug({ err: err.message }, 'metrics-store: record failed');
  }
}

/**
 * Query historical samples for a server.
 * @param {string} serverId
 * @param {{since?:number, until?:number, limit?:number, downsampleSeconds?:number}} [opts]
 * @returns {Array<object>} rows of { ts, cpu, ram, players, fps, tick_avg, ... }
 */
function query(serverId, opts = {}) {
  if (!db || !serverId) return [];
  const since = int(opts.since) || 0;
  const until = opts.until ? int(opts.until) : Date.now();
  const limit = Math.min(int(opts.limit) || 5000, MAX_ROWS);
  const selectList = COLUMN_NAMES.join(', ');
  try {
    if (opts.downsampleSeconds && opts.downsampleSeconds > 0) {
      const bucket = int(opts.downsampleSeconds) * 1000;
      const avgList = COLUMN_NAMES.map((c) => `AVG(${c}) AS ${c}`).join(', ');
      // CAST(... AS INTEGER) forces integer division so samples in the same
      // bucket collapse (SQLite would otherwise float-divide and never group).
      return db.prepare(
        `SELECT CAST(ts / ? AS INTEGER) * ? AS ts, ${avgList}
         FROM server_metrics
         WHERE server_id = ? AND ts >= ? AND ts <= ?
         GROUP BY CAST(ts / ? AS INTEGER)
         ORDER BY ts ASC
         LIMIT ?`
      ).all(bucket, bucket, serverId, since, until, bucket, limit);
    }
    return db.prepare(
      `SELECT ts, ${selectList} FROM server_metrics
       WHERE server_id = ? AND ts >= ? AND ts <= ?
       ORDER BY ts ASC LIMIT ?`
    ).all(serverId, since, until, limit);
  } catch (err) {
    logger.debug({ err: err.message }, 'metrics-store: query failed');
    return [];
  }
}

/**
 * Delete samples older than the retention window.
 * @param {number} [retentionMs]
 * @returns {number} rows deleted
 */
function prune(retentionMs = DEFAULT_RETENTION_MS) {
  if (!db) return 0;
  try {
    const cutoff = Date.now() - retentionMs;
    return db.prepare('DELETE FROM server_metrics WHERE ts < ?').run(cutoff).changes;
  } catch (err) {
    logger.debug({ err: err.message }, 'metrics-store: prune failed');
    return 0;
  }
}

/**
 * Cap the number of rows kept per server (newest-N), so even a server that runs
 * continuously between time-based prunes can't grow the table unbounded.
 * @param {number} [maxPerServer]
 * @returns {number} rows deleted
 */
function pruneRowCap(maxPerServer = MAX_ROWS_PER_SERVER) {
  if (!db) return 0;
  try {
    // For each server, delete everything older than its newest `maxPerServer`
    // rows (rowid ordering matches insertion/time order).
    return db.prepare(
      `DELETE FROM server_metrics WHERE rowid IN (
         SELECT rowid FROM (
           SELECT rowid, ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY ts DESC) AS rn
           FROM server_metrics
         ) WHERE rn > ?
       )`
    ).run(maxPerServer).changes;
  } catch (err) {
    logger.debug({ err: err.message }, 'metrics-store: pruneRowCap failed');
    return 0;
  }
}

/** Run both retention passes (time window + per-server row cap). */
function runMaintenance() {
  const byTime = prune();
  const byCap = pruneRowCap();
  if (byTime || byCap) logger.debug({ byTime, byCap }, 'metrics-store: maintenance pruned rows');
  return byTime + byCap;
}

/** Close the database (graceful shutdown / tests). */
function close() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
    insertStmt = null;
  }
}

module.exports = { init, record, query, prune, pruneRowCap, runMaintenance, close, isEnabled, DEFAULT_RETENTION_MS };
