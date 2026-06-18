# Changelog

All notable changes to Citadel are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Cloud telemetry: filter actions, world events & vehicle snapshots.** The
  cloud-bridge now forwards three telemetry streams the cloud persists but the
  agent was silently dropping. `filterAction` (chat/name filter hits) maps to
  the cloud's `filter_action` frame, so the cloud's enforcement log and
  per-event webhooks finally fire. `dynamicEvent` spawns (helicrashes,
  contaminated zones, convoys, …) map to the cloud's `event` frame with a
  best-effort `event_type` classification (two limitations owed to a mod-side
  follow-up: `despawn` has no cloud representation, so only spawns forward, and
  the mod emits no event lifetime so `ttl` ships as 0). The mod's existing
  `vehicles.json` snapshot (already written by `CitadelReporter`, already
  watched by the bridge) is now forwarded as the cloud's `vehicles` frame, so
  the Live Ops map vehicle layer finally has a data source from the desktop
  agent — no mod change was needed, only the missing forwarder subscription.
- **Cloud link privacy & safety controls.** Each cloud-linked server now has
  two operator toggles on its Cloud card:
  - *Forward player IP & GUID to Cloud* (on by default) — turn it off to keep
    player IPs/GUIDs on your machine; Cloud's VPN/Geo checks then simply skip.
  - *Allow remote world-wipe* (off by default) — Cloud can only wipe AI/
    vehicles on a server you've explicitly opted in, so a leaked Cloud key
    can't wipe your world. Restart and player moderation are unaffected.
  The settings survive a re-pair and the choice is recorded in the audit log.

### Security
- Cloud-issued world-wipe commands are now denied by default (opt-in per
  server) as defense-in-depth against a replayed or compromised cloud key.

### Internal
- **Cloud-bridge protocol drift guard.** Added `cloud-bridge-protocol-contract.test.js`,
  which pins the cloud wire contract (`CommandAction`, `config_type`, and the
  `PluginToCloudMessage` telemetry union from citadel-cloud's `plugin.ts`) and
  asserts the hand-ported JS mirror still covers it — every inbound command and
  config type is handled, and every mod event maps to its cloud frame. Since the
  two repos don't share a build, this converts silent drift (a cloud-side rename
  or new action) into a loud, reviewable test failure. Every `PluginToCloudMessage`
  telemetry type now has an agent source or is explicitly documented as
  intentionally-unused in cloud v1 (`world_events`, `schedule_executed`).
- **Playwright E2E harness.** Added `@playwright/test` as a dev dependency with
  a root `playwright.config.js` and an initial `e2e/smoke.spec.js` (app-shell +
  login-surface smoke tests) — the frontend previously had no automated tests.
  Run with `npm run test:e2e` (setup: `npm install && npx playwright install`).
- **Design skill toolchain.** Added `setup-skills.ps1` to install the shared
  AI design/UX skills (impeccable, ui-ux-pro-max, taste-skill, huashu-design)
  globally and the graphify code-graph tool, for dashboard UI work.

## v2.25.0 — 2026-06-11

### Added
- **Ban list sync to Citadel Cloud.** The agent now pushes its global ban
  database to the cloud (on connect and, debounced, on every change) so the
  new cloud Ban Manager can list bans and unban remotely. Snapshots are
  capped at 2,000 entries per frame and field-truncated to stay within the
  cloud's WS frame and database limits; larger lists log a truncation notice
  (chunked transfer for huge imports is a planned follow-up).
- **Cloud admin actions reach the mod correctly.** The cloud→agent command
  bridge now translates the cloud's wire vocabulary to what the @CitadelAdmin
  mod actually reads — `class_name`/`className` → `itemClass` for item spawns,
  and weather `preset` (clear/overcast/rain/storm) → the mod's numeric
  overcast/rain/fog — so teleport, spawn-item, set-time, and set-weather from
  Live Ops work for any caller, not just the dashboard.

## v2.24.2 — 2026-06-11

### Fixed
- **Self-update left the desktop app on the old version.** The auto-updater
  scheduled `app.relaunch()` before invoking the installer — but Electron
  relaunches the instant the app exits, i.e. *before* the elevated NSIS
  installer copies files. The relaunched old build held
  `<install>\desktop\*` locked, and because that copy step uses
  `File /nonfatal`, the installer silently skipped the locked files: the
  agent updated, the desktop app didn't, and the "update ready" banner
  reappeared forever. Three-part fix: the installer now closes any running
  `Citadel.exe` before copying (this also heals updates **from** older
  versions, whose updater still relaunches early — the new installer is the
  downloaded artifact), the installer relaunches the new desktop build at
  the end of silent installs (de-elevated via explorer.exe), and the
  premature `app.relaunch()` is removed for future versions.

---

## v2.24.1 — 2026-06-11

RCON out of the box: the agent now provisions BattlEye RCON automatically,
which is what makes reason-visible kicks and ban messages actually work.

### Added
- **RCON is now configured automatically for every server.** On server start
  the agent ensures `battleye\BEServer_x64.cfg` exists and matches the
  dashboard: a missing RCON password is generated (or adopted from an
  operator-managed cfg) and persisted, drifted cfg files are updated with
  operator lines preserved, and stale `beserver_x64_active_*.cfg` copies are
  removed. This makes reason-visible kicks and ban messages work out of the
  box — previously RCON required manual BattlEye config, and without it those
  features silently degraded to the engine's generic text.

### Fixed
- **Deploy scaffold wrote the BattlEye config where the server never reads
  it** (`profiles\BattlEye\beserver.cfg` — the x64 server reads
  `battleye\BEServer_x64.cfg`), and wrote an empty `RConPassword` when none
  was supplied, which BattlEye treats as RCON-disabled. The scaffold now
  writes the correct path and only pre-seeds when a password was provided;
  the start-time auto-config covers the rest.

---

## v2.24.0 — 2026-06-11

In-game observability (FPS band, weather, world clock), durable cloud bans
with visible kick reasons, ban management UI, and a night of pipeline
hardening caught by live end-to-end testing before release.

### Added
- **Ban management UI.** The Players page now has a Bans panel listing the
  global ban database (player, Steam ID, reason, when, by whom) with one-click
  **Unban** — the API existed since the global ban DB shipped, but there was
  no way to unban from the dashboard at all.
- **Cloud `unban` command.** Citadel Cloud's Live Ops can now unban a Steam ID
  remotely; the agent resolves it against its ban database (the player is
  typically offline) and re-syncs ban.txt + mod enforcement on every server.
- **Cloud `ban` is now durable, and kicks show their reason.** A cloud ban
  previously mapped to a kick only — the player saw no message and could
  reconnect immediately. Bans now run the agent's full ban engine (global ban
  DB, ban.txt sync, RCON kick with the configured appeal message), and cloud
  kicks prefer BattlEye RCON so the reason appears on the player's disconnect
  screen (mod IPC fallback when RCON is unavailable). Note: custom kick/ban
  messages require RCON to be configured (BEServer_x64.cfg + the server's
  RCON password in settings) — the engine's mod-side path can only show the
  generic message.
- **Richer server telemetry from the @CitadelAdmin mod** (techniques adapted
  from studying the MetricZ observability mod — no code shared). The mod's
  `metrics.json` now also reports FPS window min/max over each collection
  interval (so dips between 15s samples are no longer invisible), weather
  (rain, fog, cloud cover, snowfall, wind speed), and the in-game clock.
  The new fields flow through the sidecar into the dashboard metrics socket
  and are persisted to `metrics.db` (schema migrates automatically) for
  historical charts — e.g. correlating FPS dips with night time or weather.
- **Server Metrics page: FPS band + Environment section.** The FPS chart now
  renders a min/max envelope showing dips between 15s samples, and a new
  Environment section (shown once the v2.24+ mod reports) adds in-game clock,
  rain/fog/cloud/wind stat cards and charts — with a snow chart that appears
  only when it's actually snowing. New columns are included in the CSV export,
  and charts now show correct units (FPS and entity counts no longer display
  as percentages).

