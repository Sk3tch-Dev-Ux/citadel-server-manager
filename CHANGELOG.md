# Changelog

All notable changes to Citadel are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
