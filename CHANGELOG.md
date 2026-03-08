# Changelog

## v2.0.0 — Command Engine Overhaul (March 2026)

### Overview
Massive expansion of Citadel's in-game command system. This release introduces **103 action types**, a full spawn/world tools interface on the Live Map, and a restructured player management panel — transforming Citadel from a basic server controller into a comprehensive DayZ administration platform.

---

### New Features

#### Live Map — Spawn & World Tools
- **Click-to-Place Spawning** — Select an entity type, click anywhere on the map to spawn it at that exact position. Spawn mode stays active for repeated placement with a visible crosshair cursor and indicator bar.
- **Spawn Entities Panel** — Dropdown selector for Zombies, Animals, Vehicles, Buildings, and Items with type-specific inputs (count, species, class name).
- **World Events** — One-click spawn mode for Heli Crashes, Gas Zones, and Supply Crates at any map position.
- **Area Effects** — Configurable radius controls for Flatten Trees, Clear Zombies, and Delete Objects using the current cursor position. All destructive actions require confirmation.
- **Atmosphere Controls** — Fog density (0–1) and Wind speed (0–20) sliders with instant apply.
- **Extended Weather** — Existing Clear/Overcast/Rain controls remain alongside new atmosphere options.

#### Player Management — Expanded Actions (32 actions)
Reorganized player dropdown menu into labeled groups:

- **Healing** — Heal, Dry, Cure, Force Drink, Force Eat, Stop Bleeding, Wake, Knockout
- **Admin Powers** — God Mode (on/off), Invisible (on/off), Infinite Stamina (on/off)
- **Inventory** — Spawn Item, Fill Magazines, Drop Gear, Clear Inventory, Loot Magnet
- **Movement** — Teleport, Teleport to Player, Freeze, Message
- **Moderation** — Kick, Ban
- **Harmful** — Kill, Explode, Break Legs, Make Sick, Launch, Ragdoll, Respawn

#### In-Game Mod — 22 Query Handlers
New data query system returns structured JSON from the game server:
- **Player Queries** — Position, Info, Gear, Inventory, Stats, Full Profile, Gear Details, Hands Data
- **Server Queries** — Online Players, All Players, Server Info
- **Spatial Queries** — Nearby Vehicles, Vehicle Info, Item Details, Nearby Players, Nearby Loot, Nearby Entities
- **Storage Queries** — Base Objects, Storage Contents, All Storage Objects

#### In-Game Mod — Death Event Tracking
- Tracks PvP kills with killer details, weapon, distance, and body zone
- Handles suicides, environmental deaths, AI kills, and vehicle-related deaths
- Death events written to the event log for sidecar processing

#### In-Game Mod — Static Object Scanner
- Grid-based world scan (10x10 sectors) for configurable map markers
- Registers static objects matching `MapMarkers.json` definitions
- Deferred 30 seconds after mission start to avoid startup overhead

---

### Backend

#### Action System
- **103 ActionType constants** across 10 categories (player, vehicle, world, spawn, structure, item, config, query, ban, server)
- **78 InHouse capabilities** registered for the in-house provider
- **102 human-readable action labels** for UI display
- **78 audit codes** for full admin action logging

#### Sidecar API
- **108 REST endpoints** handling all command types
- Organized by category: `/player/*`, `/vehicle/*`, `/world/*`, `/spawn/*`, `/structure/*`, `/item/*`, `/data/*`, `/bans`, `/config/*`

#### InHouse Provider
- **97 async methods** implementing the full command set
- Each method maps to a sidecar endpoint with proper parameter validation

#### API Routes
- **79 action routes** in `actions.routes.js` with auth, audit logging, and session validation
- **11 map routes** in `map.routes.js` including the new `POST /map/spawn-action` consolidated spawn endpoint
- Extended `world-action` route to dispatch fog, wind, flatten trees, clear zombies, and delete objects

#### Route Action Maps
| Map | Entries |
|-----|---------|
| PLAYER_ACTION_MAP | 27 |
| SPAWN_ACTION_MAP | 15 |
| WORLD_ACTION_MAP | 10 |
| VEHICLE_ACTION_MAP | 8 |

---

### DayZ Mod (`@CitadelAdmin`)

#### Architecture
- **25 script files** across 3 compilation layers (3_Game, 4_World, 5_Mission)
- **~7,500 lines** of Enforce Script
- File-based IPC: sidecar writes `.cmd.json`, mod reads/executes/writes `.res.json`

#### Layer Breakdown
| Layer | Files | Purpose |
|-------|-------|---------|
| 3_Game | 8 | Core singleton, logger, config, JSON utilities, data classes |
| 4_World | 11 | Entity hooks, player/world/vehicle/query action handlers |
| 5_Mission | 6 | Mission lifecycle, command runner, reporter, metrics |

#### Key Systems
- **CitadelCommandRunner** — Command queue processor with 80+ dispatch entries
- **CitadelPlayerHooks** — PlayerBase lifecycle (identity, damage caching, kill processing)
- **CitadelMissionServer** — Connect/disconnect tracking, session duration, stats dump
- **CitadelReporter** — Periodic metrics and player data sync
- **CitadelMapMarkerManager** — JSON-configurable map marker definitions

---

### Frontend

#### LiveMapPage (898 lines)
- Spawn mode state machine with visual indicator bar
- 7 new World Controls sections (Time, Weather, Atmosphere, Spawn Entities, World Events, Area Effects, Danger Zone)
- Map click handler for coordinate-based spawning
- Crosshair cursor when spawn mode is active
- Scrollable panel with `max-height: 60vh`

#### PlayersPage (634 lines)
- 20+ new action handlers with organized dropdown menu
- 7 labeled groups with visual separators
- Confirm dialogs for all destructive actions
- Scrollable dropdown with `max-height: 480px`

#### Icon System
- 8 new icon exports: `TreePine`, `Trees`, `Target`, `MousePointerClick`, `Truck`, `Haze`, `CircleX`, `Flame`

#### CSS
- Spawn mode indicator bar (accent-colored with cancel button)
- Crosshair cursor for spawn mode (`.map-container--spawn-mode`)
- Select dropdown styling for World Controls panel
- Field labels, unit labels, hint text, wide inputs

---

### Technical Notes
- All spawn actions keep spawn mode active for repeated placement — click Cancel or press Escape to exit
- Area effects (flatten trees, clear zombies, delete objects) use the cursor's current map position at the time of clicking the button
- The `map/spawn-action` route is a consolidated endpoint — the frontend sends `{ action, params }` and the backend dispatches to the correct provider method
- Query responses return structured JSON through the `responseData` field in the file-based IPC response
- Death tracking caches hit data in `EEHitBy` and fires the death event in `EEKilled` (matching the GameLabs pattern)