### Changed
- **`metrics.json` is now written atomically and engine-serialized.** The mod
  previously streamed hand-concatenated JSON straight into the final file, so
  the sidecar or cloud client could read a torn, half-written snapshot. It now
  serializes a DTO via `JsonFileLoader` to a `.tmp` file and copies it over
  the destination in one engine call. PBO repacked and re-signed.

### Fixed
- **Sidecar crash-loop on installed builds starved both dashboards of all
  in-game data** (players, FPS, entities, live map). The sidecar's logger
  requested the `pino-pretty` transport whenever `NODE_ENV` wasn't
  `production` — but the agent spawns the sidecar without setting it, and
  pino-pretty is a devDependency absent from installs, so the sidecar died at
  require time and was respawned every 15s forever. The logger now falls back
  to plain JSON when pino-pretty isn't resolvable, and `sidecar-manager`
  defaults the sidecar env to production.
- **Server FPS could overflow the cloud's fps×100 smallint.** Idle dedicated
  servers run the sim loop uncapped (sub-millisecond tick averages), so the
  derived FPS reached four digits (and the mod's raw counter reads in the
  millions). The sidecar now clamps reported FPS to 300 — pinned-at-cap means
  idle/healthy; the value becomes meaningful under load.
- **@CitadelAdmin mod failed to compile at server boot** (`Expected name, not
  a keyword 'out'`). The cloud direct-mode additions used `out` — a reserved
  Enforce Script keyword — as a local variable name in
  `CitadelEventLogger.DrainDirectBuffer()` and two `CitadelCloudClient`
  helpers, so any server launched with the mod refused to start. Renamed to
  `result` in all three places; PBO repacked and re-signed.
- **Sidecar crash-looped on servers without an API key.** Production mode
  (now the default sidecar env) requires `SIDECAR_API_KEY`, but the backend
  only passed one when the server already had `inHouseApiKey` configured —
  locally created servers don't, so the sidecar exited at startup and was
  respawned every 15s, blacking out all in-game telemetry. The backend now
  generates and persists a per-server key on first sidecar start.
- **Live metrics sections flickered every 10–15 seconds.** The live
  dashboard re-fetches `GET /metrics` every 10s, but the endpoint's rolling
  window only held cpu/ram/players/fps — the in-game series rode only the
  socket events, so each poll wiped them until the next 15s tick. The full
  sample is now kept in the rolling window.
- **Every player-targeted Live Ops action failed with "Missing required
  param: steamId".** The cloud sends snake_case command params
  (`steam_id`); the agent required camelCase. The agent now normalizes both
  conventions on receipt.
- **Loot barrels and sea chests appeared as world events / map markers.**
  The map-marker config shipped SeaChest/Barrel demo entries as its
  defaults, marking every storage container on the server. Defaults are now
  an empty opt-in list (existing `MapMarkers.json` files keep whatever the
  operator configured).
- **Auto-created RCON firewall rule used TCP** — BattlEye RCon is UDP. Only
  affected external RCON tools; the agent connects over loopback.

### Removed
- **Repo tidy-up (no runtime impact).** Removed from the source tree (all
  recoverable from git history): the deprecated in-repo `discord-bot/` (the bot
  lives in the standalone [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot)
  repo; the Agent's `/api/discord/*` surface is unchanged, and the legacy
  `CITADEL_AGENT_SPAWN_BOT=1` flag now logs and skips), the legacy `Scripts/`
  CommandRelay mod + PBO packer (superseded by the sidecar + @CitadelAdmin
  bridge), the empty `@GameLabs/` placeholder, and the root-level planning /
  gap-analysis documents and archives. README and CLAUDE.md updated to match.

---

## v2.23.0 — 2026-06-10

Public-launch hardening: HTTPS enforcement, a faster mod bridge, lower
real-time bandwidth, and crash-proof async error handling.

### Added
- **Enforce HTTPS for public deployments.** New `server.requireHttps`
  config option (env `REQUIRE_HTTPS`) makes the agent refuse to start without
  valid TLS certificates in `./cert`. Independently, binding to all interfaces
  (`0.0.0.0` / `::`) over plaintext HTTP is now refused unless
  `ALLOW_INSECURE_BIND=1` is set. Loopback HTTP (dev default, or behind a
  local TLS-terminating proxy) is unaffected.
- **`generate-cert.ps1` + `TLS_SETUP.md`.** Helper to generate a self-signed
  certificate for local/LAN HTTPS, plus documentation for self-signed and
  production (reverse-proxy / CA cert) setups.

### Changed
- **Mod bridge moved from polling to `fs.watch`.** `CitadelBridge` no longer
  busy-polls: in-game commands resolve via a watch on the responses directory
  (near-instant, was a 200ms poll floor) and the live data files (players,
  metrics, vehicles, world events) are re-read on change with async I/O
  instead of synchronous reads every 2s. A slow fallback interval remains as a
  safety net. No change to the dashboard event contract.
- **Socket.IO bandwidth.** Enabled per-message compression for larger frames
  (player lists, metrics, log bursts). All server→client emits now route
  through `ctx.emitServer()` / `ctx.emitGlobal()` — behaviour is unchanged
  today, but this is the seam for scoping high-volume events to per-server
  rooms.

### Fixed
- **Async route errors can no longer hang a request.** Added
  `lib/async-routes.js`, which wraps every route handler/middleware so a
  rejected promise is forwarded to the global error handler instead of
  becoming an unhandled rejection. Added a `res.headersSent` guard so a late
  error cannot double-send a response.

### Security
- **Removed shell string-interpolation in the backup disk-space check.**
  `backup-engine` now uses `execFileSync` with a validated drive letter rather
  than building a `powershell -Command` string, eliminating the last
  shell-parsing surface in that path.
- **Dependency vulnerability fixes (`npm audit`).** Backend: all
  high-severity advisories resolved via semver-compatible updates (including
  path-to-regexp ReDoS and socket.io-parser unbounded binary attachments);
  full test suite re-verified. Frontend: all high-severity advisories
  resolved. Root: `concurrently` bumped to v10 (dev-only) — zero remaining
  advisories at root. Desktop: Electron 34 → 42 and electron-builder 25 → 26
  (clears 11 high-severity advisories in the Electron runtime and the `tar`
  build chain; electron-updater bumped to 6.8.9) — zero remaining advisories
  in the desktop tree. NSIS build and app launch re-verified on Electron 42.

---
## v2.22.2 — 2026-06-03

Mod-update reliability and a fix for the self-update loop.

### Fixed
- **In-app / desktop auto-update loop.** electron-updater's silent install
  spawns `<install>/desktop/resources/elevate.exe` to elevate the per-machine
  NSIS install, but the build ran `electron-builder --dir`, which never emits
  that helper — so `quitAndInstall` died with `spawn elevate.exe ENOENT`, the
  app relaunched on the old version, and re-detected the same update forever.
  The desktop build now runs the full nsis target (`--publish never`), which
  includes `elevate.exe`, and the installer build hard-fails if it's missing.
- **Service not stopped before self-update.** The desktop updater called bare
  `nssm stop`, but nssm.exe lives at `<install>/runtime/nssm.exe` and isn't on
  PATH, so the service kept files locked during install. It now resolves the
  real nssm path from the install directory.
- **Mods silently not updating.** Three causes: (1) `_updateWorkshopModImpl`
  reported success whenever *any* existing content was found on disk, so a
  SteamCMD login timeout or an already-cached manifest looked like a successful
  update while nothing changed — it now compares a before/after fingerprint
  (content mtime + `appworkshop_<appid>.acf` manifest) and the explicit
  `Success. Downloaded item` marker, and reports an actionable error when
  nothing was actually fetched; (2) the install path called `getCached()`
  without the Workshop `time_updated`, so a newer version never invalidated the
  cache — it's now passed through; (3) the update path had no retry, so transient
  SteamCMD login timeouts weren't recovered — it now retries with backoff like
  the download path (skipping auth failures).

