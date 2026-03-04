# Changelog

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
- **Deprecated GameLabs aliases** — `gameLabsHeal`, `gameLabsKill`, `gameLabsTeleport`, `gameLabsSpawnItem` action aliases removed from `discord.routes.js`

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
- Replaced all third-party API dependencies (CFTools, GameLabs) with the self-hosted **InHouseProvider** system
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
- CFTools API integration
- GameLabs API integration
- All external service dependencies for core functionality
