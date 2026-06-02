# GLMetrics vs. Citadel — Mod & Cloud Cross-Reference & Opportunity Map

> Cross-reference of the **Citadel** stack (`@CitadelAdmin` mod + `DayzServerController` agent
> + `citadel-cloud`) against the **GLMetrics** mod (`glm.glogic.app`), reverse-engineered from
> its obfuscated PBO. Goal: find where the GLMetrics *in-game mod* is more self-sufficient /
> resilient than ours, and turn each gap into a concrete product opportunity.
>
> Authored 2026-06-02. All Citadel gap claims below were verified directly against current
> source (file:line cited per gap), not against the stale cloud-repo audit docs — see the
> **Documentation Drift** action item.

## How to use this doc

This is a **living reference**. Each gap (G1–G6) has a fixed ID, a `Status` line, evidence,
an **Opportunity** (how we benefit), and a **Plan**. Update the `Status` and the tracker table
at the bottom as work lands. Do not renumber gaps — add G7+ if new ones surface.

Status legend: `OPEN` · `PLANNED` · `IN PROGRESS` · `DONE` · `WONTFIX`

## Headline

Feature-for-feature, **Citadel is the larger, more capable product.** Our mod has more admin
actions (~40 vs ~30), richer per-player stats, and an entire server-ops layer GLMetrics lacks
(lifecycle/crash recovery, RCON, PBO integrity, engine tuning, backups, Workshop mgmt, Discord,
cross-server identity, trust + cloud-ban reputation). GLMetrics is a *narrow* in-game
telemetry+action mod.

**The "GLMetrics feels more robust" perception is real but localized: their in-game mod is
self-sufficient on the wire, and ours is not.** GLMetrics POSTs directly to a REST API with a
multi-endpoint **shard failover** list and **buffers killfeed locally to replay on reconnect**.
Ours is a "dumb writer": the mod writes JSON files, and a four-link chain
(`mod → sidecar → backend → cloud WS`) carries it onward — with **no replay** if a link breaks.
That single asymmetry is the source of every load-bearing gap below.

## Axis comparison

| Axis | GLMetrics | Citadel | Verdict |
|------|-----------|---------|---------|
| In-game admin actions | ~30, entity-taxonomy organized | ~40, incl. godmode/invis/stamina/disease | **Citadel ahead** |
| Per-player stats / aimbot signal | live player damages | accuracy (shots fired/hit) — *richer* | **Citadel ahead on data, behind on timing** (G3) |
| Mod→cloud transport | direct REST POST | file → sidecar → backend → WS | **GLMetrics ahead** (G2) |
| Endpoint resilience | shard test + auto-failover | single WS, drop-on-disconnect | **GLMetrics ahead** (G1) |
| Offline durability | local killfeed buffer + replay | on-disk jsonl, **no cloud backfill** | **GLMetrics ahead** (G1) |
| Anti-cheat pipeline | dedicated `/cheat/alert` | speedFlag audit-only, magic-bullet stub | **GLMetrics ahead** (G3) |
| Economy/loot/spawnable telemetry | posts `cfg` + `spawnables` | edits locally, **cloud doesn't ingest** | **GLMetrics ahead** (G4) |
| Tamper / repack protection | repack-disable (`IsInCommandLine`) | `.bikey` signature only | **GLMetrics ahead** (G5) |
| Server ops (lifecycle/RCON/integrity/backups/Discord/trust) | none | full | **Citadel far ahead** |

---

## Gap register

### G1 — No durable cloud delivery / replay across an outage
- **Status:** OPEN · **Priority:** HIGH · **Effort:** Low–Med
- **Evidence:**
  - `backend/lib/cloud-bridge/ws-client.js:96` — sends are **dropped** when the socket is down
    (`'cloud-ws: drop send — not connected'`). Reconnect (1s→30s backoff,
    `ws-client.js:45-46`) restores the *socket* but not the *missed messages*.
  - `backend/lib/citadel-bridge.js:155-159` — the events.jsonl read cursor (`_eventsFileSize`)
    is **in-memory only**; on a fresh read it seeks to `size − 64KB`, so a backend restart or
    cloud outage **permanently skips** everything written during the gap.
- **GLMetrics:** `KillfeedLocalStore` persists unsent killfeed; `ApiConnection.SetBlockConnections(false)`
  flushes saved data on reconnect (`PostSavedData()`). At-least-once delivery for killfeed.
- **The gap:** During any cloud/bridge interruption, Citadel telemetry that already exists on
  disk is never backfilled to the cloud. Dashboards show holes; kill/chat forensics have gaps
  exactly when they matter (a crash or attack often coincides).
