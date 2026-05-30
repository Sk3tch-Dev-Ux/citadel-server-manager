# Citadel vs. CF Architect — Ecosystem Cross-Reference & Upgrade Map

> Cross-reference of the **Citadel Agent** (this repo) against the **CF Architect** ecosystem
> deep-dive in `Architect_Ecosystem_DeepDive/`. Goal: find where Citadel lags and define the
> work to surpass Architect on every axis.
>
> Authored 2026-05-29. Claims about Citadel were verified against live code; the three
> load-bearing findings (no engine auto-tuning in repo, no DZSA publishing in repo, and the
> in-game-metrics local/cloud asymmetry) were verified directly.

## Headline

Citadel and Architect share the same four-tier shape: a host **Agent** that owns the
process/files, a **UI control plane**, an optional **Cloud** backbone, and the **DayZ
deployment**. Citadel is already ahead on several axes (2FA/TOTP, encrypted secrets at rest,
richer in-game admin actions, bidirectional cloud, reputation-weighted trust network, live
actionable map, metrics retention). Architect wins on a handful of engine-level "hosting
platform" disciplines: integrity/drift detection, engine auto-tuning, DZSA discovery, protocol
unification — and on **actually surfacing the in-game telemetry Citadel already collects.**

**Most important finding:** the `@CitadelAdmin` mod already produces GameLabs-equivalent
in-game metrics (`fps, ai_count, active_ai, animal_count, vehicle_count, entity_count,
tick_avg/low/high, event_count, uptime`). Citadel **forwards all of it to the cloud but
discards most of it locally** — `metrics-store.js` only persists `cpu, ram, players, fps`.
The hard part is built; the Agent side just isn't using it.

## Tier map

| Tier | CF Architect | Citadel | Verdict |
|------|-------------|---------|---------|
| Agent | Go daemon, single self-updating binary, Windows service | Node backend, NSSM service, no binary self-update | Parity; CF wins on self-update + single-binary |
| Control plane | Electron+Vue desktop, zero game logic, pure SMP1.0 client | React+Vite web SPA + Monaco + canvas charts + live map | **Citadel ahead** (web-native, live map) |
| Cloud | Proxy broker, priority API, curated catalog, DZSA | Bidirectional WS, trust-network bans w/ reputation, automations | **Citadel ahead** on protocol; CF ahead on catalog/priority/DZSA |
| Deployment | DayZ + 17 mods, engine auto-tuned | DayZ + mods, manual tuning | CF wins on auto-tuning |

## Where CF is genuinely ahead (the gaps)

### 1. In-game telemetry collected but discarded locally — highest value, lowest effort
- `metrics-store.js` schema is `cpu, ram, players, fps` only.
- `cloud-bridge/forwarders.js#_onMetrics` ships `ai_count, entity_count, vehicle_count, …`
  to cloud and explicitly notes the tick extras are *"we don't ship"*.
- Local charts/history can't show server-FPS health, entity-count creep, or tick-time spikes —
  the exact signals that predict a DayZ server dying.
- **Fix:** widen `server_metrics` + the local sampler to ingest the mod's full payload; add
  tick-time / entity-count to the dashboard.

### 2. No mod/build integrity snapshots or drift detection
- CF stores SHA-1 of every PBO and detects drift; enforces `verifySignatures=2` + `.bikey`.
- Citadel copies `.bikey`s but does no hashing, no drift detection, no game-build tracking.
- **Fix:** snapshot SHA-256 of installed addon PBOs after install; compare on start, flag drift.
  Track `DayZServer_x64.exe` build id and surface "game updated" like mod updates.

### 3. No engine auto-tuning
- CF detects host CPU and writes `dayzsetting.xml` `<jobsystem maxcores/reservedcores/…>`.
  Confirmed absent from the Citadel repo.
- **Fix:** on deploy, detect cores and write a sensible jobsystem block (with an
  "auto-adjusted, revise with care" comment for transparency).

### 4. No DZSA Launcher publishing
- CF publishes status + full mod list to DZSA every 60s — de-facto modded-DayZ discovery.
  Absent in Citadel.
- **Fix:** add a DZSA publish ticker (status + mod manifest) behind a per-server toggle.

### 5. No unified RPC protocol
- CF has one `SMP1.0` JSON-RPC envelope (`{action, parameters, idempotence}`) over one WS port;
  every capability is one scriptable, `whoami`-gated action.
