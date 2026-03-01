# DayZ Mod Setup

The `@CitadelAdmin` mod is the in-game component that executes commands, tracks players, and logs events.

## Installation

### 1. Copy the mod to your DayZ server

Copy the `dayz-mod/@CitadelAdmin` directory to your DayZ server's root folder:

```
DayZServer/
├── @CitadelAdmin/
│   ├── mod.cpp
│   ├── scripts/
│   │   ├── config.cpp
│   │   └── 4_World/
│   │       ├── CitadelCommandRunner.c
│   │       ├── CitadelPlayerTracker.c
│   │       ├── CitadelEventLogger.c
│   │       ├── CitadelMissionServer.c
│   │       ├── CitadelPlayerActions.c
│   │       ├── CitadelVehicleActions.c
│   │       └── CitadelWorldActions.c
│   └── README.js
```

### 2. Add the mod to your server launch parameters

Add `@CitadelAdmin` to your `-mod` parameter:

```
-mod=@CitadelAdmin;@YourOtherMods
```

::: warning Server-Side Only
`@CitadelAdmin` is a **server-side mod**. Players do not need to download it. It should only appear in the server's `-mod` parameter, not in any client mod lists.
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

`CitadelCommandRunner` polls `$profile:Citadel/commands/` every 3 seconds for new JSON command files. When a command is found:

1. Reads and parses the JSON file
2. Dispatches to the appropriate action handler
3. Writes the result to `$profile:Citadel/responses/{id}.json`
4. Deletes the original command file

### Player Tracker

`CitadelPlayerTracker` writes a snapshot of all connected players to `$profile:Citadel/players.json` at a configurable interval.

### Event Logger

`CitadelEventLogger` appends structured JSON events to `$profile:Citadel/events.jsonl` for:
- Player connections / disconnections
- Player kills and deaths
- Vehicle events
- Admin actions

## Supported Actions

| Action | Description |
|--------|-------------|
| `kick` | Kick a player by ID |
| `ban` | Ban a player |
| `message` | Send a global or private message |
| `teleport` | Teleport a player to coordinates |
| `spawn_item` | Spawn an item for a player |
| `heal` | Heal a player |
| `kill` | Kill a player |
| `get_position` | Get a player's position |
| `server_message` | Broadcast to all players |

## Troubleshooting

### Mod not loading

Check your DayZ server RPT log for:
```
[Citadel] CitadelMissionServer initialized
```

If this line is missing, verify:
- The `@CitadelAdmin` folder is in the correct location
- The `-mod` parameter includes `@CitadelAdmin`
- The `config.cpp` is present and valid

### Commands not executing

1. Check that the Sidecar is writing files to the correct `$profile:Citadel/commands/` directory
2. Verify file permissions — the DayZ server process needs read/write access
3. Check the RPT log for `[Citadel]` prefixed error messages