- **Opportunity / how we benefit:** "Zero-loss telemetry" is a real differentiator and a trust
  signal for paying operators. It also makes cheat forensics defensible (no missing windows).
- **Plan:**
  1. Persist a durable `cloudAckedOffset` per server (where the cloud last confirmed receipt of
     events.jsonl bytes) in `data/plugin-servers.json` or a sibling state file.
  2. On WS (re)connect, replay events.jsonl from `cloudAckedOffset` forward before resuming live.
  3. Have the cloud ack ingested byte ranges (extend the plugin WS protocol with an `ack`
     frame, or piggyback on existing responses) and advance the offset only on ack.
  4. Bound replay (e.g. last N MB / 24h) so a long outage can't flood on reconnect; log what was
     dropped (no silent truncation).
- **Acceptance:** kill the cloud WS for 10 min under live traffic → on reconnect, the dashboard
  kill/chat/metrics feeds backfill the missing window with no duplicates.

### G2 — Mod can't reach the network; the bridge is a single point of failure
- **Status:** OPEN · **Priority:** HIGH · **Effort:** Med–High
- **Evidence:** Mod writes only to `$profile:Citadel/*` (`CitadelReporter.c`, `CitadelMetricsTracker.c`,
  `CitadelPlayerTracker.c`, `CitadelEventLogger.c`); all egress depends on `sidecar/server.js`
  + `backend/lib/cloud-bridge/*` being alive. No network capability in the mod.
- **GLMetrics:** mod owns its own `RestContext` and POSTs directly (`ApiConnection.c`), with
  shard failover — independent of any host-side agent.
- **The gap:** "DayZ up, bridge down" = total blackout (no telemetry **and** no remote control)
  while the game server runs fine. This is the architectural root of the "less robust" feeling.
- **Opportunity / how we benefit:** Survivability decouples our observability from our own
  agent's uptime — fewer "why is my server dark?" tickets, and a stronger resilience story vs
  competitors. Also unlocks a future **lite/cloud-only tier** (mod + cloud, no full agent).
- **Plan (pick one, smallest first):**
  - **2a (min):** Make the bridge crash-tolerant — supervise sidecar+backend, auto-restart, and
    rely on G1 replay so a bounce loses nothing. Cheapest; closes most of the real risk.
  - **2b (mid):** Mod → sidecar over **localhost HTTP** instead of file polling (lower latency,
    explicit liveness), still agent-mediated.
  - **2c (max):** Optional **direct mod→cloud REST fallback** (mod gets its own key + endpoint),
    used only when the agent is unreachable. Closest to GLMetrics; biggest lift (key mgmt,
    DayZ `RestApi` constraints, auth).
- **Acceptance:** define target first (2a recommended). For 2a: `taskkill` the backend during
  live play → on relaunch, telemetry resumes and backfills with no operator action.

### G3 — Anti-cheat is half-built and emits too late to act
- **Status:** OPEN · **Priority:** HIGH · **Effort:** Low (data already collected)
- **Evidence:**
  - Mod emits `player_stats_update` (shots_fired/shots_hit accuracy) **only on disconnect**
    (cloud `MOD_AUDIT.md` §1; mod `CitadelClasses.c` stats flushed in session event on
    `PlayerDisconnected`).
  - Speed-hack is **audit-only** — logs a `speedFlag` event, no auto-action
    (`scripts/4_World/hooks/CitadelPlayerHooks.c`).
  - Magic-bullet is a **config flag with no logic** (`enableMagicBulletCheck` /
    `enableMagicBulletInvalidation` in `scripts/3_Game/CitadelConfiguration.c`).
  - Cloud already stores the richest signal: `plugin_player_stats`, `plugin_kills`
    (distance, hit_zone, is_headshot).
- **GLMetrics:** first-class `/v1/cheat/alert` endpoint as a dedicated stream.
- **The gap:** We *collect a stronger aimbot signal than GLMetrics* (accuracy + headshot ratio +
  impossible-distance) but ship it too late and never act on it. The platform's best
  differentiator (transparent, evidence-based detection feeding the trust network) is dormant.
- **Opportunity / how we benefit:** This is the flagship feature. Live accuracy + headshot-ratio
  + LOS-cross-check (we have positions!) → real-time cheat flags → auto-kick/ban → feed the
  **cloud-ban vouch pool**. That loop is something GLMetrics *cannot* match (it has no trust
  network). Turning G3 on weaponizes data we already pay to collect.
- **Plan:**
  1. Mod: emit `player_stats_update` periodically (~30s) in addition to on-disconnect.
  2. Cloud: compute rolling per-player signals (accuracy z-score, headshot ratio, kill-distance
     outliers) in the telemetry sink / a worker; raise a `cheat_detection` with confidence +
     human-readable reasons (keep it transparent, not a black box).
  3. Wire an action policy: flag → notify → optional auto-kick via existing command dispatch →
     optional submission to cloud-ban pool.
  4. Implement speed-hack auto-action behind a config toggle (reuse `speedFlag`).
