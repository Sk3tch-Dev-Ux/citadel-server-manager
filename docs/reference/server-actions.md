# Server Actions

Server actions are the standardized operations that can be executed on a DayZ server through the [Provider System](/reference/providers).

## Action Categories

### Player Actions

| Action Type | Parameters | Description |
|-------------|-----------|-------------|
| `heal` | `{ steamId }` | Restore player to full health |
| `kill` | `{ steamId }` | Kill a player |
| `kick` | `{ steamId, reason? }` | Kick a player from the server |
| `ban` | `{ steamId, reason?, duration? }` | Ban a player |
| `teleport` | `{ steamId, x, y, z }` | Teleport player to coordinates |
| `spawn-item` | `{ steamId, itemClass, quantity? }` | Spawn item in player inventory |
| `strip` | `{ steamId }` | Remove all items from player |
| `explode` | `{ steamId }` | Create explosion at player position |
| `unstuck` | `{ steamId }` | Teleport player to terrain surface |
| `freeze` | `{ steamId, frozen }` | Freeze (1) or unfreeze (0) a player |
| `message` | `{ steamId, message }` | Send a direct in-game message |
| `teleport-to-player` | `{ steamId, targetSteamId }` | Teleport player to another player |
| `loadout` | `{ steamId }` | Retrieve player's full inventory |

### Vehicle Actions

| Action Type | Parameters | Description |
|-------------|-----------|-------------|
| `vehicle/delete` | `{ vehicleId }` | Remove vehicle from world |
| `vehicle/repair` | `{ vehicleId }` | Fully repair vehicle |
| `vehicle/refuel` | `{ vehicleId }` | Fill vehicle fuel tank |
| `vehicle/unstuck` | `{ vehicleId }` | Teleport vehicle slightly upward |
| `vehicle/explode` | `{ vehicleId }` | Destroy vehicle with explosion |
| `vehicle/kill-engine` | `{ vehicleId }` | Kill the vehicle engine |
| `vehicle/eject-driver` | `{ vehicleId }` | Force eject the driver |
| `vehicle/teleport` | `{ vehicleId, x, y, z }` | Teleport vehicle to coordinates |

### World Actions

| Action Type | Parameters | Description |
|-------------|-----------|-------------|
| `world/time` | `{ hour, minute }` | Set server time (0–23, 0–59) |
| `world/weather` | `{ overcast?, rain?, fog?, snow?, wind? }` | Set weather parameters (0.0–1.0) |
| `world/sunny` | — | Clear all weather conditions |
| `world/wipe-ai` | — | Remove all AI entities |
| `world/wipe-vehicles` | — | Remove all vehicles |

### Config Actions

| Action Type | Parameters | Description |
|-------------|-----------|-------------|
| `config/reload` | — | Reload mod configuration without restart |

## Provider Capability Matrix

| Action Category | InHouseProvider | RCONProvider |
|----------------|-----------------|--------------|
| Player heal/kill/teleport/spawn | ✅ | ❌ |
| Player unstuck/freeze/strip/explode | ✅ | ❌ |
| Player teleport-to-player | ✅ | ❌ |
| Player loadout (read-only) | ✅ | ❌ |
| Player kick/ban | ✅ | ✅ |
| Vehicle actions (incl. teleport) | ✅ | ❌ |
| World actions | ✅ | ❌ |
| Config reload | ✅ | ❌ |
| Detailed player info | ✅ | ❌ |
| Raw RCON commands | ❌ | ✅ |
| Send message | ✅ | ✅ |

## Audit Trail

All actions are automatically logged to the audit trail with:
- Who performed the action (user ID, username)
- What action was performed
- Target (player, vehicle, etc.)
- Timestamp
- Result (success/failure)

View the audit trail via `GET /api/audit` or in the Dashboard under **Audit Log**.
