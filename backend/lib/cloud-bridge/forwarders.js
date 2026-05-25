/**
 * Per-server telemetry forwarders — translate CitadelBridge file-IPC events
 * into PluginToCloudMessage frames and send them via the supervisor-owned
 * CloudWsClient. One Forwarder instance lives for the lifetime of one
 * authenticated WS connection.
 *
 * Wire shapes follow citadel-cloud/packages/shared/src/types/plugin.ts:
 *   metrics            — every emission from the bridge (mod's metrics.json)
 *   player_position    — every emission of the bridge's 'players' (mod's
 *                        players.json), batched into one message
 *   player_connect /
 *   player_disconnect  — derived from the bridge's 'events' stream by
 *                        matching {type: 'connect'} / {type: 'playtime'}
 *                        records in the events.jsonl tail.
 *
 * Why this lives separate from supervisor.js: keeps the lifecycle code (WS
 * connect/reconnect/stop) decoupled from the protocol-mapping code, and
 * lets the forwarder's tests target message shapes without booting a
 * supervisor + ctx. The supervisor owns one Forwarder per local server and
 * just calls .attach(client) / .detach() at the right lifecycle moments.
 */
const { getBridge } = require('../citadel-bridge');
const logger = require('../logger');

class Forwarder {
  /**
   * @param {string} localServerId
   */
  constructor(localServerId) {
    this.localServerId = localServerId;
    this._client = null;
    this._bridge = null;
    this._handlers = null;  // { metrics, players, events } — kept so we can off() on detach
    // sessionStarts is a per-Forwarder cache of when each steamId joined,
    // keyed by steamId. Lets us emit player_disconnect with `duration` even
    // if the mod's events.jsonl rotates or we missed the original `playtime`
    // record. Wiped on detach.
    this._sessionStarts = new Map();
  }

  /**
   * Wire bridge → client. Idempotent — calling twice is a no-op (the
   * supervisor relies on this when reauthenticating after a reconnect).
   *
   * @param {object} client — a CloudWsClient instance (must be authenticated)
   */
  attach(client) {
    if (this._client) return;
    const bridge = getBridge(this.localServerId);
    if (!bridge) {
      logger.warn({ localServerId: this.localServerId }, 'forwarder: no bridge available, telemetry off');
      return;
    }
    this._client = client;
    this._bridge = bridge;

    // Build the handlers in one place so detach can off() the same fn refs.
    const handlers = {
      metrics: (data) => this._onMetrics(data),
      players: (players) => this._onPlayers(players),
      events: (events) => this._onEvents(events),
    };
    bridge.on('metrics', handlers.metrics);
    bridge.on('players', handlers.players);
    bridge.on('events', handlers.events);
    this._handlers = handlers;

    // Bridge polling reference-counts via addSubscriber. Without this the
    // bridge stays idle when no dashboard client is watching, and we'd
    // never get any events even though the WS is connected.
    bridge.addSubscriber();

    logger.debug({ localServerId: this.localServerId }, 'forwarder: attached');
  }

  /** Tear down. Idempotent. */
  detach() {
    if (!this._client || !this._bridge || !this._handlers) {
      this._client = null;
      this._bridge = null;
      this._handlers = null;
      this._sessionStarts.clear();
      return;
    }
    const { metrics, players, events } = this._handlers;
    try { this._bridge.off('metrics', metrics); } catch { /* fine */ }
    try { this._bridge.off('players', players); } catch { /* fine */ }
    try { this._bridge.off('events', events); } catch { /* fine */ }
    try { this._bridge.removeSubscriber(); } catch { /* fine */ }
    this._client = null;
    this._bridge = null;
    this._handlers = null;
    this._sessionStarts.clear();
    logger.debug({ localServerId: this.localServerId }, 'forwarder: detached');
  }