- **Acceptance:** a scripted high-accuracy/headshot test player gets flagged live (not on
  disconnect) with a readable reason, and the configured action fires.

### G4 — Economy / loot / spawnables not surfaced to the cloud
- **Status:** OPEN · **Priority:** MED · **Effort:** Med
- **Evidence:** Cloud audit §6 lists economy/loot as **not ingested**. Agent edits economy
  files locally via Monaco (`backend/lib/dayz-config.js`, config routes) but nothing forwards
  spawnable/loot/economy data to `citadel-cloud`.
- **GLMetrics:** posts `/v1/server/cfg` and `/v1/server/spawnables` — economy analytics surface.
- **The gap:** No loot heatmaps, no economy/spawnable dashboards, no cross-server economy
  comparison — a whole analytics category GLMetrics ships and we don't.
- **Opportunity / how we benefit:** Economy analytics (loot density, spawn distribution, central
  economy health) is a premium dashboard category and a natural Cloud upsell. We already parse
  these files locally; we just don't surface them.
- **Plan:**
  1. Agent: on deploy/edit, forward parsed `cfgspawnabletypes.xml` / `cfgeconomycore.xml` /
     `types.xml` summaries to cloud (new plugin message or REST).
  2. Cloud: new ingest endpoint + schema (`plugin_economy_*`); dashboard widgets.
  3. Optionally enrich with the mod's live entity counts for spawned-vs-configured drift.
- **Acceptance:** editing `types.xml` reflects updated spawnable analytics in the cloud dashboard.

### G5 — No mod tamper / repack protection
- **Status:** OPEN · **Priority:** MED · **Effort:** Low–Med
- **Evidence:** Only protection is the standard DayZ `.bikey` signature
  (`dayz-mod/@CitadelAdmin/README.js:23`) — which gates *clients loading unsigned mods*, not
  *the mod being ripped and run elsewhere*. No runtime repack/commandline check.
- **GLMetrics:** disables functionality if the PBO is repacked (`IsInCommandLine` guard
  throughout `ApiConnection.c` / chat handler) — licensing protection.
- **The gap:** `@CitadelAdmin`'s 40-action admin toolkit (godmode, spawn, teleport, wipe) would
  function if someone ripped the PBO and ran it standalone. Cloud features are still gated by
  API key + subscription at the agent layer, so the *cloud* isn't exposed — but the in-game
  power tools are.
- **Opportunity / how we benefit:** Protects the paid product from freeloading and protects our
  brand from a leaked "admin cheat menu." Low effort relative to reputational downside.
- **Plan:**
  1. Add a lightweight runtime guard the mod checks at init (e.g. presence of an agent-written
     signed token in `$profile:Citadel/`, or a startup-param/commandline check à la GLMetrics).
  2. If absent/invalid, disable admin actions (keep it fail-safe, not server-bricking).
  3. Pair with cloud-side attestation so a valid token can only come from a licensed agent.
- **Acceptance:** running the PBO without a valid agent token leaves telemetry harmless but
  disables god-mode/spawn/teleport actions.

### G6 — Endpoint/secret agility at the mod layer (informational)
- **Status:** OPEN · **Priority:** LOW · **Effort:** n/a (model difference)
- **Evidence:** GLMetrics supports live secret rotation pushed to the mod (`UpdateSecretKey`
  endpoint) + best-connection shard selection. Citadel rotates keys at the agent/cloud layer
  (`plugin-servers/:id/rotate`), which is appropriate for the file-IPC model.
- **The gap:** None that matters today — logged for completeness so we don't "rediscover" it.
- **Opportunity:** Only relevant if we pursue G2c (direct mod→cloud), which would need mod-layer
  key rotation. Revisit then.

---

## Action item — Documentation Drift (do this first)

The two repos disagree about whether mod-side enforcement is wired:
- `citadel-cloud`: `MOD_AUDIT.md` / `CITADEL_AGENT_ALIGNMENT.md` say command handlers,
  cloud-ban enforcement, and config-module enforcement are **NOT wired on the mod**.
- `DayzServerController`: `Citadel_vs_Architect_GapAnalysis.md` + `RELEASE_NOTES_v2.20.0.md`
  say these were **completed in v2.20.0** — and the mod source confirms it
  (`CitadelCommandRunner.c`, `CitadelBanManager.c`, `CitadelServerConfig.c`).
- **Conclusion:** the cloud-repo audit docs are **stale**. Anyone reading them will "find" gaps
  that are already closed.
