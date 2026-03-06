# Architecture

Citadel uses a layered architecture where each component has a clear responsibility and communication boundary.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Web Dashboard                        │
│                  (React + Vite SPA)                       │
│              Socket.IO + REST API calls                   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                    Citadel Backend                        │
│                 (Node.js + Express)                       │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐ │
│  │ Scheduler │  │  RCON    │  │    Provider System     │ │
│  │  Engine   │  │  Client  │  │  ┌────────────────┐   │ │
│  └──────────┘  └──────────┘  │  │ InHouseProvider │   │ │
│                               │  │ RCONProvider    │   │ │
│  ┌──────────┐  ┌──────────┐  │  └────────────────┘   │ │
│  │  Backup  │  │   Mod    │  └────────────────────────┘ │
│  │  Engine  │  │ Manager  │                              │
│  └──────────┘  └──────────┘                              │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP (InHouseProvider)
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  Citadel Sidecar                         │
│              (Node.js + Express :9100)                    │
│                                                          │
│  Writes commands → $profile:Citadel/commands/            │
│  Reads responses ← $profile:Citadel/responses/           │
│  Watches players ← $profile:Citadel/players.json         │
│  Streams events  ← $profile:Citadel/events.jsonl         │
└───────────────────────┬─────────────────────────────────┘
                        │ File-based IPC
                        ▼
┌─────────────────────────────────────────────────────────┐
│                @CitadelAdmin DayZ Mod                    │
│                    (EnScript)                             │
│                                                          │
│  CitadelCommandRunner  — polls & executes commands       │
│  CitadelPlayerTracker  — writes player snapshots         │
│  CitadelEventLogger    — logs kills, connections, etc.   │
│  CitadelMissionServer  — mod lifecycle hooks             │
└─────────────────────────────────────────────────────────┘
```

## Communication Flow

### Command Execution (e.g., "kick player")

1. **Dashboard** sends `POST /api/actions/execute` to Backend
2. **Backend** routes through the **Provider System**, selecting `InHouseProvider`
3. **InHouseProvider** sends `POST http://sidecar:9100/api/commands` to Sidecar
4. **Sidecar** writes a JSON command file to `$profile:Citadel/commands/{id}.json`
5. **@CitadelAdmin mod** picks up the file, executes the action, writes a response to `$profile:Citadel/responses/{id}.json`
6. **Sidecar** watches for the response file, reads it, and returns the result via HTTP
7. **Backend** relays the result back to the Dashboard via REST + Socket.IO

### Player Data Flow

1. **@CitadelAdmin mod** writes `$profile:Citadel/players.json` every few seconds
2. **Sidecar** watches the file with Chokidar and caches the latest state
3. **Backend** polls `GET http://sidecar:9100/api/players` on an interval
4. **Dashboard** receives real-time updates via Socket.IO

### Event Streaming

1. **@CitadelAdmin mod** appends events (kills, connections, etc.) to `$profile:Citadel/events.jsonl`
2. **Sidecar** tails the file and exposes events via `GET /api/events`
3. **Backend** polls or streams events and broadcasts to connected clients

## Provider System

The provider system is the core abstraction for executing server actions. Each provider implements the same interface:

```javascript
class BaseProvider {
  async executeAction(serverId, actionType, params) { }
  async getPlayers(serverId) { }
  async getServerInfo(serverId) { }
}
```

Available providers:

| Provider | Transport | Use Case |
|----------|-----------|----------|
| `InHouseProvider` | HTTP → Sidecar → File IPC | Full feature set — commands, players, events, vehicle management |
| `RCONProvider` | BattlEye RCON protocol | Basic commands when Sidecar is not available |

Providers are configured per-server and can be stacked. The system tries each provider in priority order until one succeeds.

## Data Storage

Citadel uses a JSON file-based data store (no database required):

```
data/
├── servers.json       # Server profiles and configuration
├── users.json         # User accounts and roles
├── bans.json          # Global ban database (UUID IDs, synced to ban.txt)
├── audit.json         # Action audit trail
├── webhooks.json      # Webhook configurations
├── leaderboard.json   # Player leaderboard cache
└── setup_complete.json
```

This makes Citadel portable and easy to back up — just copy the `data/` directory.
