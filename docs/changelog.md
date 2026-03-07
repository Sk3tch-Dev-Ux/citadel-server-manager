---
outline: [2, 3]
---

# Changelog

## v2.4.0

_Priority Queue, Config Editor Expansion & Ban Kick Messages_

### Added — Priority Queue (VIP System)
- **Automated `priority.txt` sync** — Adding or removing a VIP entry instantly updates every server's `priority.txt` file. DayZ reads the file live since 1.13 — no restart needed
- **Time-limited VIP** — Set expiration with presets (30 days, 90 days, 1 year, permanent) or a custom date. Expired entries are auto-cleaned every 60 seconds
- **Role tiers** — Entries categorized as VIP, Supporter, or Premium with color-coded badges
- **Priority Queue management page** — Full CRUD UI with search, expiration countdown display, add/edit modals, import/export, and expired entry cleanup
- **8 API endpoints** — Complete REST API for priority queue management (`GET/POST/PATCH/DELETE /api/priority-queue`, export, import, cleanup)
- **Server lifecycle sync** — Priority queue re-synced to `priority.txt` on every server start, restart, and external process detection
- **Moderator access** — `priority.manage` permission added to the built-in moderator role

### Added — Ban Kick Messages
- **Configurable kick message** — Customize the message shown to banned players with `{reason}` and `{banId}` placeholders
- **Appeal URL** — Set a Discord invite or appeal URL that replaces "our Discord" in the default kick message
- **Settings UI** — New "Ban Settings" section in the Settings page for configuring kick message and appeal URL
- **Environment variables** — `BAN_KICK_MESSAGE` and `BAN_APPEAL_URL` for configuration via `.env`

### Changed — Config Editor
- **49 fields across 7 sections** — Expanded from 12 flat fields to 49 organized fields: Server Identity, Gameplay, Time & Environment, Voice & Communication, Network & Performance, Persistence & Base Building, Logging
- **Bug fix** — Corrected `disableThirdPerson` to `disable3rdPerson` (the actual `serverDZ.cfg` key name)
- **Popular additions** — `enableCfgGameplayFile`, `logAverageFps`, `logMemory`, `logPlayers`, `adminLogPlayerHitsOnly`, `adminLogPlacement`, `adminLogBuildActions`, `simulatedPlayersBatch`, `multithreadedReplication`, `storageAutoFix`, and many more

## v2.3.0

_Performance Audit, QoL Feature Pipeline & Discord Bot Expansion_

### Performance
- **34-item performance audit** — Comprehensive codebase audit with all findings resolved
- **Eliminated blocking I/O** — Replaced `fs.readFileSync`/`fs.writeFileSync` with async equivalents across sidecar, backend, and mod manager
- **Socket.IO room scoping** — All server-scoped events now broadcast to per-server rooms instead of global emits
- **Memory leak fixes** — Proper cleanup of RCON listeners, polling intervals, and event handlers on server removal
- **Debounced file watchers** — RPT tailer and sidecar watchers debounced to prevent CPU spikes on rapid file changes
- **Lazy module loading** — Heavy modules loaded on demand instead of at startup
- **Connection pooling** — Sidecar HTTP requests reuse persistent agents

### Added — Player Actions
- **Unstuck** — Teleport stuck players to the terrain surface (mod + sidecar + backend + frontend + Discord)
- **Freeze/Unfreeze** — Lock a player in place or release them (mod + sidecar + backend + frontend + Discord)
- **Message Player** — Send a direct in-game message to a specific player (mod + sidecar + backend + frontend + Discord)
- **Teleport to Player** — Teleport one player to another player's location (mod + sidecar + backend + frontend)
- **View Loadout** — Inspect a player's full inventory with item class, quantity, and health percentage (mod + sidecar + backend + frontend)

### Added — Vehicle & Config Actions
- **Vehicle Teleport** — Teleport a vehicle to specific world coordinates (mod + sidecar + backend)
- **Config Reload** — Live reload of mod configuration without server restart (mod + sidecar + backend)

### Added — Discord Bot
- **5 new slash commands** — `/unstuck`, `/freeze`, `/strip`, `/explode`, `/dm` for direct admin actions
- **Expanded admin panel** — 9 admin action buttons across 2 rows (was 4 in 1 row): Heal, Unstuck, Spawn Item, Teleport, Message, Freeze, Strip Gear, Kill, Explode
- **Message player modal** — Discord modal for composing direct messages to players from the panel
- **5 new backend action handlers** — `actionUnstuck`, `actionFreeze`, `actionStrip`, `actionExplode`, `actionMessage` in `discord.routes.js`