- **Fix:** update / date-stamp the cloud-repo docs to reflect v2.20.0 mod completion, and add a
  pointer to this file as the current GLMetrics cross-reference.
- **✅ RESOLVED 2026-06-02.** Reconciliation banners added to the top of `citadel-cloud/MOD_AUDIT.md` and
  `citadel-cloud/CITADEL_AGENT_ALIGNMENT.md` pointing here as the current source of truth.

## Where Citadel already leads GLMetrics (don't over-rotate)

Server lifecycle + crash recovery (circuit breakers, backoff) · BattlEye RCON · PBO integrity &
drift detection · engine auto-tuning · backups · Workshop mod management · DZSA publishing ·
Discord bot (18+ commands) · cross-server **Citadel ID** identity graph · **trust score** +
**cloud-ban vouch reputation** · far more player actions · richer session stats. GLMetrics has
none of this. We are not behind on capability — only on **in-game transport resilience and live
anti-cheat timing.**

## Prioritized roadmap

| # | Gap | Priority | Effort | Status | Notes |
|---|-----|----------|--------|--------|-------|
| G1 | Durable cloud delivery / replay | HIGH | Low–Med | IN PROGRESS | **Phase 1 implemented (PR3, 2026-06-02)** — durable per-server events cursor + replay-on-reconnect; needs live outage test. Phase 2 (exactly-once ack) deferred. See plan doc |
| G3 | Live anti-cheat (periodic stats + alert pipeline) | HIGH | Low | IN PROGRESS | **G3a+G3b implemented (PR2, 2026-06-02)** — mod emits periodic stats + agent forwards; needs live smoke test. G3c (opt-in auto-kick) pending. See plan doc |
| G2 | Bridge SPOF / mod self-sufficiency | HIGH | Med–High | OPEN | Start with 2a (supervised + replay) |
| G4 | Economy/loot/spawnable telemetry | MED | Med | OPEN | New premium analytics surface |
| G5 | Mod tamper/repack guard | MED | Low–Med | OPEN | Licensing + brand protection |
| G6 | Mod-layer secret/endpoint agility | LOW | n/a | OPEN | Only if G2c is pursued |
| — | Reconcile stale cloud-repo audit docs | — | Low | ✅ DONE | Banners added to `MOD_AUDIT.md` + `CITADEL_AGENT_ALIGNMENT.md` (2026-06-02) |

**Recommended order:** Doc-drift cleanup → **G1 + G3 together** (highest value, lowest effort,
shared plumbing) → G2a → G4 → G5.

## Status log

- 2026-06-02 — Doc created. All gaps OPEN. Verified G1 (ws-client.js:96, citadel-bridge.js:155),
  G2, G5 (README.js:23) against current source; G3/G4 against cloud audit + mod source.
- 2026-06-02 — G1+G3 promoted to PLANNED. Wrote `GLMetrics_Gap_G1_G3_ImplementationPlan.md`.
  Key finding: the cloud-side G3 pipeline already exists and is idle (`player_stats_update` type,
  `recordPlayerStats`, `plugin_player_stats`, `cheat-detection.ts runScan`, `ops-sweep`, `trust-score`) —
  starved because the mod only emits stats on disconnect. G3 reduces to mod periodic emit + agent forward.
- 2026-06-02 — Scope decisions locked: (1) auto-action = opt-in auto-KICK only, default OFF, no auto-ban;
  (2) no automatic vouch-pool submission (cross-server propagation stays human-gated); (3) G1 = Phase 1 only,
  Phase 2 exactly-once deferred. Plan doc updated accordingly.
- 2026-06-02 — **PR2 shipped (G3a+G3b).** Mod now emits `playerStats` every ~30s (`CitadelEventLogger`,
  `CitadelConfiguration`, `CitadelPlayerTracker`); agent forwards `player_stats_update`
  (`cloud-bridge/forwarders.js` + new jest test, 4/4 pass, eslint clean). Cloud unchanged (already ingests).
  Lights up the dormant `cheat-detection`/`trust-score` accuracy signal. Pending: live in-game smoke test.
- 2026-06-02 — **PR3 shipped (G1 Phase 1).** Cloud forwarder now owns a durable per-server byte cursor over
  events.jsonl (`storage.cloudAckedOffset` + `citadel-bridge.readEventsFrom` + a self-owned tailer in
  `forwarders.js`), so kill/chat/death/connect/playerStats survive backend restarts and cloud outages and
  backfill on reconnect. 13 new unit tests; full backend suite green (328 passed, 0 failed); eslint clean.
  Pending: live ~10-min outage backfill check. Phase 2 (exactly-once ack) deferred per locked decision.
