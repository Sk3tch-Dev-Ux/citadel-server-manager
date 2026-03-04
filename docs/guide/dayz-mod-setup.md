# DayZ Mod Setup

The `@CitadelAdmin` mod is the in-game component that executes commands, tracks players, and logs events. It is distributed as a pre-built `.pbo` — no compilation or source code required.

## Automatic Installation

**Citadel handles this for you.** The `@CitadelAdmin` mod is automatically installed and kept up-to-date whenever you:

- **Deploy a new server** via the Deploy page or Setup Wizard
- **Start or restart** any managed server
- **Rebuild** a server from the Dangerzone page

The mod is copied from the bundled `@CitadelAdmin/` directory in your Citadel installation to each server's root folder. No manual steps are needed.

## Manual Installation

If you need to install the mod manually (e.g., on a remote machine without Citadel):

### 1. Copy the mod to your DayZ server

Copy the `@CitadelAdmin` folder from your Citadel installation to your DayZ server's root directory:

```
DayZServer/
├── @CitadelAdmin/
│   ├── addons/
│   │   └── CitadelAdmin.pbo
│   └── mod.cpp
├── DayZServer_x64.exe
├── serverDZ.cfg
└── ...
```

### 2. Add the mod to your server launch parameters

Add `@CitadelAdmin` to your `-serverMod` parameter:

```
-serverMod=@CitadelAdmin
```

::: warning Server-Side Only
`@CitadelAdmin` is a **server-side mod**. Players do not need to download it. Use `-serverMod`, not `-mod`, to keep it hidden from clients.
:::

::: tip Citadel handles launch params
If you manage your server through Citadel, the `-serverMod=@CitadelAdmin` parameter is automatically added to your launch configuration. You only need to set this manually for standalone installations.
:::

### 3. Verify the profile directory

On first launch, the mod creates its working directory at:

```
DayZServer/profiles/Citadel/
├── commands/          # Incoming command queue
├── responses/         # Outgoing response queue
├── players.json       # Current player snapshot
└── events.jsonl       # Event log (append-only)
```

## How It Works

### Command Runner

The command runner polls `$profile:Citadel/commands/` every 3 seconds for new JSON command files. When a command is found:

1. Reads and parses the JSON file
2. Dispatches to the appropriate action handler
3. Writes the result to `$profile:Citadel/responses/{id}.json`
4. Deletes the original command file

### Player Tracker

The player tracker writes a snapshot of all connected players to `$profile:Citadel/players.json` at a configurable interval. This powers the Live Map and player list in the Citadel dashboard.

### Event Logger

The event logger appends structured JSON events to `$profile:Citadel/events.jsonl` for:
- Player connections / disconnections
- Player kills and deaths
- Vehicle events
- Admin actions

## Supported Actions

| Action | Description |
|--------|-------------|
| `HealPlayer` | Fully heal a player |
| `KillPlayer` | Kill a player |
| `TeleportPlayer` | Teleport a player to coordinates |
| `SpawnItem` | Spawn an item near a player |
| `StripPlayer` | Remove all gear from a player |
| `ExplodePlayer` | Explode a player |
| `MessagePlayer` | Send a private message to a player |
| `DeleteVehicle` | Delete a vehicle |
| `RepairVehicle` | Repair a vehicle |
| `RefuelVehicle` | Refuel a vehicle |
| `UnstuckVehicle` | Teleport a vehicle up to unstick it |
| `ExplodeVehicle` | Destroy a vehicle |
| `EngineKill` | Kill a vehicle's engine |
| `EjectDriver` | Eject the driver from a vehicle |
| `SetTime` | Change the server time |
| `SetWeather` | Change weather conditions |
| `WipeAI` | Remove all AI from the map |
| `WipeVehicles` | Remove all vehicles from the map |

## Troubleshooting

### Mod not loading

Check your DayZ server RPT log for:
```
[Citadel] CitadelMissionServer initialized
```

If this line is missing, verify:
- The `@CitadelAdmin` folder is in the server's root directory
- The `addons/CitadelAdmin.pbo` file exists inside it
- The `-serverMod` parameter includes `@CitadelAdmin`

### Commands not executing

1. Check that the Sidecar is running and writing files to the correct `$profile:Citadel/commands/` directory
2. Verify file permissions — the DayZ server process needs read/write access to the `profiles/Citadel/` directory
3. Check the RPT log for `[Citadel]` prefixed error messages

### Sidecar connection issues

If the Citadel dashboard shows "Sidecar offline" for a server:
1. Ensure the sidecar is running (`cd sidecar && npm start`)
2. Verify the sidecar URL and API key match in the server's settings
3. Check that the sidecar port (default: 9100) is not blocked
