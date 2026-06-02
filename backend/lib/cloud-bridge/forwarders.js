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
const { fetchRCONPlayerData } = require('../player-data');
const storage = require('./storage');
const logger = require('../logger');

// How often the durable tailer reads new events.jsonl lines and forwards them.
// 1s keeps live latency on par with the bridge's 2s poll while bounding the
// re-read window after a reconnect.
const EVENTS_TAIL_INTERVAL_MS = 1000;
// Cap how far back a reconnect/restart will replay, so a very long outage
// can't flood the cloud on reconnect. Older bytes are skipped (and logged).
const MAX_REPLAY_BYTES = 8 * 1024 * 1024;

class Forwarder {
  /**
   * @param {string} localServerId
   */
  constructor(localServerId) {
    this.localServerId = localServerId;
    this._client = null;
    this._bridge = null;
    this._handlers = null;  // { metrics, players } — kept so we can off() on detach
    this._rconTimer = null; // periodic RCon player (IP/ping) forward for cloud enforcement
    this._healthTimer = null; // periodic deep-health snapshot forward (agent_health)
    this._eventsTimer = null; // durable events.jsonl tailer (G1)
    this._cloudOffset = 0;    // byte offset through which events.jsonl is forwarded
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
    // metrics + players are point-in-time SNAPSHOTS (mod overwrites the whole
    // file each tick), so the live push is correct for them — there is nothing
    // to replay. events.jsonl is an append-only LOG, handled separately below.
    const handlers = {
      metrics: (data) => this._onMetrics(data),
      players: (players) => this._onPlayers(players),
    };
    bridge.on('metrics', handlers.metrics);
    bridge.on('players', handlers.players);
    this._handlers = handlers;

    // Bridge polling reference-counts via addSubscriber. Without this the
    // bridge stays idle when no dashboard client is watching, and we'd
    // never get any metrics/players even though the WS is connected.
    bridge.addSubscriber();

    // events.jsonl is forwarded via our OWN durable byte cursor rather than the
    // bridge's live 'events' push, so cloud delivery survives backend restarts
    // and cloud outages: we persist how far we've forwarded and resume there.
    // Resolve the start offset (persisted, or the current tail for a brand-new
    // link), persist a baseline, then tail on an interval AND once immediately
    // so a reconnect backfills the missed window right away.
    this._cloudOffset = this._resolveStartOffset();
    storage.setAckedOffset(this.localServerId, this._cloudOffset);
    this._eventsTimer = setInterval(() => { this._tailEvents(); }, EVENTS_TAIL_INTERVAL_MS);
    this._eventsTimer.unref?.();
    this._tailEvents();

    // Forward the BattlEye RCon player snapshot (IP + ping) every 30s so the
    // cloud enforcement worker can run VPN/geo/Steam/ping checks — data the
    // mod can't see at the script layer. No-op when RCon isn't logged in.
    this._rconTimer = setInterval(() => { void this._forwardRconPlayers(); }, 30_000);
    this._rconTimer.unref?.();

    // Forward a deep-health snapshot (the GET /api/health/deep per-server slice)
    // every 30s so Cloud can observe local degradation — sidecar/DZSA down, RCON
    // disconnected, integrity drift, crash-loop — before it becomes an outage.
    this._forwardAgentHealth();
    this._healthTimer = setInterval(() => { this._forwardAgentHealth(); }, 30_000);
    this._healthTimer.unref?.();

    logger.debug({ localServerId: this.localServerId }, 'forwarder: attached');
  }