---

## v2.22.1 — 2026-06-03

Live-operation fixes found while validating a real server install.

### Fixed
- **Dashboard login lockout.** The brute-force login limiter was applied to the
  entire `/api/auth/*` surface — including the session check the dashboard
  makes on every page load — so a few reloads returned HTTP 429, which the UI
  read as an expired session and logged the operator out, then blocked
  re-login with "too many requests". The strict limiter now covers only
  `POST /api/auth/login`, counts failed attempts only (`skipSuccessfulRequests`),
  and allows 30 per 15 min; fail2ban remains the primary brute-force defense.
- **serverDZ.cfg edits not persisting.** `writeServerConfig` silently dropped
  changes three ways: keys outside an over-narrow allowlist were rejected; a
  *new* key whose value was `0`/`false`/`""` was skipped (so e.g.
  `disableVoN = 0` never wrote); and the in-place regex required a trailing `;`
  and overwrote inline comments. All three fixed and the allowlist expanded
  (`enableCfgGameplayFile`, `disableBaseDamage`, `maxPing`, network-tuning keys,
  …). Regression-tested.
- **Firewall rules never created under the Windows Service.** Rules were created
  via UAC elevation (`Start-Process -Verb RunAs`), which cannot work from the
  non-interactive SYSTEM service — so DayZ ports were never opened and servers
  were invisible online and to other LAN machines. The failure was also
  swallowed (fire-and-forget). In service mode the Agent now creates rules
  directly (SYSTEM is already privileged) and logs the outcome per port.
- **Sidecar missing from installed builds.** The installer never staged the
  `sidecar/` folder, so the per-server IPC bridge to the @CitadelAdmin mod
  (live map, admin actions, killfeed) exited code 1 on every server start. The
  installer now stages `sidecar/` and installs its production dependencies.

---

## v2.22.0 — 2026-06-03

Production-readiness hardening pass ahead of public signups. Full-stack audit
(33 agents, 10 dimensions) with adversarial verification of every finding.

### Security
- **`GET /api/servers` no longer returns the sidecar `inHouseApiKey`** (full
  game-server admin capability) or other secret fields to non-admin panel
  users. POST/PATCH responses share the same redaction set.
- **BattlEye/serverDZ passwords are masked in file-browser reads** of
  `.cfg`/`.config` files (`RConPassword`, `password`, `passwordAdmin`). The
  config editor can still change them — a saved-back masked value is restored
  from disk, a new value is kept.
- Cloud-bridge admin endpoints now require the real `users.manage` permission
  (previous guard never matched, falling through to wildcard-only access).

### Fixed
- **In-dashboard self-update works again** — the cloud's relative download
  URL is resolved against the API base, and the extension-less
  `/downloads/installer` path passes the allowlist (MZ-header/size/signature
  checks unchanged).
- **Cloud Bans and telemetry now talk to `api.citadels.cc`** instead of the
  apex marketing site — Cloud Bans sync was silently dead on default installs.
- **Expired-but-genuine license tokens enter the offline grace window at
  boot** instead of being cleared as invalid, and license verification
  tolerates 5 minutes of client-clock drift — no more spurious de-activations
  after a PC has been off past token expiry.
- **Port conflicts produce an actionable error** (which port, what to do)
  instead of an unhandled-exception crash; in service mode the diagnostic
  page is served on a fallback port.
- Cloud-bridge: `auth_error` close reasons from the cloud are surfaced
  verbatim in the UI; a 4002 protocol-violation close stops reconnecting
  (like 4008) instead of looping; re-pairing a server with the same cloud
  identity preserves the durable telemetry replay cursor.

### Changed
- **The deprecated `discord-bot/` folder is no longer staged into the
  installer.** The bot lives in the `citadel-bot` repo / Citadel Cloud; the
  legacy `CITADEL_AGENT_SPAWN_BOT=1` path still works for from-source
  installs. README rewritten to match (bot, real 6-step setup wizard, removed
  phantom docs commands).

### Added
- `.env.example` documenting every environment variable the Agent reads.

---

## v2.21.9 — 2026-05-30

### Added
- **Deep-health push to Citadel Cloud.** The cloud-bridge now forwards an
  `agent_health` telemetry frame every 30s carrying the `GET /api/health/deep`
  per-server slice (lifecycle status, RCON/sidecar/DZSA liveness, integrity,
  restart-pending, crash-breaker counters, agent memory, metrics-store state).
  Citadel Cloud ingests it (new health hypertable + read API) so it can surface
  local degradation — and alert — before it becomes an outage. Forward-
  compatible: a Cloud without the new ingestion safely ignores the topic.

---

## v2.21.8 — 2026-05-30

### Added
- **Drag-to-reorder** in the loadout and market editors — slot items, cargo, and
  weapon/melee/sidearm sets in the loadout builder; category item rows and
  trader assigned-categories in the market editor. Drag-handle based (row inputs
  stay usable) with a drop-position hint. This completes the editor-polish set
  (keyboard-nav + duplicate landed in 2.21.7).

---

## v2.21.7 — 2026-05-30

**Bulletproofing the local executor + observability + editor polish.** Focused
on the Agent's real mandate (a rock-solid local executor with clean interfaces
for Citadel Cloud to build on).

### Reliability
- **Bounded metrics DB** — per-server row cap (250k) plus retention pruning now
  runs **hourly** (was daily, which could rarely fire given service restarts).
- **No overlapping Steam polls** — a re-entrancy guard prevents concurrent
  SteamCMD runs racing the shared update state.
- **Self-heal watchdog** — if a server's sidecar or DZSA endpoint dies while the
  game keeps running, the supervisor re-establishes them on the next tick.
- **No state leaks on delete** — `server-lifecycle.forget()` tears down
  lifecycle/crash/sidecar/DZSA per-server state when a server is removed.

### Observability
- **New `GET /api/health/deep`** (authenticated) exposing per-server internals
  (state, RCON, sidecar, DZSA, integrity, pending-restart, crash/breaker
  counters) and agent state (metrics-store, cloud-bridge) — the surface Citadel
  Cloud polls to catch local degradation early.

### UX
- **ItemPicker keyboard navigation** — ↑/↓/Enter/Esc with combobox/listbox aria
  roles (shared by the loadout + market editors).
- **Duplicate** action on loadout slot items, cargo, and weapon/melee/sidearm
  sets.
- Slightly lighter **muted-text** color for better small-text contrast.

---

## v2.21.6 — 2026-05-30

**Trust Network loop + security hardening.**

### Added
- **Trust Network ban loop closed end-to-end.** Community/shared bans now flow
  into the mod's `bans.json` so a community-banned player is rejected on connect
  **with a reason** ("Trust Network: cheating/griefing/exploiting"), not just a
  bare BattlEye kick. Live local bans/unbans refresh that file immediately
  (previously only on restart). Local bans can now **contribute up** to the
  shared DB — but only when the admin explicitly categorizes the ban, so the
  cheater network isn't polluted by personal/uncategorized bans.

### Security
- **Agent self-updater hardened** — the download allowlist is tightened to this
  repo's release assets only (was "any github.com URL"); the installer's
  Authenticode signature is verified before launch and a **silent/unattended
  install of an unverified binary is refused** (operator must confirm
  interactively); downloads stage to a fresh unique temp dir.
- **DZSA public endpoint** (`gamePort+10`) gained a per-IP rate limit,
  connection cap, request timeouts, and a cached payload.
