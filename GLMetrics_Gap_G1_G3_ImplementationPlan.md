# Implementation Plan — G1 (durable telemetry replay) + G3 (live anti-cheat)

> Companion to `GLMetrics_vs_Citadel_GapAnalysis.md`. File-level plan for the first work slice.
> Spans three codebases: **mod** (`dayz-mod/@CitadelAdmin`), **agent** (`backend/`), and
> **cloud** (`../citadel-cloud`). All line numbers verified against source on 2026-06-02.
>
> Status: **PR2 (G3a+G3b) + PR3 (G1 Phase 1) IMPLEMENTED 2026-06-02** — see *Build status* below.
> G3c (PR4) still pending. Update checkboxes as work lands.

## Key discovery (read first)

**The cloud side of G3 already exists and is starved of data:**
- Wire type `player_stats_update` is already defined — `citadel-cloud/packages/shared/src/types/plugin.ts:200`
  (`data{steam_id, shots_fired, shots_hit_player, shots_hit_infected, shots_hit_animal, shots_hit_vehicle}`).
- Handler `recordPlayerStats()` already persists it — `plugin-telemetry-sink.ts:335` → `plugin_player_stats`
  (cumulative counters; deltas computed at query time).
- Detection engine already exists — `cheat-detection.ts:runScan()` (line 55) with rules
  `impossible_accuracy`, `high_headshot_ratio`, `long_range_consistency`; writes `cheat_detections` table.
- Periodic worker already runs it — `ops-sweep.ts:startOpsSweep()` (line 92, started `index.ts:52`)
  calls `runScan(serverId)` per connected server and web-push-notifies the owner on new flags.
- Trust score already reads the data — `trust-score.ts:37` reads `plugin_kills` + latest `plugin_player_stats`.

**Why it's all dormant:** the mod emits stats **only on disconnect** as a `"session"` event
(`CitadelMissionServer.c:256-264`, `CitadelEventLogger.LogSession`). There is **no periodic emit**, the
agent forwarder has **no `player_stats_update` mapping**, so `plugin_player_stats` stays empty and the
accuracy rule + trust accuracy signal can never fire.

**Therefore G3 = three small plumbing steps** (mod emits periodically → agent forwards → cloud auto-acts),
not a new detection system. G1 is an independent agent-side durability fix.

---

## Workstream G3 — Live anti-cheat (turn on the dormant pipeline)

### G3a — Mod: emit player stats periodically  `[mod]`
Files: `dayz-mod/@CitadelAdmin/scripts/3_Game/CitadelEventLogger.c`,
`3_Game/CitadelConfiguration.c`, `4_World/CitadelPlayerTracker.c`.

- [x] **Add `LogPlayerStats`** to `CitadelEventLogger.c` (mirror `LogSession`, lines 284-293). Emit a
  **cloud-aligned, flat** shape so the forwarder mapping is trivial — do the field-name translation here,
  not in JS:
  ```c
  // type "playerStats" — keys match the cloud player_stats_update.data contract
  static void LogPlayerStats(string steamId, CitadelPlayerStats s) {
      string l = "{";
      l += JStr("type","playerStats");
      l += "," + JStr("steamId", steamId);
      l += "," + JNum("shots_fired", s.shotsFired);
      l += "," + JNum("shots_hit_player", s.shotsHitPlayers);
      l += "," + JNum("shots_hit_infected", s.shotsHitInfected);
      l += "," + JNum("shots_hit_animal", s.shotsHitAnimals);
      l += "," + JNum("shots_hit_vehicle", s.shotsHitVehicles);
      l += "," + JStr("timestamp", GetTimestamp());
      l += "}";
      AppendLine(l);  // inherits BATCH_SIZE=20 / FLUSH_INTERVAL=2s machinery
  }
  ```
  > Field mapping (mod struct → cloud contract): `shotsFired→shots_fired`, `shotsHitPlayers→shots_hit_player`,
  > `shotsHitInfected→shots_hit_infected`, `shotsHitAnimals→shots_hit_animal`, `shotsHitVehicles→shots_hit_vehicle`.
  > These differ in name (note `Players/Animals` plural in the struct), so this translation is mandatory.