### Added — DayZ Mod (@CitadelAdmin)
- **UnstuckPlayer action** — Finds terrain surface height and teleports player above it
- **FreezePlayer action** — Sets player movement speed multiplier to 0 (freeze) or restores it (unfreeze)
- **TeleportToPlayer action** — Resolves target player by Steam ID and teleports source to their position
- **GetLoadout action** — Serializes full player inventory (clothing, attachments, cargo) as JSON response
- **MessagePlayer action** — Sends an in-game notification message to a specific player
- **TeleportVehicle action** — Moves a vehicle to specified world coordinates
- **ReloadConfig action** — Re-reads mod configuration files at runtime

### Changed
- **Frontend PlayersPage** — Player action dropdown reorganized into sections: Helpful (Heal, Unstuck, Spawn, Message), Info (View Loadout, Teleport To Player), Moderation (Freeze, Unfreeze, Strip, Kick), Dangerous (Explode, Kill, Ban)
- **ActionType constants** — New frozen enum entries for all added actions with capability sets, labels, audit codes, and route maps
- **Discord bot architecture** — 31-file structure (was 26) with expanded button dispatch map (40 handlers)

## v2.2.1

_Messenger Templates, Deployment Fixes & Scheduler Reliability_

### Added
- **Messenger templates** — 14 pre-built broadcast message templates across 4 categories (Welcome, Rules, Community, Gameplay) with one-click creation
- **Template picker modal** — Category-filtered template browser with message preview, interval, and delay settings (same pattern as webhook templates)
- **mpmissions scaffolding** — `mpmissions/` and map-specific subfolder (`mpmissions/dayzOffline.<map>/`) now created during deployment and rebuild

### Fixed
- **Experimental branch app ID** — Fixed SteamCMD downloading the DayZ client (`1024020`) instead of the experimental dedicated server (`1042420`). Affected deploy, rebuild, and auto-update
- **Scheduler restart reliability** — Replaced unreliable RCON `#restart` with full process lifecycle (`restartServer()` from `server-lifecycle.js`) for scheduled restarts, stops, and starts
- **Scheduler status gate** — Scheduler jobs now process regardless of server status (required for `start` actions to fire when server is stopped)
- **Scheduler RCON gate** — Only pre-action steps (warnings, lock, kick) require RCON; action execution works regardless of RCON availability

## v2.2.0

_Discord Bot Enterprise Overhaul_

### Architecture
- **Modular rewrite** — Refactored 1,518-line monolithic `bot.js` into 26 files across a clean module structure (`commands/`, `handlers/`, `ui/`, `utils/`)
- **Auto-loading commands** — Command files auto-discovered and registered via `commands/index.js`
- **Button dispatch map** — 35 button handlers use object lookup instead of if/else chain
- **Shared server lifecycle** — `startServer()` and `stopServer()` extracted into `server-lifecycle.js`, used by both web panel and Discord bot (includes port checks, firewall rules, lifecycle hooks, sidecar/tailer management, notifications, webhooks)

### Added
- **5 new slash commands** — `/playerinfo`, `/heal`, `/kill`, `/teleport`, `/spawnitem` for admin actions directly from Discord
- **Per-user cooldown system** — Three tiers: query (3s), admin (10s), control (30s) preventing spam
- **Input validation** — Steam64 ID format checking, coordinate validation, workshop ID validation, broadcast message sanitization
- **Markdown escaping** — Player names in embeds escaped to prevent Discord formatting exploits
- **Audit trail attribution** — Every Discord action (start, stop, kick, RCON, mod operations, admin actions) logged with Discord username and user ID
- **Webhook integration** — Kick, mod install/uninstall, and all lifecycle actions now fire webhooks from Discord
- **Multi-server presence** — Bot status rotates through all servers showing aggregate player count
- **Modal builders** — Dedicated modal constructors for broadcast, RCON, player info, kick, teleport, spawn item, mod install, mod actions

### Fixed
- **`Events.ClientReady`** — Bot was silently failing to register the ready handler (was using string `'clientReady'` instead of `Events.ClientReady` enum)
- **Interaction deferral** — All API calls now properly `deferReply()`/`deferUpdate()` before processing, preventing 3-second timeout failures
- **"undefined" responses** — All handlers now fallback to `'Action completed'` instead of showing `undefined`
- **Discord lifecycle bypass** — Start/stop/restart from Discord now uses the same lifecycle as the web panel (was missing hooks, sidecar, firewall, port checks, notifications)

### Security
- **Discord input sanitization** — `sanitize.js` validates all user inputs before they reach the backend
- **Broadcast sanitization** — Control characters stripped, message length capped at 256 characters
- **Cooldown enforcement** — Rate limiting prevents rapid-fire abuse of admin commands
- **Fail-closed admin check** — All admin commands verify role before processing