- Citadel is dozens of bespoke REST routes + Socket.IO events. Works, but no single scriptable
  surface and permission checks are scattered.
- **Disposition:** do *not* rush. REST+Socket.IO is more web-native and OpenAPI auto-gen
  partly compensates. Long-term consolidation (an action-envelope facade), not a sprint.

### 6. Smaller items
- Agent self-update (CF swaps its own binary; Citadel relies on installer).
- fail2ban ban-time exposed as config (minor).
- Metrics retention — Citadel **wins** (30-day pruning vs CF unbounded). Keep it.

## Where Citadel is already ahead (don't regress)

- 2FA/TOTP with AES-256-GCM-encrypted secrets — CF has none.
- Encrypted credentials at rest (`ENC:` + PBKDF2 key separate from JWT) — CF stores
  RCON/priority keys plaintext (their own security doc flags it).
- 40+ in-game admin actions via the sidecar provider vs CF's RCON-centric control.
- Bidirectional cloud (cloud→agent command/config push); CF's agent is mostly a broker.
- Trust Network with reputation weighting; CF global bans are flat/unidirectional.
- Live player map with in-game actions; CF has a non-actionable globe.
- Metrics retention/downsampling; CF's DB grows unbounded.
- Provider abstraction (InHouse → LegacySDK → RCON fallback chain).

## Prioritized backlog

| Priority | Upgrade | Effort | Why |
|----------|---------|--------|-----|
| P0 | Ingest mod's full in-game metrics into the **local** store + charts (tick time, entity/AI/vehicle counts) | Low | Already collected & forwarded — near-free CF-parity win |
| P0 | Mod PBO **integrity snapshot + drift detection**; game-build version tracking | Medium | Prevents silent join-breaking failures |
| P1 | **Engine auto-tuning** (`dayzsetting.xml` jobsystem from host CPU) on deploy | Low-Med | Big perceived-performance win |
| P1 | **DZSA Launcher publishing** ticker (per-server toggle) | Medium | Player discovery gap |
| P2 | Finish **mod-side cloud-bans enforcement** (sync exists; mod doesn't yet kick on connect) | Medium | Closes a half-built trust loop |
| P2 | **Agent self-update** in place | Medium | Operational polish |
| P3 | Long-term: **action-envelope facade** over REST for a scriptable unified surface | High | Only if scripting becomes a customer ask |

## Implementation status (2026-05-29)

All P0–P2 items below were implemented and covered by tests in this pass.

- **P0 — In-game metrics ingested locally.** `metrics-store.js` schema widened
  (tick_avg/low/high, ai/active_ai/animal/vehicle/entity counts) with a migration
  for existing DBs; `pushMetrics`/`metrics-collector` thread the mod payload;
  history route + CSV export carry the new fields; `ServerMetricsPage` adds an
  "In-Game World" chart section. Tests: `metrics-store.test.js` (+ node:sqlite
  SQL validation).
- **P0 — Integrity + drift + build tracking.** New `integrity-engine.js` (SHA-256
  PBO fingerprints, drift/missing detection, installed-build id from the Steam
  appmanifest), wired into install/update/uninstall + on start (background) +
  `integrity.routes.js` + a Mods-page status bar. Tests: `integrity-engine.test.js`.
- **P1 — Engine auto-tuning.** New `engine-tuner.js` writes the dayzsetting.xml
  `<jobsystem>` block sized to host CPU on start (idempotent, opt-out via
  `engineAutoTune:false`), with preview/apply routes and a settings toggle.
  Tests: `engine-tuner.test.js`.
- **P1 — DZSA publishing.** New `dzsa-publisher.js` serves the mod list on
  `gamePort+10` (always-fresh, opt-in `dzsaPublish`), wired into lifecycle +
  status route + settings toggle. Tests: `dzsa-publisher.test.js`.
- **P2 — Cloud-bans mod enforcement.** Implemented the previously-undefined
  `CitadelBanManager` Enforce class (load/enforce-on-connect/persist) and made
  the agent write `$profile:Citadel/bans.json` (with reasons) from `ban-engine`.
  Tests: `ban-engine-profile.test.js`.
- **P2 — Assisted self-update.** New `agent-updater.js` downloads + verifies the
  signed installer from trusted hosts and launches it (interactive by default,
  silent opt-in) — safe middle ground vs. silent in-place swap. Routes added.
  Tests: `agent-updater.test.js`.