- [x] **Add config field** in `CitadelConfiguration.c` following the convention (lines 13-16/67-70/96-103):
  `int statsUpdateIntervalMs = 30000;` + getter `GetStatsUpdateIntervalMs()` + clamp `< 5000` in
  `ValidateAndExtend()`.
- [x] **Drive the emit** from the existing 5s loop in `CitadelPlayerTracker.UpdatePlayerData()` (lowest
  friction — it already iterates `GetCitadel().GetActivePlayers()` with steamId in hand). Gate it to the
  configured interval (accumulate elapsed, or add a second `Timer` at `statsUpdateIntervalMs`). For each
  active player: `stats = GetCitadel().GetPlayerStats(steamId); if (stats) CitadelEventLogger.LogPlayerStats(steamId, stats);`
  Gate the whole thing on `GetConfiguration().GetTrackPlayerStats()` (same flag `LogSession` uses).
- **Acceptance:** with a player connected, `$profile:Citadel/events.jsonl` gains a `{"type":"playerStats",...}`
  line every ~30s carrying cumulative counters.

### G3b — Agent: forward `playerStats` → cloud `player_stats_update`  `[agent]`
File: `backend/lib/cloud-bridge/forwarders.js`.

- [x] In `_onEvents` (line 224), add a case for `ev.type === 'playerStats'` → new `_emitPlayerStats(ev)`.
- [x] **`_emitPlayerStats(ev)`** builds the standard `{type, ts, data}` frame (match `_emitKill` style, 270):
  ```js
  this._client?.send({
    type: 'player_stats_update',
    ts: _eventTs(ev),
    data: {
      steam_id: ev.steamId,
      shots_fired: _safeInt(ev.shots_fired),
      shots_hit_player: _safeInt(ev.shots_hit_player),
      shots_hit_infected: _safeInt(ev.shots_hit_infected),
      shots_hit_animal: _safeInt(ev.shots_hit_animal),
      shots_hit_vehicle: _safeInt(ev.shots_hit_vehicle),
    },
  });
  ```
  (Because G3a emits cloud-aligned keys, this is a 1:1 copy — no rename logic in JS.)
- **Acceptance:** rows appear in `plugin_player_stats` for the server; `GET /telemetry/players/:steamId/summary`
  shows non-zero accuracy; `trust-score` accuracy signal becomes live.

### G3c — Cloud: opt-in auto-KICK on high-confidence flags  `[cloud, gated, OFF by default]`
File: `citadel-cloud/packages/api/src/lib/ops-sweep.ts` (+ config).

> **Locked scope (2026-06-02):** auto-**KICK only**. No auto-ban. No automatic vouch-pool submission —
> cross-server propagation stays human-gated. Banning and pushing to the shared Cloud Bans pool remain
> manual operator actions through the existing UI.

`ops-sweep` already persists detections and web-push-notifies (lines 30-39). Add an **opt-in, per-server** kick step:
- [ ] New per-server config: `autoKickEnabled` (default `false`) + `autoKickScore` (e.g. 90).
- [ ] In `sweepServer` (line 22), when `autoKickEnabled` and a detection has `score >= autoKickScore`:
  - `await dispatchCommand(s.id, 'kick', { steam_id, reason: 'Citadel anti-cheat' })`
    (pattern at `enforcement-worker.ts:53`; `dispatchCommand` sig `plugin-command-dispatch.ts:66`).
  - Mark the detection `status: 'actioned'` (reuse `resolveDetection`, `cheat-detection.ts:194`).
  - Still web-push the owner so a human can follow up with a ban / vouch decision.
- [ ] Optional mod-side speed-hack auto-kick: in `CitadelPlayerHooks.CitPlayerTick` speed block
  (lines 380-399), behind a new `speedCheckAutoKick` config flag (default off), call
  `CitadelPlayerActions.KickPlayer(...)` / `GetGame().DisconnectPlayer(identity, identity.GetPlainId())`.
