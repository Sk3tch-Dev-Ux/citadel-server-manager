'use strict';

/**
 * Persistent server-metrics store (SQLite via better-sqlite3).
 *
 * Complements the in-memory rolling window (audit.pushMetrics): every sample is
 * also written here so CPU/RAM/FPS/player history survives restarts and can be
 * queried over arbitrary time ranges (dashboards, trends, exports) instead of
 * the ~90-minute in-RAM window.
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

let db = null;
let insertStmt = null;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function int(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }

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
    db.exec(`CREATE TABLE IF NOT EXISTS server_metrics (
      server_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      cpu REAL, ram REAL, players INTEGER, fps REAL
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sm_server_ts ON server_metrics(server_id, ts);');
    insertStmt = db.prepare(
      'INSERT INTO server_metrics (server_id, ts, cpu, ram, players, fps) VALUES (?, ?, ?, ?, ?, ?)'
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
 * Persist one metrics sample. No-op if persistence is disabled.
 * @param {string} serverId
 * @param {{cpu?:number, ram?:number, players?:number, fps?:number, ts?:number}} sample
 */
function record(serverId, sample) {
  if (!db || !serverId || !sample) return;
  try {
    insertStmt.run(serverId, sample.ts || Date.now(), num(sample.cpu), num(sample.ram), int(sample.players), num(sample.fps));
  } catch (err) {
    logger.debug({ err: err.message }, 'metrics-store: record failed');
  }
}

/**
 * Query historical samples for a server.
 * @param {string} serverId
 * @param {{since?:number, until?:number, limit?:number, downsampleSeconds?:number}} [opts]
 * @returns {Array<{ts:number, cpu:number, ram:number, players:number, fps:number}>}
 */
function query(serverId, opts = {}) {
  if (!db || !serverId) return [];
  const since = int(opts.since) || 0;
  const until = opts.until ? int(opts.until) : Date.now();
  const limit = Math.min(int(opts.limit) || 5000, MAX_ROWS);
  try {
    if (opts.downsampleSeconds && opts.downsampleSeconds > 0) {
      const bucket = int(opts.downsampleSeconds) * 1000;
      // CAST(... AS INTEGER) forces integer division so samples in the same
      // bucket collapse (SQLite would otherwise float-divide and never group).
      return db.prepare(
        `SELECT CAST(ts / ? AS INTEGER) * ? AS ts,
                AVG(cpu) AS cpu, AVG(ram) AS ram, AVG(players) AS players, AVG(fps) AS fps
         FROM server_metrics
         WHERE server_id = ? AND ts >= ? AND ts <= ?
         GROUP BY CAST(ts / ? AS INTEGER)
         ORDER BY ts ASC
         LIMIT ?`
      ).all(bucket, bucket, serverId, since, until, bucket, limit);
    }
    return db.prepare(
      `SELECT ts, cpu, ram, players, fps FROM server_metrics
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

/** Close the database (graceful shutdown / tests). */
function close() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
    insertStmt = null;
  }
}

module.exports = { init, record, query, prune, close, isEnabled, DEFAULT_RETENTION_MS };
