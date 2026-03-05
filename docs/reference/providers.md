# Provider System

The provider system is Citadel's core abstraction for dispatching actions to DayZ servers. It decouples the backend API from the transport mechanism used to communicate with the game server.

## Overview

When the backend needs to execute a server action (kick a player, teleport, set weather, etc.), it delegates to the **provider chain**. Each provider implements the same interface, and the system tries providers in priority order until one succeeds.

```
Backend API Request
       │
       ▼
┌──────────────┐
│   Executor   │ ← Routes action to the right provider
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  InHouse     │ ──→ │    RCON      │
│  Provider    │     │   Provider   │
│  (primary)   │     │  (fallback)  │
└──────────────┘     └──────────────┘
```

## Provider Interface

All providers extend `BaseProvider`:

```javascript
class BaseProvider {
  constructor(serverId, config) { }

  // Core methods
  async executeAction(actionType, params) { }
  async getPlayers() { }
  async getServerInfo() { }

  // Capability reporting
  getCapabilities() {
    return {
      playerActions: false,
      vehicleActions: false,
      worldActions: false,
      detailedPlayers: false,
    };
  }
}
```

## Available Providers

### InHouseProvider

**Transport:** HTTP → Sidecar → File IPC → DayZ Mod

The primary provider with full feature support. Communicates with the Citadel Sidecar via HTTP, which translates requests into file-based commands for the `@CitadelAdmin` mod.

**Capabilities:**
- Player actions (heal, kill, teleport, spawn items, strip, explode, unstuck, freeze, message, teleport to player, view loadout)
- Vehicle actions (delete, repair, refuel, unstuck, explode, kill engine, eject driver, teleport)
- World actions (time, weather, wipe AI, wipe vehicles)
- Config actions (live reload)
- Detailed player info (stats, position, playtime)
- Ban management
- Priority queue

**Configuration:**
```ini
INHOUSE_SIDECAR_URL=http://localhost:9100
INHOUSE_API_KEY=your-secret-key
```

### RCONProvider

**Transport:** BattlEye RCON protocol (UDP)

A fallback provider that uses the standard BattlEye RCON protocol. Supports basic commands only.

**Capabilities:**
- Kick players
- Ban players
- Send messages
- Lock/unlock server
- Raw RCON commands

**Configuration:**
```ini
# Configured per-server in the server profile
RCON_HOST=127.0.0.1
RCON_PORT=2302
RCON_PASSWORD=your-rcon-password
```

## Provider Chain

Providers are configured per-server and evaluated in order. The executor tries each provider until one reports it can handle the requested action:

```javascript
// Simplified provider resolution
for (const provider of server.providers) {
  const caps = provider.getCapabilities();
  if (caps[actionCategory]) {
    return await provider.executeAction(actionType, params);
  }
}
```

This means you can run InHouseProvider as the primary and RCONProvider as the fallback — if the sidecar is down, basic commands still work via RCON.

## Action Types

See [Server Actions](/reference/server-actions) for the complete list of action types and their parameters.