- **Explicitly OUT of scope** (locked): `dispatchCommand('ban', ...)` and `importBans(...)` auto-submission.
  A human reviews `cheat_detections` and decides bans / vouch-pool submissions.
- **Acceptance:** with `autoKickEnabled` + a scripted high-accuracy test player crossing threshold, the player
  is kicked live, the detection flips to `actioned`, the owner is notified, and **nothing** is written to the
  shared vouch pool.

> G3a + G3b alone make the entire existing detection/trust pipeline live. **G3c is additive** — ship a/b first.

---

## Workstream G1 — Durable telemetry replay across outages  `[agent, then cloud]`

**Problem (verified):** the events.jsonl cursor `_eventsFileSize` is **in-memory only**
(`citadel-bridge.js:69` init, `:174` advance); on first read it seeks to `size − 64KB` (`:155`) and
**does not emit** that initial tail (`:181-183`). The cloud WS **drops sends when disconnected**
(`ws-client.js:95-97`) with no buffer, and the forwarder is **detached during outages**
(`supervisor.js:134`). Net: any backend restart or cloud outage permanently loses the events produced
in the gap. Only events.jsonl-derived messages are in scope (kill/chat/death/connect/disconnect/playerStats);
`metrics`/`player_position` are point-in-time snapshots and must **not** be replayed.

### G1 Phase 1 — Persisted cursor + replay on reconnect (agent-only, no cloud change)
Files: `backend/lib/cloud-bridge/storage.js`, `citadel-bridge.js`, `cloud-bridge/supervisor.js`,
`cloud-bridge/forwarders.js`.

- [x] **Persist the cursor.** In `storage.js`, add `cloudAckedOffset` (bytes) to the per-link object
  (written in `setLink`, 118-129) + `getAckedOffset(localServerId)` / `setAckedOffset(localServerId, n)`
  mirroring `updateStatus` (154). `_writeRaw` is **synchronous full-file rewrite** (`:48`) — **debounce**
  writes (e.g. flush at most every 2-5s, and on `stop()`), not per-event.
- [x] **Make the events.jsonl read line-boundary-safe.** In `_pollEvents` (149-190), only advance the
  cursor to the last complete `\n` (today it advances to `stat.size`, risking a split trailing line on
  replay). Track `lastCompleteOffset` and emit only complete lines.
- [x] **Handle rotation/truncation.** If `stat.size < cursor` (file rotated/shrunk), reset cursor to 0 and
  re-tail (guard the negative-length `Buffer.alloc` at `:158`).
- [x] **Advance the durable offset on successful send.** `CloudWsClient.send()` returns `true` when handed
  to an OPEN socket (`ws-client.js:94`). The forwarder currently ignores that boolean — thread it back so
  the bridge advances `cloudAckedOffset` to the byte offset of the last line for which **every** derived
  `send()` returned `true`. (Simplest: have `_onEvents` report the high-water offset of successfully-sent
  lines back to the bridge, which calls `storage.setAckedOffset` debounced.)
- [x] **Replay on (re)connect.** In `supervisor.js` `client.on('authenticated', ...)` (118-125), **before**
  `_attachForwarder` (124): read events.jsonl from `getAckedOffset(localServerId)` forward, push those
  records through the same forwarder mapping (kill/chat/death/connect/disconnect/playerStats), then attach
  for live. Bound the replay (e.g. last 24h / N MB); `log()` if older data is skipped (no silent truncation).
- [x] **Stop discarding the first-read tail.** With a persisted cursor, the `if (!isFirstRead)` emit guard
  (`:181-183`) and the `size − 64KB` seek (`:155`) are replaced by "read from persisted cursor (default 0
  for a brand-new link, or tail for the very first ever start)."
