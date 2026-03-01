# Changelog

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
