# Sidecar API Reference

The Citadel Sidecar is a lightweight Node.js server that runs alongside the DayZ dedicated server. It translates HTTP API calls into file-based commands that the `@CitadelAdmin` mod can execute.

**Default port:** `9100`

## Authentication

All endpoints require an API key passed in the `X-API-Key` header:

```
X-API-Key: your-sidecar-api-key
```

Configure the key via the `INHOUSE_API_KEY` environment variable on both the backend and sidecar.

---

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns sidecar version, uptime, and queue directory |

**Response:**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "uptime": 86400,
  "queueDir": "C:\\DayZServer\\profiles\\Citadel"
}
```

---

## Player Actions — Core

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/player/heal` | `{ "steamId": "76561..." }` | Heal player to full health |
| POST | `/player/kill` | `{ "steamId": "76561..." }` | Kill a player |
| POST | `/player/teleport` | `{ "steamId", "x", "y", "z" }` | Teleport player to coordinates |
| POST | `/player/spawnItem` | `{ "steamId", "itemClass", "quantity" }` | Spawn item in player inventory |
| POST | `/player/strip` | `{ "steamId": "76561..." }` | Strip all inventory |
| POST | `/player/explode` | `{ "steamId": "76561..." }` | Explode a player |
| POST | `/player/unstuck` | `{ "steamId": "76561..." }` | Teleport player to terrain surface |
| POST | `/player/freeze` | `{ "steamId", "frozen": 1 }` | Freeze (1) or unfreeze (0) a player |
| POST | `/player/message` | `{ "steamId", "message" }` | Send a direct in-game message |
| POST | `/player/teleportToPlayer` | `{ "steamId", "targetSteamId" }` | Teleport player to another player |
| GET | `/player/loadout?steamId=76561...` | — | Get player's full inventory (items, qty, health) |
| POST | `/player/kick` | `{ "steamId", "reason" }` | Kick player with reason |
| POST | `/player/ban` | `{ "steamId", "reason", "duration" }` | Ban a player |

---

## Player Actions — Health/Status

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/player/dry` | `{ "steamId": "76561..." }` | Dry out a player |
| POST | `/player/breakLegs` | `{ "steamId": "76561..." }` | Break player's legs |
| POST | `/player/makeSick` | `{ "steamId": "76561...", "diseaseType": "..." }` | Induce disease in player |
| POST | `/player/cure` | `{ "steamId": "76561..." }` | Cure all diseases |
| POST | `/player/setBloodType` | `{ "steamId": "76561...", "bloodType": "O+" }` | Set blood type |
| POST | `/player/forceDrink` | `{ "steamId": "76561..." }` | Force player to drink |
| POST | `/player/forceEat` | `{ "steamId": "76561..." }` | Force player to eat |
| POST | `/player/knockout` | `{ "steamId": "76561..." }` | Knock player unconscious |
| POST | `/player/wake` | `{ "steamId": "76561..." }` | Wake up unconscious player |
| POST | `/player/setBleeding` | `{ "steamId": "76561...", "sourceCount": 1 }` | Cause bleeding |
| POST | `/player/stopBleeding` | `{ "steamId": "76561..." }` | Stop all bleeding |

---

## Player Actions — Ability/State

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/player/dropGear` | `{ "steamId": "76561..." }` | Force drop all gear |
| POST | `/player/launch` | `{ "steamId": "76561...", "power": 10, "angle": 45 }` | Launch player into air |
| POST | `/player/setStat` | `{ "steamId": "76561...", "stat": "...", "value": ... }` | Set arbitrary stat |
| POST | `/player/ragdoll` | `{ "steamId": "76561...", "duration": 5 }` | Ragdoll for duration (seconds) |
| POST | `/player/setGodmode` | `{ "steamId": "76561..." }` | Enable godmode |
| POST | `/player/removeGodmode` | `{ "steamId": "76561..." }` | Disable godmode |
| POST | `/player/setInvisible` | `{ "steamId": "76561..." }` | Make player invisible |
| POST | `/player/removeInvisible` | `{ "steamId": "76561..." }` | Remove invisibility |
| POST | `/player/setStaminaInfinite` | `{ "steamId": "76561..." }` | Enable infinite stamina |
| POST | `/player/removeStaminaInfinite` | `{ "steamId": "76561..." }` | Disable infinite stamina |
| POST | `/player/respawn` | `{ "steamId": "76561..." }` | Respawn player at spawn point |
| POST | `/player/clearInventory` | `{ "steamId": "76561..." }` | Clear all inventory items |
| POST | `/player/fillMagazines` | `{ "steamId": "76561..." }` | Fill all magazines to full |