- **Residual (document honestly):** "advance-on-send-true" means a batch handed to the socket microseconds
  before a drop *may* be lost (TCP buffered, never received) — at-most-once for that single boundary batch.
  No duplicates. This is a massive improvement over today (loses the entire outage window). Phase 2 closes it.
- **Acceptance:** `taskkill` the backend (or block the cloud WS) for 10 min under live kill/chat traffic →
  on reconnect, the dashboard kill/chat feeds **backfill the missing window** with no operator action and no
  visible duplicates.

### G1 Phase 2 — True cloud ack for exactly-once  `[DEFERRED — not this effort]`
> **Locked (2026-06-02):** out of scope for now. Documented for completeness; revisit only if the Phase-1
> single-boundary-batch residual proves to matter in practice.

Files: `citadel-cloud/.../plugin.ts`, `plugin-ws.routes.ts`, `plugin-telemetry-sink.ts`; agent `ws-client.js`.

- [ ] Add `CloudAckMessage { type:'ack', through_ts | offset }` to `CloudToPluginMessage` (plugin.ts:310)
  and widen the `send()` union in `plugin-ws.routes.ts:83`.
- [ ] Make sink handlers return a Promise (today fire-and-forget `void`, `:120-419`); in the route `default`
  branch (`:315-322`) await durable write, then emit `ack`. Batch acks (every N msgs / 1s) to avoid chatter.
- [ ] Agent: handle `ack` in `_handleMessage` (`ws-client.js:190`) → advance `cloudAckedOffset` **only on ack**
  (not on send-true). Add cloud-side idempotency (dedup key) for the small replay-overlap window.
- **Acceptance:** kill the socket mid-batch → exactly-once delivery verified (no loss, no duplicate rows).

---

## Sequencing & PRs

| PR | Scope | Repos | Depends on | Risk |
|----|-------|-------|-----------|------|
| 1 | Reconcile stale cloud audit docs (date-stamp, point to gap doc) | cloud | — | none |
| 2 | **G3a + G3b** — mod periodic stats emit + agent forward ✅ DONE 2026-06-02 | mod, agent | — | low |
| 3 | **G1 Phase 1** — persisted cursor + replay ✅ DONE 2026-06-02 | agent | — | med (cursor edge cases) |
| 4 | G3c — opt-in auto-**KICK only** (no ban/vouch) | cloud (+mod speed flag) | PR2 | low–med (default OFF; kick is reversible) |
| 5 | G1 Phase 2 — cloud ack exactly-once | cloud, agent | PR3 | **DEFERRED** (not this effort) |

**Recommended:** PR1 → PR2 (lights up the whole dormant detection/trust pipeline with the least code) →
PR3 → then PR4/PR5 as appetite allows. PR2 and PR3 are independent and can go in parallel.

## Build status

**PR2 (G3a + G3b) — IMPLEMENTED 2026-06-02.** Files changed:
- `dayz-mod/@CitadelAdmin/scripts/3_Game/CitadelEventLogger.c` — `LogPlayerStats(steamId, stats)` emits
  `type:"playerStats"` with cloud-aligned snake_case keys.
- `dayz-mod/@CitadelAdmin/scripts/3_Game/CitadelConfiguration.c` — `statsUpdateIntervalMs` (default 30000,
  floor 5000) + `GetStatsUpdateIntervalMs()`.
- `dayz-mod/@CitadelAdmin/scripts/4_World/CitadelPlayerTracker.c` — second `Timer` (`m_StatsTimer`) on the
  stats cadence → `EmitPlayerStats()` iterates active players (mirrors `UpdatePlayerData` keying), gated on
  `GetTrackPlayerStats()`.
- `backend/lib/cloud-bridge/forwarders.js` — `playerStats` case + `_emitPlayerStats()` → `player_stats_update`.
- `backend/tests/cloud-bridge-forwarders.test.js` — 4 unit tests (mapping, coercion, drop-on-no-steamId,
  mixed batch). **All pass.** eslint clean.

