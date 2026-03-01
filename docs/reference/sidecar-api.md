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

## Player Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/player/heal` | `{ "steamId": "76561..." }` | Heal player to full health |
| POST | `/player/kill` | `{ "steamId": "76561..." }` | Kill a player |
| POST | `/player/teleport` | `{ "steamId", "x", "y", "z" }` | Teleport player to coordinates |
| POST | `/player/spawnItem` | `{ "steamId", "itemClass", "quantity" }` | Spawn item in player inventory |
| POST | `/player/strip` | `{ "steamId": "76561..." }` | Strip all inventory |
| POST | `/player/explode` | `{ "steamId": "76561..." }` | Explode a player |
| POST | `/player/kick` | `{ "steamId", "reason" }` | Kick player with reason |
| POST | `/player/ban` | `{ "steamId", "reason", "duration" }` | Ban a player |
| GET | `/player/details?steamId=76561...` | — | Get player details, stats, position |

---

## Vehicle Actions

All vehicle actions use the same pattern:

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/vehicle/delete` | `{ "vehicleId": "..." }` | Delete a vehicle |
| POST | `/vehicle/repair` | `{ "vehicleId": "..." }` | Repair a vehicle |
| POST | `/vehicle/refuel` | `{ "vehicleId": "..." }` | Refuel a vehicle |
| POST | `/vehicle/unstuck` | `{ "vehicleId": "..." }` | Unstuck a vehicle |
| POST | `/vehicle/explode` | `{ "vehicleId": "..." }` | Explode a vehicle |
| POST | `/vehicle/kill-engine` | `{ "vehicleId": "..." }` | Kill vehicle engine |
| POST | `/vehicle/eject-driver` | `{ "vehicleId": "..." }` | Eject the driver |

---

## World Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/world/time` | `{ "hour": 12, "minute": 0 }` | Set world time |
| POST | `/world/weather` | `{ "overcast", "rain", "fog", "snow", "wind" }` | Set weather (values 0.0–1.0) |
| POST | `/world/sunny` | — | Clear all weather |
| POST | `/world/wipe-ai` | — | Remove all AI entities |
| POST | `/world/wipe-vehicles` | — | Remove all vehicles |
| POST | `/world/spawn-item` | `{ "itemClass", "x", "y", "z" }` | Spawn item at world coordinates |

---

## Ban Management

| Method | Path | Body/Params | Description |
|--------|------|-------------|-------------|
| GET | `/bans` | — | List all bans |
| POST | `/bans` | `{ "steamId", "name", "reason", "expiration" }` | Add a ban |
| DELETE | `/bans/:id` | — | Remove a ban by ID |
| GET | `/bans/check/:steamId` | — | Check if a Steam ID is banned |

---

## Players & Stats

| Method | Path | Description |
|--------|------|-------------|
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