- **Integrity endpoints** got a tight dedicated rate limit + a per-server
  in-flight lock so they can't be spammed to saturate disk/CPU.
- **Ban writes validate the SteamID/GUID** (no control chars), preventing
  newline-injection of extra `ban.txt` entries.

---

## v2.21.5 — 2026-05-30

**Audit hotfix.** A full-codebase audit surfaced regressions in the recent
editor/feature work plus some pre-existing landmines. All fixed.

### Fixed
- **Delete was broken** in the loadout + market editors — calls used the
  non-existent `API.delete` (only `API.del` exists) and threw. Now works.
- **DZSA endpoint went stale after restart** — `restartServer` now re-syncs the
  mod-list endpoint (and re-applies engine tuning + integrity check), not just
  start/stop.
- **ExpansionEditorPage crash** — `useState` after an early return in the
  Airdrop/Map/SafeZones sections (React rules-of-hooks) is fixed.
- **metrics DB** is now closed (WAL checkpointed) on shutdown; DZSA endpoints
  stop cleanly.
- **engine auto-tune respects manual `dayzsetting.xml`** — a hand-authored
  jobsystem block (no Citadel marker) is left untouched instead of overwritten.
- **integrity drift** check is delayed past the engine's PBO load and only
  alerts on *new* drift — eliminates false-positive notifications on start.
- **Loadout builder** uses stable row identity (fixes inputs/expand-state
  sticking to the wrong row on remove/reorder); never written to saved JSON.
- **Mod uninstall now confirms** before deleting files.
- **Frontend lint gate restored** — the eslint config never enabled
  `react/jsx-uses-vars`, hiding ~700 false warnings *and* 19 real errors. Fixed
  the config and the real errors; lint is now clean (0 errors).

---

## v2.21.4 — 2026-05-30

**Market Editor overhaul.** A major upgrade to the Trader/Market editor,
cross-referenced against the official Expansion Market Manager and closing the
four highest-value gaps — while keeping our edge on trader-zone + NPC `.map`
placement and bulk price math.

### Added
- **Catalog-backed item picker on every ClassName field** — category items,
  SpawnAttachments, Variants, trader currencies, and item overrides now
  autocomplete against the server's real item classnames (vanilla + mods), with
  free-text fallback. Extracted into a shared `ItemPicker` + cached
  `useItemCatalog` hook (also used by the loadout builder).
- **Diagnostics tab** — flags inverted prices (min>max), inverted stock,
  duplicate classnames (in-file and cross-file), missing DisplayName, traders
  referencing categories that don't exist, and a missing-dependency hint. Scans
  all files in two requests, grouped by severity.
- **Import / Export with ZIP** — import a single `.json` or a bulk `.zip`
  (entries auto-routed to category/trader by content, create-or-overwrite);
  export all market + trader files as a ZIP. Interchangeable with the official
  builder.
- **Missing trader fields** restored — `DisplayCurrencyValue`,
  `DisplayCurrencyName`, `UseCategoryOrder`, `RequiredCompletedQuestID` (no more
  silent round-trip loss).

---

## v2.21.3 — 2026-05-30

**Visual Expansion Loadout Builder.** The Loadouts editor is overhauled from a
generic schema form into a purpose-built visual builder that matches the
official Expansion Loadout Builder — but catalog-aware (it knows your server's
actual modded items).

### Added
- **Slot-based worn-gear editor** (Body, Legs, Feet, Mask, Gloves, Headgear,
  Back, Shoulder, Hips…), **Cargo**, and the special **WEAPON / MELEE / SIDEARM
  Sets**, each item with Chance / Health / Quantity and fully recursive nested
  attachments + cargo (e.g. weapon → magazine, backpack → contents).
- **Catalog-backed item picker** — autocompletes against the server's real item
  classnames (`/api/servers/:id/items`) with free-text fallback.
- **Import / Export** of loadout `.json` — interchangeable with the official
  web builder.
- **Builder ⇄ Raw JSON toggle** (Builder is the default; raw editor is live-
  validated for power users).

**Fix: API Docs page blank.** The Swagger UI page at `/api/docs` loaded its
assets from the unpkg CDN, but the global helmet CSP only allows scripts from
`'self'` + cdnjs — so the bundle and inline init script were blocked and the
page rendered blank in both the browser and the desktop app's docs window.

### Fixed
- `/api/docs` now sends a **route-scoped Content-Security-Policy** that permits
  its Swagger assets (script/style/font/img from unpkg + the inline initializer,
  plus `'unsafe-eval'` the bundle needs). Scoped to this single admin-gated
  response — the strict global app CSP is unchanged.

---

## v2.21.1 — 2026-05-29

**Fix: desktop auto-update loop.** v2.21.0 bumped only the root version, so the
Electron desktop app (whose version comes from `desktop/package.json`) still
reported `2.20.0` while the update feed advertised `2.21.0` — producing a
perpetual "Update v2.21.0 ready to install" prompt that reinstalling could not
clear.

### Fixed
- Bumped `desktop/package.json` in lockstep with the root version.
- `installer/build.js` now **syncs `desktop/package.json` to the root version**
  before packing the Electron app, so the packaged `app.getVersion()` always
  matches the `latest.yml` it ships — the version can never drift again from a
  single root bump.

---

## v2.21.0 — 2026-05-29

**Closing the gap with CF Architect.** A focused pass that cross-referenced
Citadel against the Architect ecosystem and shipped the engine-level hosting
disciplines we were missing — plus surfacing in-game telemetry the
@CitadelAdmin mod was already producing but the Agent had been discarding.

### Added
- **In-game world metrics** — server tick time (avg/low/high) and entity / AI /
  vehicle counts are now persisted locally and charted in an "In-Game World"
  section on the Metrics page. The metrics store schema was widened with a
  transparent migration for existing `metrics.db` files; history JSON + CSV
  export carry the new fields.
- **Mod integrity & drift detection** — SHA-256 PBO fingerprints are snapshotted
  on install/update; a background check on server start flags mods whose bytes
  changed on disk (corruption, tampering, partial sync) or went missing. The
  installed game build id is read from the Steam appmanifest and surfaced. New
  Mods-page status bar with **Verify Integrity** / **Re-baseline** actions.
- **Engine auto-tuning** — on start, Citadel sizes the DayZ engine job system
  (`dayzsetting.xml` max/reserved cores + queue depths) to the host CPU.
  Idempotent; opt-out via the new **Engine Auto-Tune** toggle.
- **DZSA Launcher publishing** — opt-in per server, serves the mod list on
  `gamePort + 10` so the DayZ Standalone Launcher can discover the server and
  players can one-click-subscribe to the exact mod set. Always-fresh (read live
  on each request).
- **Cloud-ban in-game enforcement** — implemented the `CitadelBanManager` in the
  @CitadelAdmin mod (kick-on-connect with ban reason); the Agent now writes
  `$profile:Citadel/bans.json` with reasons alongside `ban.txt`.
- **Assisted self-update** — admin-only endpoints download + verify the signed
  installer from trusted release hosts and launch it (interactive by default,
  silent opt-in), handing file replacement to the proven NSIS installer.

---

## v2.20.0 — 2026-05-25

**The Cloud is plugged in.** v2.19 split the product into Agent + Cloud
and renamed the surfaces. v2.20 is the release where they actually talk
over the wire — per-DayZ-server WebSocket pairing to
`wss://api.citadels.cc/ws/plugin` in the CFTools/GameLabs Server-ID +
API-key pattern, with live bidirectional traffic once paired.

Full narrative in [`RELEASE_NOTES_v2.20.0.md`](./RELEASE_NOTES_v2.20.0.md).

### Added
- **Cloud pairing card** on each server's Settings page. Paste a Server ID
  + API key from `citadels.cc/account → Plugin servers`, the Agent opens an
  authenticated WS to Cloud for that server. Status flips live as the
  supervisor reconciles. One WS per DayZ server (Cloud enforces single-
  socket with `CLOSE_SUPERSEDED`). API key encrypted at rest via the
  existing AES-256-GCM credential helper.