**Verified without a live server:** JS syntax + eslint + unit tests green; cloud confirmed to ingest
`player_stats_update` with **no cloud change** (`plugin-ws.routes.ts` post-auth path → `sinkPluginMessage`
→ `recordPlayerStats`, sink line 403; no strict schema to reject it).

**Still needs a live in-game smoke test** (mod `.c` can't compile outside the DayZ toolchain): deploy mod →
confirm `events.jsonl` gains `{"type":"playerStats",...}` lines every ~30s → confirm `plugin_player_stats`
rows populate → confirm `GET /telemetry/players/:steamId/summary` shows non-zero accuracy and the
`cheat-detection` accuracy rule can now fire.

**PR3 (G1 Phase 1) — IMPLEMENTED 2026-06-02.** Design note: rather than threading `send()`'s boolean
through the shared bridge cursor (which serves local dashboard consumers too), the cloud forwarder was given
its **own durable byte cursor** over events.jsonl — eliminating the shared-cursor double-send/conflict
problem. Files changed:
- `backend/lib/cloud-bridge/storage.js` — `cloudAckedOffset` per link with `getAckedOffset` / `setAckedOffset`
  (debounced 2s, `unref`'d) / `flushAckedOffsets`; cleared on `removeLink`.
- `backend/lib/citadel-bridge.js` — `readEventsFrom(offset)` (line-boundary + rotation safe) and
  `getEventsSize()`; plus a rotation guard in the live `_pollEvents`.
- `backend/lib/cloud-bridge/forwarders.js` — replaced the live `events` push with a self-owned tailer
  (`_eventsTimer` @1s + immediate tail on attach): `_resolveStartOffset()` (persisted/tail/rotation/cap) and
  `_tailEvents()` (advances + persists only while authenticated). `metrics`/`players` snapshots stay on the
  live push (nothing to replay).
- `backend/lib/cloud-bridge/supervisor.js` — `storage.flushAckedOffsets()` on `shutdownAll`.
- `backend/tests/cloud-bridge-replay.test.js` — 13 unit tests (readEventsFrom boundary/rotation/resume/EOF/
  missing; tailer advance/skip-when-unauthed/no-op; start-offset tail/resume/rotation/cap). **All pass.**

**Verified:** full backend suite green (29 suites, 328 passed, 0 failed); eslint clean. **Residual** (documented):
a batch the OS socket buffered but never delivered at a hard TCP drop is the only at-most-once loss window —
no duplicates, no whole-outage loss. **Needs a live check:** kill the cloud WS (or `taskkill` the backend)
for ~10 min under live kill/chat traffic and confirm the dashboard feeds backfill the gap on reconnect.

## Test plan
- **G3 unit:** mod — stats line shape matches contract keys; forwarder — `playerStats`→`player_stats_update`
  field copy. Cloud — `recordPlayerStats` insert; `runScan` flags a synthetic high-accuracy player.
- **G3 integration:** scripted bot with forced high `shotsHit/shotsFired` + headshots → `cheat_detections`
  row with readable `rules`; with `autoAction=kick`, a `command` kick dispatched.
- **G1:** offset persistence survives process restart; line-boundary safety with a partially-written final
  line; rotation reset; 10-min outage backfill with no dupes; bounded replay logs skipped older data.

## Locked decisions (2026-06-02)
1. **Auto-action = opt-in auto-KICK only.** Default OFF, per-server toggle. No auto-ban (kicks are
   reversible; auto-bans on desync false-positives are not). Threshold `autoKickScore` default ~90, tunable.
2. **No automatic vouch-pool submission.** Auto-actions stay local to the originating server. Pushing to the
   shared cross-server Cloud Bans pool always requires a human. (Highest-blast-radius path stays human-gated.)
3. **G1 = Phase 1 only this effort.** Agent-only at-least-once replay; no cloud protocol change. Phase 2
   (exactly-once cloud ack) deferred — revisit only if the single-boundary-batch residual proves to matter.

Still tunable later (not blocking): exact `autoKickScore` value, and the `speedCheckAutoKick` default.