  /** Build + send the agent_health snapshot for this server. Best-effort. */
  _forwardAgentHealth() {
    try {
      const ctx = require('../context');
      const id = this.localServerId;
      const state = ctx.serverStates[id] || {};
      const safe = (fn, fb) => { try { return fn(); } catch { return fb; } };
      const crash = safe(() => require('../crash-detector').getCrashStats(id), null) || {};
      const lastCheck = safe(() => require('../integrity-engine').getReport(id)?.lastCheck, null);
      const data = {
        status: state.status || 'unknown',
        players: state.players?.length || 0,
        uptime_sec: state.startedAt ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000) : 0,
        rcon_connected: !!state.rcon?.loggedIn,
        sidecar_running: safe(() => require('../sidecar-manager').isSidecarRunning(id), false),
        dzsa_publishing: safe(() => require('../dzsa-publisher').isPublishing(id), false),
        integrity_ok: lastCheck ? !!lastCheck.ok : null,
        restart_pending: safe(() => require('../server-lifecycle').isRestartPending(id), false),
        crash_restarts_hour: crash.restartsLastHour || 0,
        breaker_tripped: !!crash.breakerTripped,
        agent_rss_mb: Math.round(process.memoryUsage().rss / 1048576),
        metrics_store_enabled: safe(() => require('../metrics-store').isEnabled(), false),
      };
      this._client?.send({ type: 'agent_health', ts: Date.now(), data });
    } catch (err) {
      logger.debug({ err: err.message, localServerId: this.localServerId }, 'forwarder: agent_health forward failed');
    }
  }

  async _forwardRconPlayers() {
    try {
      const map = await fetchRCONPlayerData(this.localServerId);
      if (!map || map.size === 0) return;
      const players = [];
      for (const [name, info] of map) {
        players.push({ name, ip: info.ip, ping: Number(info.ping) || 0, guid: info.guid });
      }
      this._client?.send({ type: 'rcon_players', ts: Date.now(), data: { players } });
    } catch (err) {
      logger.debug({ err: err.message, localServerId: this.localServerId }, 'forwarder: rcon_players forward failed');
    }
  }

  /** Tear down. Idempotent. */
  detach() {
    if (this._rconTimer) { clearInterval(this._rconTimer); this._rconTimer = null; }
    if (this._healthTimer) { clearInterval(this._healthTimer); this._healthTimer = null; }
    if (this._eventsTimer) { clearInterval(this._eventsTimer); this._eventsTimer = null; }
    if (!this._client || !this._bridge || !this._handlers) {
      this._client = null;
      this._bridge = null;
      this._handlers = null;
      this._sessionStarts.clear();
      return;
    }
    const { metrics, players } = this._handlers;
    try { this._bridge.off('metrics', metrics); } catch { /* fine */ }
    try { this._bridge.off('players', players); } catch { /* fine */ }
    try { this._bridge.removeSubscriber(); } catch { /* fine */ }
    this._client = null;
    this._bridge = null;
    this._handlers = null;
    this._sessionStarts.clear();
    logger.debug({ localServerId: this.localServerId }, 'forwarder: detached');
  }

  // ─── durable events.jsonl tailer (G1) ────────────────────────────────
  //
  // Decide where to start forwarding from on (re)attach:
  //  - brand-new link (no persisted offset) → current tail; we don't replay
  //    the whole historical log on first ever connect.
  //  - existing link → resume from the persisted offset, guarding against
  //    rotation (offset > size) and capping how far back we replay.
  _resolveStartOffset() {
    const size = this._bridge.getEventsSize();
    const persisted = storage.getAckedOffset(this.localServerId);
    if (persisted == null) return size;

    let start = persisted;
    if (start > size) start = 0; // file rotated/shrank — re-tail from the start
    if (size - start > MAX_REPLAY_BYTES) {
      logger.warn(
        { localServerId: this.localServerId, skippedBytes: size - start - MAX_REPLAY_BYTES },
        'forwarder: events backlog exceeds replay cap — skipping oldest to bound reconnect replay',
      );
      start = size - MAX_REPLAY_BYTES;
    }
    return start;
  }

  // Forward any new complete events.jsonl lines, then advance + persist the
  // durable cursor. Only runs while authenticated; JS is single-threaded so
  // the socket can't flip OPEN→closed mid-batch — either we were authed for
  // the whole synchronous forward (advance) or we skip entirely (no advance,
  // re-read next tick). Worst case is one duplicate-free at-most-once loss of
  // a batch the OS buffered but never delivered at a hard TCP drop.
  _tailEvents() {
    if (!this._client || !this._bridge) return;
    if (typeof this._client.isAuthenticated === 'function' && !this._client.isAuthenticated()) return;

    let res;
    try {
      res = this._bridge.readEventsFrom(this._cloudOffset);
    } catch (err) {
      logger.debug({ err: err.message, localServerId: this.localServerId }, 'forwarder: tail read failed');
      return;
    }
    if (!res || res.nextOffset === this._cloudOffset) return; // nothing new

    this._onEvents(res.events);
    this._cloudOffset = res.nextOffset;
    storage.setAckedOffset(this.localServerId, res.nextOffset);
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
        case 'kill':
          this._emitKill(ev);
          break;
        case 'chat':
          this._emitChat(ev);
          break;
        case 'death':
          this._emitDeath(ev);
          break;
        case 'suicide':
          this._emitDeath({ ...ev, deathType: 'suicide', cause: ev.cause || 'suicide' });
          break;
        case 'playerStats':
          this._emitPlayerStats(ev);
          break;
        default:
          // Other event types (hit, baseBuilt, dynamicEvent, etc.) are out
          // of scope for Phase 4 — left for a later pass.
      }
    }
  }

  // ─── kill ────────────────────────────────────────────────────────────
  //
  // Cloud's `kill` carries killer + victim ids/names/pos, weapon, distance,
  // is_headshot, optional hit_zone. Mod writes the killer's steamId as the
  // generic 'steamId' field (per the events.jsonl convention), so we map
  // that to killer_steam_id and the explicitly-named victim fields verbatim.
  _emitKill(ev) {
    if (!ev.steamId || !ev.victimSteamId) return;
    const hitZone = _normalizeHitZone(ev.zone);
    this._client?.send({
      type: 'kill',
      ts: _eventTs(ev),
      data: {
        killer_steam_id: String(ev.steamId),
        killer_name: String(ev.name || ''),
        victim_steam_id: String(ev.victimSteamId),
        victim_name: String(ev.victimName || ''),
        weapon: String(ev.weapon || ''),
        distance: _safeNum(ev.distance, 0),
        killer_pos: _posOrZero(ev.killerPos),
        victim_pos: _posOrZero(ev.victimPos),
        is_headshot: hitZone === 'head' || hitZone === 'brain',
        hit_zone: hitZone,
      },
    });
  }

  // ─── chat ────────────────────────────────────────────────────────────
  _emitChat(ev) {
    if (!ev.steamId || ev.message == null) return;
    this._client?.send({
      type: 'chat',
      ts: _eventTs(ev),
      data: {
        steam_id: String(ev.steamId),
        name: String(ev.name || ''),
        message: String(ev.message),
        channel: String(ev.channel || ''),
      },
    });
  }

  // ─── death (PvP/environmental/suicide) ───────────────────────────────
  //
  // Cloud's enum: pvp / suicide / fall / environment / infected / explosion
  // / animal / unknown. Mod writes free-form strings — normalize by
  // matching common substrings. When 'killer' style fields are absent
  // (non-PvP), omit killer_steam_id rather than sending an empty string.
  _emitDeath(ev) {
    if (!ev.steamId) return;
    const deathType = _normalizeDeathType(ev.deathType, ev.cause);
    const data = {
      steam_id: String(ev.steamId),
      name: String(ev.name || ''),
      death_type: deathType,
      cause: String(ev.cause || ev.deathType || 'unknown'),
      position: _posOrZero(ev.position),
    };
    if (ev.weapon) data.weapon = String(ev.weapon);
    if (ev.killerSteamId) data.killer_steam_id = String(ev.killerSteamId);
    this._client?.send({
      type: 'death',
      ts: _eventTs(ev),
      data,
    });
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

  // ─── player_stats_update (live anti-cheat) ───────────────────────────
  //
  // Periodic cumulative per-player counters. The mod already emits
  // cloud-aligned snake_case keys (shots_fired, shots_hit_player, …), so
  // this is a 1:1 copy — no rename logic. Cloud's recordPlayerStats stores
  // cumulative values and computes deltas at query time, which is what the
  // cheat-detection sweep and trust score consume.
  _emitPlayerStats(ev) {
    if (!ev.steamId) return;
    this._client?.send({
      type: 'player_stats_update',
      ts: _eventTs(ev),
      data: {
        steam_id: String(ev.steamId),
        shots_fired: _safeInt(ev.shots_fired, 0),
        shots_hit_player: _safeInt(ev.shots_hit_player, 0),
        shots_hit_infected: _safeInt(ev.shots_hit_infected, 0),
        shots_hit_animal: _safeInt(ev.shots_hit_animal, 0),
        shots_hit_vehicle: _safeInt(ev.shots_hit_vehicle, 0),
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

/**
 * Normalize the mod's DamageZone string (e.g. "Head", "RightUpperArm",
 * "LeftThigh", "Torso") into the cloud's HitZone enum. Lowercase +
 * substring-match — DayZ's zone names vary by item/animation, but the
 * coarse body-part bucket the cloud cares about is stable.
 */
function _normalizeHitZone(zone) {
  if (typeof zone !== 'string') return 'unknown';
  const z = zone.toLowerCase();
  if (z.includes('brain')) return 'brain';
  if (z.includes('head')) return 'head';
  // Match left-arm variants (forearm, upperarm, hand) before plain 'arm'.
  if (z.includes('left') && (z.includes('arm') || z.includes('hand'))) return 'leftarm';
  if (z.includes('right') && (z.includes('arm') || z.includes('hand'))) return 'rightarm';
  if (z.includes('left') && (z.includes('leg') || z.includes('thigh') || z.includes('shin') || z.includes('foot'))) return 'leftleg';
  if (z.includes('right') && (z.includes('leg') || z.includes('thigh') || z.includes('shin') || z.includes('foot'))) return 'rightleg';
  if (z.includes('torso') || z.includes('chest') || z.includes('belly') || z.includes('back')) return 'torso';
  return 'unknown';
}

/**
 * Coerce a free-form death-type string into the cloud's DeathCause enum.
 * Looks at both the explicit deathType (mod usually writes this) and the
 * cause text (more specific phrasing); the first match wins.
 */
function _normalizeDeathType(deathType, cause) {
  const t = String(deathType || '').toLowerCase();
  const c = String(cause || '').toLowerCase();
  const blob = t + ' ' + c;
  if (blob.includes('suicide')) return 'suicide';
  if (blob.includes('pvp') || blob.includes('player')) return 'pvp';
  if (blob.includes('fall')) return 'fall';
  if (blob.includes('infect') || blob.includes('zombie')) return 'infected';
  if (blob.includes('explos') || blob.includes('grenade') || blob.includes('landmine')) return 'explosion';
  if (blob.includes('animal') || blob.includes('wolf') || blob.includes('bear')) return 'animal';
  if (blob.includes('environment') || blob.includes('starvation') || blob.includes('dehydr') || blob.includes('hypotherm') || blob.includes('hyperthermia') || blob.includes('disease') || blob.includes('blood')) return 'environment';
  return 'unknown';
}

/**
 * Defensively coerce a {x,y,z} object into one with finite numbers, falling
 * back to 0 for any missing axis. The cloud's wire type expects numbers
 * (not undefined), so this avoids dropping the whole message over a bad
 * field on one axis.
 */
function _posOrZero(p) {
  return {
    x: _safeNum(p?.x, 0),
    y: _safeNum(p?.y, 0),
    z: _safeNum(p?.z, 0),
  };
}

module.exports = { Forwarder };