- **Auto-connect supervisor.** A 5s reconcile tick + inline `reconcileOne()`
  hooks open the WS when a linked server transitions to `running` and
  close it when stopped. No WS spinning for offline servers.
- **Telemetry forwarding** (consumed by the `@CitadelAdmin` mod's file
  IPC at `$profile:Citadel/`):
  - `metrics` every 15s — FPS×100, players, AI/animal/vehicle/entity
    counts, uptime
  - `player_position` — batched live positions
  - `player_connect` / `player_disconnect` (with `duration` seconds)
  - `kill` (with `is_headshot` + normalized `hit_zone`)
  - `death` + `suicide` (with normalized `DeathCause` enum)
  - `chat`
- **Inbound commands** (Cloud → Agent → Mod). Cloud's `CommandAction`
  vocabulary (kick, ban, heal, kill, teleport, spawn_item, message,
  broadcast, set_time, set_weather, wipe_ai, wipe_vehicles) maps to mod
  IPC actions; result echoed back as `command_result` carrying the
  original id.
- **`config_sync` persistence.** Cloud Bans push lands as
  `$profile:Citadel/config_bans.json` (atomic write). Mod-side
  enforcement is a separate task.

### Changed
- **Per-server WS lifecycle.** Forwarders attach on `authenticated` and
  detach on `disconnected`; the Forwarder instance stays warm across a
  reconnect flap so the session-start cache (used to compute disconnect
  durations) doesn't lose state on a 30s blip.
- **Bundle size.** Removing five page lazy-imports cut the frontend
  `index` chunk by ~32KB.

### Removed
- **Chat Log / Kill Feed / Live Dashboard / Bans / Watchlist** moved to
  Cloud. Page files + backend routes deleted, sidebar entries pruned,
  permission `bans.manage` stripped from the Moderator role. Per-player
  ban actions on the Players page still function. `data/bans.json` and
  `data/watchlist.json` stay on disk for the future migration.
- **18 historical `RELEASE_NOTES_v*.md` files** at repo root. Past release
  narratives live in this changelog and in the git tags. Recoverable from
  git history.

### Fixed
- **New server didn't appear after Deploy.** Stale `if (!API.token)` guard
  in `ServersContext.loadServers` was a permanent no-op under M11 cookie
  auth, so the server list never refreshed. Removed. Added a 750ms
  follow-up refresh after `deployProgress: complete` to absorb backend
  write timing.
- **Cloud sign-in failure logged you out of the Agent.** The backend
  forwarded `citadels.cc` 401s verbatim, and the dashboard's global 401
  handler treated those as Agent session expiry. Backend now rewrites
  upstream 401/403 to 422 so credential failures stay body-level errors.
- **Activation banner stayed stale up to 5 minutes after activation.**
  License page now dispatches `citadel:license-changed` on
  activate/refresh/deactivate; banner subscribes and reloads
  immediately. Also clears the per-session dismissal flag on activate.

### Dependencies
- Backend: `ws@^8.18.0` (WebSocket client for the Cloud bridge).

---

## v2.19.0 — 2026-05-24

**Product-direction release.** Splits the project into two pieces so each can
do its job well:

- **Citadel Agent** (this repo) — the local Windows app for installing,
  configuring, modding, and operating DayZ servers on the owner's box.
- **Citadel Cloud** (at citadels.cc/cloud) — the connected layer for remote
  control, automated restarts and messages, the Trust Network ban database,
  multi-machine fleet view, and the Citadel Discord bot.

Several features moved out of the Agent into Cloud. The desktop app is now
called **Citadel Agent** everywhere user-visible. Machine identifiers
(install path, registry key, Windows service name, exe filename, `%APPDATA%`
folder) intentionally stay "Citadel" so existing installs upgrade in place.

Full narrative in [`RELEASE_NOTES_v2.19.0.md`](./RELEASE_NOTES_v2.19.0.md).

### Added
- **`server.bindHost`** config (env: `BIND_HOST`, default `127.0.0.1`).
  Backend now binds to loopback by default; the dashboard is reachable
  only from this machine. Remote access is intended to go through Citadel
  Cloud, not a directly exposed Agent. Set `BIND_HOST=0.0.0.0` to opt back
  into LAN access (logs a security warning).
- **Trust Network status banner** on the Bans page — read-only line
  showing how many community-banned cheaters are synced to this server,
  with a deep-link to manage in Citadel Cloud.
- **Setup-wizard Cloud pairing pitch** — the "All Set" step now has an
  explicit optional next step pointing to citadels.cc/cloud.
- **`CITADEL_AGENT_SPAWN_BOT`** legacy env-var escape hatch for the
  Discord bot (see Removed below).

### Changed
- **Rename: "Citadel" → "Citadel Agent"** across all user-visible labels:
  window title, tray tooltip + menu, app menu (File/Help/About),
  notification default title, splash page, installer Name/ProductName/
  Section/Welcome/Finish/firewall description/shortcut tooltips/Add-Remove
  Programs DisplayName, README headline, package.json description,
  shortcutName.
- **Sidebar nav**: "Citadel Cloud" link (which actually pointed to the
  local License page) renamed to "Subscription". "Server Hub" breadcrumb
  → "Your Servers".
- **Server list positioning**: small inline hint clarifies this is the
  Agent's local server list, not a multi-machine fleet view; links to
  Cloud for that.
- **License banner copy** distinguishes the base Citadel subscription
  (what activates the Agent) from the optional Citadel Cloud add-on
  across all states (unactivated/grace/past_due/lapsed/expired).
- **Setup wizard welcome heading** — "Welcome to Citadel" → "Welcome to
  Citadel Agent"; intro reframed as "Local DayZ server management for
  Windows."

### Removed
- **Cloud Bans management UI** — `/global-bans` page, sidebar link,
  `POST /api/cloud-bans/sync`, `GET /api/cloud-bans/list`. Trust Network
  *enforcement* (downloading the synced ban list and writing it to
  `ban.txt`) stays local. Management moves to citadels.cc/cloud.
- **Restart Scheduler UI + cron loop** — `/scheduler` per-server page,
  routes, and the in-Agent timer engine. Existing
  `data/restart-schedules.json` is left on disk for inspection but no
  longer loaded; schedules become inert. Cloud will own this going
  forward and call `/api/server-control/restart` on the Agent when a
  window fires.
- **Webhook config UI + CRUD** — `/webhooks` page, sidebar link, routes.
  The 20+ internal `fireWebhooks()` call sites stay intact as the event
  seam; outbound HTTP delivery is stubbed until Cloud's event channel
  ships. Same treatment for `sendDiscordWebhook()`.
- **Discord bot bundled in this repo** — extracted to its own
  [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot) repo. The
  Agent no longer launches the bot by default. Set
  `CITADEL_AGENT_SPAWN_BOT=1` to restore the legacy in-Agent spawn for
  one release. `/api/discord/*` API surface kept intact so the standalone
  bot still authenticates and calls in.
- **Pre-split planning docs** — `AUDIT_REPORT.md`,
  `AUDIT_REPORT_2026-05-19.md`, `ROADMAP.md`, `PRIORITIZED_FIXES.md`,
  `docs/admin/smoke-test-global-bans.md`. All reference a product surface
  that no longer exists post-split. Recoverable from git history.

### Security
- Default bind changes from `0.0.0.0` to `127.0.0.1`. The Agent dashboard
  is no longer reachable from the local network unless explicitly opted
  in via `BIND_HOST`. **This is a breaking change for anyone who relied
  on browsing to `http://<server-ip>:3001` from another machine** — see
  the release notes for the migration path.

---

## v2.18.6 — 2026-05-19

