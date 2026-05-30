# Changelog

All notable changes to Citadel are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