---

## Player Query Actions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/player/position?steamId=76561...` | Get player position (x, y, z) |
| GET | `/player/info?steamId=76561...` | Get player info (name, status, health) |
| GET | `/player/gear?steamId=76561...` | Get equipped gear/clothing |
| GET | `/player/inventory?steamId=76561...` | Get inventory items and quantities |
| GET | `/player/stats?steamId=76561...` | Get player stats (blood, energy, water, etc.) |
| GET | `/player/full?steamId=76561...` | Get complete player data |
| GET | `/player/gearFull?steamId=76561...` | Get full gear details with condition |
| GET | `/player/handsData?steamId=76561...` | Get what player is currently holding |
| GET | `/player/details?steamId=76561...` | Get historical stats, names, playtime |

---

## Vehicle Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/vehicle/delete` | `{ "vehicleId": "..." }` | Delete a vehicle |
| POST | `/vehicle/repair` | `{ "vehicleId": "..." }` | Repair a vehicle |
| POST | `/vehicle/refuel` | `{ "vehicleId": "..." }` | Refuel a vehicle |
| POST | `/vehicle/unstuck` | `{ "vehicleId": "..." }` | Unstuck a vehicle |
| POST | `/vehicle/explode` | `{ "vehicleId": "..." }` | Explode a vehicle |
| POST | `/vehicle/kill-engine` | `{ "vehicleId": "..." }` | Kill vehicle engine |
| POST | `/vehicle/eject-driver` | `{ "vehicleId": "..." }` | Eject the driver |
| POST | `/vehicle/teleport` | `{ "vehicleId", "x", "y", "z" }` | Teleport vehicle to coordinates |

---

## World Actions — Extended

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/world/time` | `{ "hour": 12, "minute": 0 }` | Set world time |
| POST | `/world/weather` | `{ "overcast": 0.5, "rain": 0.0, "fog": 0.2, "snow": 0.0, "wind": 0.3 }` | Set weather (values 0.0–1.0) |
| POST | `/world/sunny` | — | Clear all weather |
| POST | `/world/wipe-ai` | — | Remove all AI entities |
| POST | `/world/wipe-vehicles` | — | Remove all vehicles |
| POST | `/world/spawn-item` | `{ "itemClass": "...", "x": 0, "y": 0, "z": 0 }` | Spawn item at world coordinates |
| POST | `/world/set-fog` | `{ "density": 0.5 }` | Set fog density |
| POST | `/world/set-wind` | `{ "speed": 0.5, "direction": 180 }` | Set wind speed and direction |
| POST | `/world/flatten-trees` | `{ "steamId": "76561..." or "coords": [x, y, z], "radius": 50 }` | Flatten trees in radius |
| POST | `/world/clear-zombies` | `{ "steamId": "76561..." or "coords": [x, y, z], "radius": 100 }` | Clear zombies in radius |
| POST | `/world/delete-objects-radius` | `{ "steamId": "76561..." or "coords": [x, y, z], "radius": 50, "objectType": "..." }` | Delete objects in radius |

---

## Spawn Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/spawn/zombie` | `{ "steamId": "76561...", "count": 5, "coords": [x, y, z] }` | Spawn zombies near player |
| POST | `/spawn/animal` | `{ "steamId": "76561...", "animalType": "deer", "coords": [x, y, z] }` | Spawn animal near player |
| POST | `/spawn/vehicle` | `{ "steamId": "76561...", "vehicleClass": "SUV_Blue", "coords": [x, y, z] }` | Spawn vehicle near player |
| POST | `/spawn/building` | `{ "steamId": "76561...", "buildingClass": "...", "coords": [x, y, z] }` | Spawn building near player |
| POST | `/spawn/horde` | `{ "steamId": "76561...", "count": 50 }` | Spawn zombie horde near player |
| POST | `/spawn/supply-crate` | `{ "crateType": "military", "coords": [x, y, z] }` | Spawn supply crate at coordinates |
| POST | `/spawn/loot-pile` | `{ "steamId": "76561...", "lootType": "...", "coords": [x, y, z] }` | Spawn loot pile near player |
| POST | `/spawn/item-attached` | `{ "steamId": "76561...", "itemClass": "M4A1", "attachments": ["RIS", "ACO"] }` | Spawn item with attachments |
| POST | `/spawn/item-at` | `{ "itemClass": "Syringe", "coords": [x, y, z] }` | Spawn item at coordinates |
| POST | `/spawn/zombie-at` | `{ "count": 10, "coords": [x, y, z] }` | Spawn zombies at coordinates |
| POST | `/spawn/animal-at` | `{ "animalType": "boar", "coords": [x, y, z] }` | Spawn animal at coordinates |
| POST | `/spawn/fire` | `{ "steamId": "76561...", "fireType": "campfire", "coords": [x, y, z] }` | Spawn fire near player |
| POST | `/spawn/smoke` | `{ "steamId": "76561...", "color": "white", "coords": [x, y, z] }` | Spawn smoke near player |
| POST | `/spawn/heli-crash` | `{ "heliType": "Mi-8", "coords": [x, y, z] }` | Spawn helicopter crash at coordinates |
| POST | `/spawn/gas-zone` | `{ "zoneType": "poison", "coords": [x, y, z] }` | Spawn gas zone at coordinates |