Six-commit follow-up to v2.18.5 closing the remaining items from the
2026-05-19 delta audit. Drop-in upgrade. See
[`RELEASE_NOTES_v2.18.6.md`](./RELEASE_NOTES_v2.18.6.md) for the full
narrative.

### Added
- **Cmd/Ctrl+K Config Search** — global modal that fuzzy-searches across
  every Expansion settings field (~2,420 entries) and deep-links to the
  right category with a row highlight. New
  `GET /api/expansion-docs/field-index` endpoint, modal in
  `AppLayout`, ExpansionEditorPage URL-param handler. (audit N9)
- **`/help` Discord slash command** — categorized command reference
  DMed to the user, falls back to ephemeral if DMs blocked. (audit N13)
- **`GET /api/servers/:id/mission-folder`** — auto-fills mission name in
  the FilesPage template picker so `<your-mission>` placeholders work
  on first click. (audit N12)
- **Mod `auth_in_body` config flag** (default false). When enabled, the
  DayZ mod stops sending api_key in URL queries on every poll + event/
  ack call; the key moves to the JSON body. Runtime test pending.
  (audit N3 mod-side)
- **Code-signing pipeline** — `installer/build.js` runs `signtool sign`
  when `CITADEL_SIGN_PFX` + `CITADEL_SIGN_PASSWORD` are set, with a
  workflow step that decodes a base64 GitHub secret. Skipped silently
  when unconfigured. `installer/SIGNING.md` runbook ships in the repo.
  (audit N4)

### Changed
- **Error responses now ship optional `code` + `suggestion`** alongside
  the existing `error` string. New `clientError()` helper, extended
  `safeError()`, toast + setup wizard + login screen render the
  suggestion as a secondary line. Rolled out across `setup.routes.js`,
  `auth.routes.js`, `files.routes.js` — the routes admins hit during
  their first hour. Long-tail callsites unchanged, no regression.
  (audit N6)
- **Mobile UI for crisis ops** — new 768px and 600px breakpoints on
  top of the existing 900px sidebar drawer. Server-control buttons
  stack on tablet width; PlayersPage and BansPage tables convert to
  stacked cards on phone width via a new `.mobile-card-table` opt-in
  class with `data-label`-driven cell labels. (audit N8)
- **Hover definitions on Loadout / Quest / Objective type badges** via
  native `title=` tooltips. Hover any badge to learn what "Hero",
  "Bandit", "AI VIP", "Treasure Hunt" mean without leaving the page.
  (audit N18)
- **Expansion-docs template index shared-cached** across modal re-opens
  via `utils/expansionDocsCache.js` (5-min TTL, in-flight dedup).
  (audit N16)
- **`expansion-docs.routes.js` template path build routes through
  `safePath()`** instead of an ad-hoc `startsWith()`. (audit N10)

### Security
- **bcryptjs → @node-rs/bcrypt** (Rust-native, prebuilt N-API binaries,
  no node-gyp). Hash format cross-compat verified — existing user
  records validate without re-hash. (audit N5)

### Open follow-ups (not blocking the release)
- Mod runtime test before flipping `auth_in_body: true`
- Code-signing cert procurement
- `gh release edit v2.18.0/1/2 --prerelease`
- Long-tail error-shape and table-card migrations to remaining routes /
  pages, opportunistically as touched

---

## v2.18.5 — 2026-05-19

Delta-audit cleanup pass. Fourteen audit items closed across security,
quality, performance, and UX. No breaking changes; drop-in upgrade. See
[`RELEASE_NOTES_v2.18.5.md`](./RELEASE_NOTES_v2.18.5.md) for the full
narrative and [`AUDIT_REPORT_2026-05-19.md`](./AUDIT_REPORT_2026-05-19.md)
for the audit that drove it.

### Fixed (security)
- **BackupsPage was leaking the JWT into download URLs as `?token=...`**
  and was broken anyway since the M11 cookie migration. Rewired to
  `fetch` + `credentials: 'include'` + blob anchor click. Removed the
  matching backend URL-token shims in `backup.routes.js` and
  `setup.routes.js`. (audit N2)
- **Backend logger now redacts `api_key` (snake-case) and `req.query.*`**
  and exports a `sanitizeUrl()` helper that's wired into the `req.url`
  logger callsites. Closes the backend half of the DayZ-mod URL-key
  leak. (audit N3, backend half)
- **`expansion-docs.routes.js` template path build goes through
  `safePath()`** for consistent case-insensitive guard. (audit N10)

### Fixed (setup wizard reliability)
- **`completeSetup()` no longer swallows errors and silently navigates
  to "done"** — exactly the v2.18.0–v2.18.3 trap. Auto-detect failures
  also now surface inline instead of looking like a frozen button.
  (audit N7, silent-catch half)
- **"Download diagnostics (for support)" link** under any setup wizard
  error message. Backed by a 50-event ring buffer in `api.js`; produces
  a sanitized `.txt` users can attach to support threads. (audit N7,
  diagnostics half)
- **Admin password step now shows live per-rule checkmarks** (length,
  upper, lower, number, symbol) and the placeholder reflects the real
  policy. (audit N15)
- **DO-NOT-INSTALL banner on `RELEASE_NOTES_v2.18.0/1/2.md`** pointing
  to v2.18.4+. (audit N14)

### Added
- **`/help` Discord slash command** — categorized command reference
  DMed to the user, falls back to ephemeral if DMs blocked. (audit N13)
- **`GET /api/servers/:id/mission-folder`** — exposes
  `detectMissionFolder` so the FilesPage template picker can auto-fill
  the `<your-mission>` placeholder. (audit N12)

### Changed (UX polish)
- FilesPage template picker validates target path in real time
  (traversal + absolute-path checks, red border on invalid). (audit
  N11, FilesPage half)
- LoadoutsPage name input validates in real time. (audit N11,
  LoadoutsPage half)
- ExpansionEditorPage: "Mission Folder" → "Mission-folder Settings"
  with `mpmissions/<mission>/expansion/` subtitle. (audit N17)
- Loadout/Quest/Objective type badges carry hover definitions on every
  page that imports them. (audit N18)

### Performance
- Shared-cached `/api/expansion-docs/templates` list across modal
  opens via new `utils/expansionDocsCache.js`. (audit N16)

### Hygiene
- Stale `latest.yml` deleted from repo root + added to `.gitignore`
  (live feed is the GitHub Release asset, hash-verified). (audit N1)

### Internals
- Independent re-verification of all prior-audit C1–C5, H6–H9, M11–M18
  items in current code. All hold.

### Open follow-ups (deferred — see PRIORITIZED_FIXES.md)
- N3 mod-side (needs DayZ runtime test)
- N4 code signing (needs cert procurement)
- N5 bcryptjs → bcrypt (needs install-pipeline validation)
- N6 error-shape rollout (broad mechanical PR)
- N8 mobile responsive admin panel (multi-day)
- N9 Ctrl+K config search + glossary (design + indexer)

---

## v2.18.4 — 2026-05-17

Third hotfix for the v2.18.x setup wizard. v2.18.3 wasn't sufficient —
in testing the wizard was still 403'ing on Auto-Detect IP because
`/api/setup/admin` never set the `auth-token` HttpOnly cookie that
audit M11 expects for browser session auth. Without the cookie, the
wizard had no credentials for `requireSetupMode` to validate. See
[`RELEASE_NOTES_v2.18.4.md`](./RELEASE_NOTES_v2.18.4.md) for the full
narrative.

### Fixed
- **Auto-Detect IP and post-admin wizard steps still 403'd in v2.18.3**
  because the wizard wasn't actually sending an Authorization header.
  Audit M11 moved browser session auth from `localStorage` Bearer
  headers to an HttpOnly `auth-token` cookie set by `/api/auth/login`,
  but `/api/setup/admin` had never been updated to set the same cookie.
  Fix paired both ends: `/api/setup/admin` now sets the `auth-token`
  cookie alongside the JSON token return (matches `/api/auth/login`),
  and `extractSetupToken()` in `requireSetupMode` now reads from
  `req.cookies['auth-token']` first.