  // ─── metrics ─────────────────────────────────────────────────────────
  //
  // Mod's metrics.json is already in cloud shape (fps as ×100 integer, all
  // the named counts). Just pick the cloud-known fields and forward — the
  // mod writes a few extras (tick_avg/low/high, event_count) we don't ship.
  _onMetrics(d) {
    if (!d || typeof d !== 'object') return;
    const msg = {
      type: 'metrics',
      ts: Date.now(),
      data: {
        fps:           _safeInt(d.fps, 0),
        players:       _safeInt(d.players, 0),
        ai_count:      _safeInt(d.ai_count, 0),
        active_ai:     _safeInt(d.active_ai, 0),
        animal_count:  _safeInt(d.animal_count, 0),
        vehicle_count: _safeInt(d.vehicle_count, 0),
        entity_count:  _safeInt(d.entity_count, 0),
        uptime:        _safeInt(d.uptime, 0),
      },
    };
    this._client?.send(msg);
  }

  // ─── player positions ────────────────────────────────────────────────
  //
  // Bridge emits the full player snapshot every poll (~5s by default in
  // mod config). The cloud accepts a batched player_position frame so we
  // send it as one message. Heading isn't in the current mod output —
  // ship 0 and flag as a future protocol field if the cloud ever rejects
  // it (it's typed `number`, not non-zero).
  _onPlayers(players) {
    if (!Array.isArray(players) || players.length === 0) return;
    const batch = [];
    for (const p of players) {
      const sid = p?.steamId;
      const pos = p?.position;
      if (!sid || !pos) continue;
      batch.push({
        s: String(sid),
        x: _safeNum(pos.x, 0),
        y: _safeNum(pos.y, 0),
        z: _safeNum(pos.z, 0),
        h: _safeNum(p.heading, 0),
      });
    }
    if (batch.length === 0) return;
    this._client?.send({
      type: 'player_position',
      ts: Date.now(),
      data: { players: batch },
    });
  }

  // ─── connect / disconnect ────────────────────────────────────────────
  //
  // Mod logs three event variants in events.jsonl that touch sessions:
  //   { type: 'connect',    steamId, name, timestamp }
  //   { type: 'playtime',   steamId, name, seconds, timestamp }   ← session-end
  //   { type: 'disconnect', steamId, name, timestamp }            ← raw disconnect
  //
  // We send `player_connect` on 'connect', and `player_disconnect` on
  // either 'playtime' (preferring its `seconds`) or 'disconnect' (computing
  // duration from our own session-start cache, since `disconnect` doesn't
  // carry one). De-duplicate per steamId so a `playtime`+`disconnect` pair
  // doesn't double-fire.
  _onEvents(events) {
    if (!Array.isArray(events)) return;
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      switch (ev.type) {
        case 'connect':
          this._emitConnect(ev);
          break;
        case 'playtime':
          this._emitDisconnect(ev, Number(ev.seconds) || 0);
          break;
        case 'disconnect': {
          // Only fire if we didn't already see a 'playtime' for this player
          // this session. The start map being empty means 'playtime'
          // already cleared it, OR we missed the connect (in which case
          // duration is 0, which is honest).
          const start = this._sessionStarts.get(ev.steamId);
          const duration = start ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0;
          this._emitDisconnect(ev, duration);
          break;
        }
        default:
          // Other event types (kill, chat, etc.) are out of scope for
          // Phase 3 — they land in Phase 4. Ignore quietly.
      }
    }
  }

  _emitConnect(ev) {
    if (!ev.steamId) return;
    this._sessionStarts.set(ev.steamId, Date.now());
    this._client?.send({
      type: 'player_connect',
      ts: _eventTs(ev),
      data: {
        steam_id: String(ev.steamId),
        name: String(ev.name || ''),
        ip: '',     // mod doesn't expose IP; cloud accepts empty
      },
    });
  }

  _emitDisconnect(ev, duration) {
    if (!ev.steamId) return;
    if (!this._sessionStarts.has(ev.steamId)) return; // already emitted
    this._sessionStarts.delete(ev.steamId);
    this._client?.send({
      type: 'player_disconnect',
      ts: _eventTs(ev),
      data: {
        steam_id: String(ev.steamId),
        name: String(ev.name || ''),
        duration: Math.max(0, Math.floor(duration) || 0),
      },
    });
  }
}

function _safeInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function _safeNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The mod's events.jsonl timestamps are ISO strings ("2026-05-25T00:34:16Z").
 * Cloud wants epoch ms. Parse and convert; fall back to "now" if the field
 * is missing or malformed.
 */
function _eventTs(ev) {
  if (ev?.timestamp) {
    const ms = Date.parse(ev.timestamp);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

module.exports = { Forwarder };