---

## Structure Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/structure/open-doors` | `{ "steamId": "76561...", "radius": 50 }` | Open all doors in radius |
| POST | `/structure/close-doors` | `{ "steamId": "76561...", "radius": 50 }` | Close all doors in radius |
| POST | `/structure/loot-magnet` | `{ "steamId": "76561...", "radius": 100 }` | Auto-loot containers in radius |

---

## Item Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/item/delete` | `{ "persistentId": "..." }` | Delete an item |
| POST | `/item/repair` | `{ "persistentId": "..." }` | Repair an item |

---

## Data Queries

| Method | Path | Description |
|--------|------|-------------|
| GET | `/data/online-players` | List all online players |
| GET | `/data/all-players` | List all players (online and offline) |
| GET | `/data/server-info` | Get server information |
| GET | `/data/nearby-vehicles?steamId=76561...&radius=500` | Get nearby vehicles |
| GET | `/data/vehicle-info?steamId=76561...&radius=500` | Get vehicle details |
| GET | `/data/item-details?persistentId=...` | Get item details |
| GET | `/data/base-objects?steamId=76561...&radius=500` | Get base objects in radius |
| GET | `/data/storage-contents?persistentId=...` | Get storage container contents |
| GET | `/data/all-storage-objects` | Get all storage objects on map |
| GET | `/data/nearby-players?steamId=76561...&radius=500` | Get nearby players |
| GET | `/data/nearby-loot?steamId=76561...&radius=500&limit=50` | Get nearby loot |
| GET | `/data/nearby-entities?steamId=76561...&radius=500` | Get nearby entities |
| GET | `/data/nearby-entities-at?coords=0,0,0&radius=500` | Get entities at coordinates |
| GET | `/data/nearby-loot-at?coords=0,0,0&radius=500` | Get loot at coordinates |

---

## Config Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/config/reload` | — | Reload mod configuration at runtime |

---

## Ban Management

| Method | Path | Body/Params | Description |
|--------|------|-------------|-------------|
| GET | `/bans` | — | List all bans |
| POST | `/bans` | `{ "steamId", "name", "reason", "expiration" }` | Add a ban |
| DELETE | `/bans/:id` | — | Remove a ban by ID |
| GET | `/bans/check/:steamId` | — | Check if a Steam ID is banned |

---

## Metrics & Data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/metrics` | Get game metrics data |
| GET | `/vehicles` | Get vehicle data |
| GET | `/world-events` | Get world event data |
| GET | `/players` | List currently connected players |
| GET | `/leaderboard?limit=100` | Player leaderboard |
| GET | `/stats/:steamId` | Detailed stats for a player |

---

## Priority Queue

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/priority-queue` | — | List priority queue entries |
| POST | `/priority-queue` | `{ "steamId", "name", "role", "expiration" }` | Add entry |
| DELETE | `/priority-queue/:id` | — | Remove entry |

---

## Command Flow

When the sidecar receives an action request:

1. Generates a unique command ID
2. Writes a JSON file to `$profile:Citadel/commands/{id}.json`:
   ```json
   {
     "id": "cmd-abc123",
     "action": "heal",
     "params": { "steamId": "76561198012345678" },
     "timestamp": 1700000000000
   }
   ```
3. Watches for `$profile:Citadel/responses/{id}.json`
4. Returns the response content when the mod writes it (or times out after 10s)