---

## v2.18.3 — 2026-05-17

Critical fix for the v2.18.x setup wizard's post-admin steps. v2.18.2
unblocked admin creation; v2.18.3 unblocks the rest of the wizard
(network, Steam, complete). See
[`RELEASE_NOTES_v2.18.3.md`](./RELEASE_NOTES_v2.18.3.md) for the full
narrative.

### Fixed
- **Setup wizard's post-admin steps returned 403** — Auto-Detect IP,
  network save, Steam configuration, and Complete Setup all failed
  silently after the admin step succeeded. POST `/api/setup/admin`
  writes the first-run marker for security (audit C5), but every
  other setup endpoint was gated by the same marker check, so the
  wizard locked itself out of its own remaining steps. `requireSetupMode`
  now also accepts a valid root-admin JWT — the token issued by the
  admin step — so the wizard can finish. Audit C5 is unaffected:
  unauthenticated re-arm of `/api/setup/admin` still returns 403 once
  the marker is written.

---

## v2.18.2 — 2026-05-17

Critical fix for a v2.18.1 regression that locked new and re-installed
users out of first-time setup with a `403 Forbidden`. See
[`RELEASE_NOTES_v2.18.2.md`](./RELEASE_NOTES_v2.18.2.md) for the full
narrative.

### Fixed
- **Setup wizard returned 403 on POST `/api/setup/admin`** when the
  `data/` directory had servers from a prior install but no real admin
  user yet. `getSetupState()` checked `hasServers` before the
  "only default admin exists" branch, so any leftover server state
  caused the wizard to latch itself out before the user could ever
  create a real admin. Reordered the checks; the first-run security
  marker still works the same way (once a real admin exists, setup
  stays locked forever).

---

## v2.18.1 — 2026-05-17

Critical fix for v2.18.0 launch issues + Loadouts editor + Quest badge
fix. **Upgrade recommended for all v2.18.0 installs.** See
[`RELEASE_NOTES_v2.18.1.md`](./RELEASE_NOTES_v2.18.1.md) for the full
narrative.

### Fixed
- **Desktop app failed to launch silently** on some systems — undefined
  `fileLog()` call in `desktop/src/auto-updater.js` raised an unhandled
  promise rejection during init that prevented the window from opening
  (Electron processes started but no UI appeared). Removed the bad line;
  `appendUpdateLog()` on the line above already handles file logging.
- **Quest Creator list badges all showed "Treasure Hunt"** — the badge
  was reading `quest.Type` (Expansion's category enum, defaults to 1 for
  almost every quest) mapped through Citadel's incorrect QUEST_TYPES
  table. Now surfaces each quest's first objective `ObjectiveType`
  ("Target/Kill", "AI Patrol", "Travel", etc.), which actually
  describes what the quest does.

### Added
- **Loadouts editor** — new sidebar entry under MOD CONFIGS. Manages
  `Profiles/ExpansionMod/Loadouts/*.json` (player + AI faction
  loadouts).
  - File list with kind badges (Player/Hero/Bandit/AI/Custom) and
    per-file slot/item counts.
  - Schema-driven editor backed by `BanditLoadout.schema.json`.
  - "+ New from template" pulls from `/api/expansion-docs/templates`
    (Loadout, BanditLoadout, ExampleLoadout, etc.).
  - "Docs ↗" opens the wiki's Loadout Builder.
  - Save creates a backup; delete also creates a backup before unlink.
- **New API route** `/api/servers/:id/expansion/loadouts` —
  list/read/save/delete, audit-logged, path-traversal-safe.

---

## v2.18.0 — 2026-05-17