### Changed
- `server-control.routes.js` — Simplified start/stop routes to delegate to shared `startServer()`/`stopServer()` from `server-lifecycle.js`
- `discord.routes.js` — Rewritten to use shared lifecycle functions, add audit logging on all mutating actions, consume Discord user attribution params

### Removed
- **Deprecated action aliases** — Legacy action aliases removed from `discord.routes.js`

## v2.1.0

_Security Hardening, Console Overhaul, and Live Map Enhancements_

### Added
- **Rich console** — Real-time RPT log streaming via `rpt-tailer.js`, unified with RCON output
- **Live map actions** — Teleport, heal, kill, strip, explode players; vehicle actions; world controls (time, weather, AI/vehicle wipe); spawn items at coordinates
- **Live map markers** — Font Awesome icons for players, vehicles, and map events
- **Windows Firewall management** — Automatic inbound allow rules for game/query/RCON ports with UAC elevation
- **Windows Service** — Install Citadel as a `CitadelServer` Windows Service for auto-start on boot
- **Setup wizard** — Guided 5-step first-run setup (admin account, SteamCMD, server profile)
- **Mod cache** — Downloaded mods cached locally to speed up reinstalls across servers
- **Automated messenger** — Scheduled broadcast messages to players via RCON
- **Concurrent restart guard** — Prevents duplicate restart operations on the same server
- **Vehicle health display** — Normalized 0-100% health bar on live map vehicle markers
- **@CitadelAdmin auto-install** — Server-side mod automatically deployed on server start

### Security
- **Server-scoped authorization** — All map and dangerzone routes now use `authForServer()` instead of `auth()`
- **RCON password stripping** — Server API responses no longer include `rconPassword`
- **XSS prevention** — HTML escaping on player names in Leaflet map markers
- **Mass-assignment protection** — Mod PATCH endpoint restricted to allowlisted fields only
- **PowerShell injection defense** — Server names sanitized before use in firewall rule commands
- **Spawn quantity cap** — Item spawn limited to max 100 in both DayZ mod and sidecar
- **RCON message isolation** — `serverId` added to RCON events to prevent cross-server contamination
- **Targeted player messaging** — `MessagePlayer` uses `RPCSingleParam` instead of broadcast `ChatPlayer`

### Fixed
- **Batch start** — `spawnDayZServer()` return value correctly destructured (was storing object as PID)
- **Server deletion cleanup** — Properly stops sidecar, RPT tailer, and RCON on server removal
- **Mod folder names** — Spaces in mod folder names no longer break DayZ `-mod=` launch parameter
- **Firewall elevation** — Firewall rule creation now uses elevated PowerShell via `Start-Process -Verb RunAs`
- **HealPlayer params** — Standardized to use `ExtractParams` pattern matching other actions

### Changed
- Console page streams RPT log lines in real-time (previously only showed lifecycle events)
- Logs page updates in real-time via Socket.IO (previously required page refresh)
- README and documentation updated with admin requirements, Windows Service setup, and current features

## v2.0.0

_Citadel — Complete Platform Rebuild_

### Breaking Changes
- Rebranded from "DayZ Server Controller" / "DSC" to **Citadel**
- Replaced all third-party API dependencies with the self-hosted **InHouseProvider** system
- New `@CitadelAdmin` DayZ mod replaces `@DSCAdmin`

### Added
- **InHouseProvider** — Full-featured action provider routing through the Citadel Sidecar
- **Citadel Sidecar** — Standalone Node.js server bridging backend API to DayZ server via file-based IPC
- **@CitadelAdmin DayZ Mod** — Server-side EnScript mod with:
  - Command runner (file-based command queue)
  - Player tracker (periodic player snapshots)
  - Event logger (kills, connections, vehicles)
  - Player actions (heal, teleport, spawn, strip, explode)
  - Vehicle actions (delete, repair, refuel, unstuck, explode, engine kill, eject)
  - World actions (time, weather, AI wipe, vehicle wipe)
- **Provider System** — Modular action dispatcher with capability reporting
- **Game file backups** — Automated and manual server file backups with retention policies
- **Live map** — Real-time player positions on the map
- **Role-based access control** — Granular permissions system
- **Multi-server management** — Control multiple DayZ instances from one dashboard
- **VitePress documentation site** — Comprehensive docs with guides and API reference

### Changed
- Complete UI rebrand with Citadel shield logo and indigo/sky-blue color scheme
- PM2 process names standardized to `citadel` and `citadel-bot`
- All file paths use `$profile:Citadel/` directory
- Config files reference Citadel branding throughout

### Removed
- All external third-party API dependencies for core functionality