Complete rebuild of Citadel's DayZ Expansion support against the new
official wiki at [dayzexpansion.com](https://dayzexpansion.com). No
PBO/mod change required — server-side and desktop-side only. See
[`RELEASE_NOTES_v2.18.0.md`](./RELEASE_NOTES_v2.18.0.md) for the full
narrative and admin-facing notes.

### Added
- **50 Expansion JSON Schemas** (was 4) sourced from the official wiki,
  covering every Expansion settings file the wiki documents — AI, base
  building, quests, missions, vehicles, navigation, personal storage,
  spawn selection, P2P market, and more.
- **24-mod metadata index** at `backend/schemas/expansion/_mods.json` —
  workshop URLs, deps, conflicts, versions, wiki links per mod.
- **117 JSON skeleton templates** under
  `backend/schemas/expansion-templates/` for every documented config
  file (settings, quests, NPCs, objectives, market categories).
- **2 form layouts** under `backend/schemas/expansion-forms/`
  (`Trader_Item_Entry`, `Spawn_Location_Entry`).
- **Template picker in Files page** — `+` button in the Explorer
  sidebar opens a searchable modal of all 117 templates; pick one,
  confirm the target path, and the file is created with a backup
  snapshot and auto-opens in a new editor tab.
- **"Docs ↗" deep-links** in Expansion Editor, Trader Editor, and
  Quest Editor pages, routing to the matching wiki tool (Hardline
  Editor, Quest Editor, Market Editor, Settings Editor, mod page).
- **New API surface** at `/api/expansion-docs/*` — `/version`, `/mods`,
  `/templates`, `/templates/:name`, `/forms`. Auth-gated,
  path-traversal-safe.
- **`scripts/sync-expansion-docs/`** — re-runnable sync pipeline.
  Refreshing for a new wiki release is one command.

### Changed
- **HardlineSettings:** 13 → 23 fields. Adds the full item rarity tier
  system, `EntityReputation`, `EnableFactionPersistence`, etc.
  Schema `m_Version=11`.
- **MarketSettings:** 9 → 28 fields. Adds `Currencies`, `CurrencyIcon`,
  ATM subsystem, spawn positions, large vehicles, and more.
  Schema `m_Version=17`.
- **GeneralSettings:** 18 → 26 fields. Adds `EnableAutoRun`,
  `EnableEarPlugs`, full Gravecross suite, `EnableLighthouses`,
  `EnableHUDNightvisionOverlay`, `DisableShootToUnlock`.
  Schema `m_Version=16`.
- **TerritorySettings:** 10 → 13 fields, with three field renames to
  match upstream (`MaxMembersPerTerritory` → `MaxMembersInTerritory`,
  `TerritoryPerPlayer` → `MaxTerritoryPerPlayer`,
  `EnableTerritoryMember` → `OnlyInviteGroupMember`).
  Schema `m_Version=6`.
- **`backend/schemas/expansion/manifest.json`** rebuilt from upstream
  with proper `schemaFile` pointers, so `mod-config-schema.js` now
  associates schemas with files (returned an empty bundle before).
- Adapter preserves rich type info: `enum_string` with labels, `color`
  (`format: 'argb-int'`), `vector`, `classname`, `icon`, and `map`
  with key/value type hints.

### Fixed
- **`mod-config-schema.js` returned an empty bundle for Expansion** —
  the legacy manifest had no `schemaFile` field on any entry, so the
  loader silently associated zero schemas. Now returns 50.
- **Stale field set in the 4 in-tree Expansion schemas** caused valid
  modern config files to flag "unknown field" warnings (item rarity
  tiers, ATM settings, etc.).

---

## v2.17.0 — 2026-04-30

Live Dashboard usability + map tile proxy + a long list of @CitadelAdmin
mod compile/runtime fixes. Repack the PBO and redeploy to get the
mod-side improvements (FPS reading, working weather buttons).

### Added
- **Click-to-place picker** for spawn buttons (Heli Crash, Gas Zone) —
  instead of failing with *"coords required"*, the app switches to
  the map tab and you click anywhere to place.
- **Click-to-place player teleport** — replaces the old behavior that
  dropped players at `0,0,0` (the ocean corner of every map).
- **Right-click → Ban** in the Live Dashboard players list. Reason
  prompt, persists to the Bans page.
- **Right-click → Add to Priority Queue** — quick-add as VIP/permanent.
- **Player Profile → Live State tab** — health bars, position, gear,
  mod stats. Snapshot persists across logout for forensics.
- **Map tile proxy** at `/api/maps/tiles/*` with disk caching under
  `<install>/data/map-tiles/`. New `DAYZ_TILE_VERSION` env var lets
  admins update the version without rebuilding the desktop app.
- **`GET /api/maps/version`** for the frontend to read tile version /
  allowed styles.

### Fixed
- **Live Dashboard / Kill Feed / Chat Log crashed** with *"Something
  went wrong"* due to a `serverMap` reference outside its scope.
- **Map background was blank** because the hardcoded `TILE_VERSION =
  '1.28'` 404'd; xam.nu currently serves `1.27`. Version is now
  configurable via env var.
- **Tightened CSP** — no external `xam.nu` hosts in `imgSrc` or
  `connectSrc` now that tiles route through our backend.
- **@CitadelAdmin mod — server FPS** showed 0 / 1998680 because of a
  `/2` bug and a 60-sample warmup gate. Both fixed.
- **@CitadelAdmin mod — Sunny/Rain/Fog/Storm** buttons did nothing
  visible; missing `SetWeatherUpdateFreeze(true)` + zero-duration lock
  meant the engine immediately overrode every change. Now uses a
  30-second transition with a 1-hour lock.
- **@CitadelAdmin mod — multiple compile errors** that prevented mod
  load: undefined methods (`Warning`, `GetYear/GetMonth/...`, `FPrintF`,
  invented `Weapon_Base` API, `GetMissionName`, `GetDate`,
  `GetServerUptime`, `GetWorldSize`, `GetAmmoType`), wrong `IndexOf`
  arity, `?:` ternary not supported, `int i` redeclaration in same
  scope, *"Formula too complex"* string concatenations, missing
  `.GetActual()` on weather curves, trailing comma in `string.Format`.

---

## v2.16.0 — 2026-04-29

This release introduces **Citadel Cloud**, an optional **+$10/month**
subscription that adds on top of your Citadel subscription. The flagship
feature is the Global Ban Database — every Citadel Cloud customer
contributes their bans to a shared pool, and your server is automatically
protected against everyone else's known cheaters.

It also adds **CFTools banlist import** so existing CFTools customers
can bring their banlist with them when switching to Citadel.

**Important:** the dashboard talks to citadels.cc for license + cloud
endpoints. This release expects citadels.cc to be deployed with the
matching schema + Paddle product configured. If you self-host
citadels.cc, run `drizzle-kit migrate` before letting customers
upgrade. See `docs/admin/PRODUCTION-DEPLOYMENT.md`.

### Added
- **Global Ban Database** — a network-wide cheater pool with a 3-vouch
  threshold before any submission propagates. Surgical `ban.txt` updates
  on each managed server; never stomps on your local bans.
- **Trust & safety system** — per-customer reputation with vouch_weight,
  automatic 0.7× penalty per overturn, auto-lock at 30%+ overturn rate,
  configurable rate limits (default 50/24h, 1000/30d).
- **Public appeals flow** — banned players file appeals at
  `citadels.cc/appeal/<steamid>`. Moderator decisions cascade to the
  network within an hour.
- **Admin moderation queue** at `citadels.cc/admin/cloud-bans/queue`.
- **`/global-bans` dashboard page** — sync status, manual sync, filterable
  list of community bans currently protecting your server.
- **Loss-aversion banner** on subscription lapse showing how much
  community protection is about to disappear.
- **Two-product entitlement model** — license JWT carries
  `entitlements: ['citadel'] | ['citadel', 'cloud']`. Server middleware
  `requireLicense({ feature: 'cloud' })` and frontend `<LicenseGate
  feature="cloud">` gate paid features at both layers.
- **Account page Cloud subscription card** at `citadels.cc/account` for
  self-serve management.

### Changed
- `paddle-webhook.routes.ts` now routes subscription events to either
  the `subscription_*` (Citadel) or `cloud_subscription_*` (Cloud)
  column group based on `price_id`. Unknown price IDs are refused.
- License `/activate` and `/verify` responses now include an
  `entitlements` array and `cloudSubscription` block.
- `/api/v1/auth/me` exposes Cloud subscription state alongside the
  base Citadel state.

### Deployment notes
- New env vars: `NEXT_PUBLIC_PADDLE_PRICE_CLOUD_MONTHLY` (browser),
  `PADDLE_PRICE_CLOUD_MONTHLY` (server), plus optional Cloud Bans
  tuning vars (`CLOUD_BANS_VOUCH_THRESHOLD`, `CLOUD_BANS_RATE_LIMIT_*`,
  etc — see `packages/api/src/config.ts`).
- New tables: `community_bans`, `ban_submissions`, `ban_appeals`,
  `ban_audit_log`, `customer_submission_stats`, `telemetry_events`.
- New columns on `users`: `paddle_cloud_subscription_id`,
  `cloud_subscription_status`, `cloud_subscription_renews_at`,
  `cloud_subscription_cancel_at`, `cloud_trial_ends_at`.
- See `docs/admin/PRODUCTION-DEPLOYMENT.md` for the full ordered
  deployment runbook.

### Citadel Cloud licensing rollout

Wired the previously-built license/auth layer into the desktop app and
shipped the diagnostic telemetry pipeline that catches future issues
in production.

### Added
- **Activation flow on the dashboard** at `/citadel-license` — sign in
  to your Citadels.cc account, persistent token cache, 7-day offline
  grace window, hourly background re-verification.
- **License banner** with five distinct states (unactivated, grace,
  past_due, lapsed, expired). Marketing variant for unactivated users
  is dismissable per session.
- **Diagnostic telemetry** — events buffered to
  `data/telemetry-queue.json`, flushed every 30s to citadels.cc.
  Opt-out toggle on the Citadel Cloud page; clearly disclosed.
  Allowlisted event names; private notes never leave your machine.
- **Help → Show Update Log** menu item that opens
  `%APPDATA%/Citadel/update.log` for support diagnostics.
- **`<LicenseGate>` and `useLicenseStatus` scaffolding** for future
  paid features.

### Removed
- `desktop/src/license-client.js` — Phase 1 stub. The dashboard talks
  directly to the backend's `/api/citadel-license/*` REST endpoints; no
  separate desktop client needed.

### CFTools banlist import (Phase 4)

Brings an existing CFTools-hosted banlist into Citadel's local ban
database in a single operation. Customer pastes their CFTools API
token from developer.cftools.cloud, picks a banlist ID or server ID,
and Citadel pulls every ban with a Steam64 in the record. No
credentials persisted; one-shot import. Documented in
`docs/admin/migrating-from-cftools.md`.

---

## v2.15.0 — Auto-update reliability + earlier

The auto-update relaunch fix (Phase 1) shipped in v2.15.0:
- Desktop stops `CitadelServer` gracefully before `quitAndInstall`,
  schedules `app.relaunch()` as a fallback when NSIS skips
  `LaunchDashboard` on silent installs, and bumps NSSM's
  `AppThrottle` from 5s to 15s for cold-disk starts.
- NSIS installer stops the running service explicitly before file
  overwrites and force-kills orphan `node.exe` processes.
- Persistent update log at `%APPDATA%/Citadel/update.log` (1 MB
  rotation) for diagnostics.
- New `npm run service:repair` resets NSSM's failure counter for
  customers stuck in back-off.

See git history (`git log v2.7.0..v2.15.0`) for the full set of
changes shipped between those versions.
