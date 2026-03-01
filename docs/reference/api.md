# REST API Reference

All API endpoints require authentication via JWT bearer token unless noted otherwise. Obtain a token by logging in via `POST /api/auth/login`.

```
Authorization: Bearer <jwt-token>
```

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Authenticate with username/password. Returns JWT token. Brute-force protection: 5 attempts, 10-min lockout. |

**Request:**
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "1", "username": "admin", "role": "admin" }
}
```

---

## Servers

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers` | Any auth | List all servers with live status, player count, CPU/RAM |
| POST | `/api/servers` | `server.deploy` | Create a new server entry |
| POST | `/api/servers/detect` | `server.deploy` | Detect existing DayZ server from a directory path |
| PATCH | `/api/servers/:id` | `server.deploy` | Update server properties |
| DELETE | `/api/servers/:id` | `server.deploy` | Delete a server entry (must be stopped) |

---

## Server Control

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/status` | Any auth | Full server status: players, uptime, CPU/RAM, map, version |
| POST | `/api/servers/:id/start` | `server.start` | Start the DayZ server process |
| POST | `/api/servers/:id/stop` | `server.stop` | Graceful stop (RCON shutdown → kill process) |
| POST | `/api/servers/:id/restart` | `server.restart` | Restart with up to 3 retries. Fires webhooks |
| POST | `/api/servers/:id/lock` | `server.rcon` | Lock server (prevent new joins) |
| POST | `/api/servers/:id/unlock` | `server.rcon` | Unlock server |

---

## RCON & Players

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/api/servers/:id/rcon` | `server.rcon` | Send raw RCON command. Body: `{ "command": "..." }` |
| POST | `/api/servers/:id/message` | `chat.send` | Broadcast global message. Body: `{ "message": "..." }` |
| GET | `/api/servers/:id/players` | `players.view` | List connected players |
| POST | `/api/servers/:id/players/:playerId/kick` | `players.kick` | Kick a player |
| POST | `/api/servers/:id/players/:playerId/ban` | `players.ban` | Ban a player. Body: `{ "reason": "...", "expiration": "..." }` |
| GET | `/api/servers/:id/bans` | Any auth | List all bans |
| DELETE | `/api/servers/:id/bans/:banId` | `players.ban` | Remove a ban |

---

## Admin Actions (Provider-based)

These actions route through the Provider System (InHouseProvider → Sidecar, or RCON fallback).

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/actions/capabilities` | `server.view` | Get available action types |
| POST | `/api/servers/:id/actions/heal` | `server.rcon` | Heal a player. Body: `{ "steamId": "..." }` |
| POST | `/api/servers/:id/actions/kill` | `server.rcon` | Kill a player |
| POST | `/api/servers/:id/actions/teleport` | `server.rcon` | Teleport. Body: `{ "steamId", "x", "y", "z" }` |
| POST | `/api/servers/:id/actions/spawn-item` | `server.rcon` | Spawn item. Body: `{ "steamId", "itemClass", "quantity" }` |
| POST | `/api/servers/:id/actions/strip` | `server.rcon` | Strip player inventory |
| POST | `/api/servers/:id/actions/explode` | `server.rcon` | Explode a player |
| GET | `/api/servers/:id/actions/player/:steamId` | `players.view` | Detailed player info |

### Vehicle Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/servers/:id/actions/vehicle/delete` | `{ "vehicleId" }` | Delete a vehicle |
| POST | `/api/servers/:id/actions/vehicle/repair` | `{ "vehicleId" }` | Repair a vehicle |
| POST | `/api/servers/:id/actions/vehicle/refuel` | `{ "vehicleId" }` | Refuel a vehicle |
| POST | `/api/servers/:id/actions/vehicle/unstuck` | `{ "vehicleId" }` | Unstuck a vehicle |
| POST | `/api/servers/:id/actions/vehicle/explode` | `{ "vehicleId" }` | Explode a vehicle |

### World Actions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/servers/:id/actions/world/time` | `{ "hour", "minute" }` | Set world time |
| POST | `/api/servers/:id/actions/world/weather` | `{ "overcast", "rain", "fog", "snow", "wind" }` | Set weather (values 0.0–1.0) |
| POST | `/api/servers/:id/actions/world/sunny` | — | Clear weather |
| POST | `/api/servers/:id/actions/world/wipe-ai` | — | Remove all AI entities |
| POST | `/api/servers/:id/actions/world/wipe-vehicles` | — | Remove all vehicles |

---

## Scheduler

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/scheduler` | Any auth | List scheduled jobs |
| POST | `/api/servers/:id/scheduler` | `server.restart` | Create a job (restart/stop, warnings, lock, kick) |
| PUT | `/api/servers/:id/scheduler/:jobId` | `server.restart` | Update a job |
| PATCH | `/api/servers/:id/scheduler/:jobId/toggle` | `server.restart` | Toggle job enabled/disabled |
| DELETE | `/api/servers/:id/scheduler/:jobId` | `server.restart` | Delete a job |

---

## Backups

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/backup-config` | Any auth | Get backup configuration |
| PUT | `/api/servers/:id/backup-config` | `server.restart` | Update backup config (interval, retention, paths) |
| GET | `/api/servers/:id/backups` | Any auth | List all backups |
| POST | `/api/servers/:id/backups` | `server.restart` | Trigger manual backup |
| DELETE | `/api/servers/:id/backups/:filename` | `server.restart` | Delete a backup. Query: `?type=manual|automated` |
| GET | `/api/servers/:id/backups/:filename/download` | `server.restart` | Download backup zip |

### Config Backups

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/backup/:type` | `admin` | Download config backup (servers/users/roles/webhooks) |
| POST | `/api/restore/:type` | `admin` | Restore config from backup JSON |

---

## Mods

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/mods` | `mods.view` | List installed mods |
| POST | `/api/servers/:id/mods/install` | `mods.install` | Install Workshop mod. Body: `{ "workshopId", "name" }` |
| DELETE | `/api/servers/:id/mods/uninstall/:workshopId` | `mods.install` | Uninstall a mod |
| PATCH | `/api/servers/:id/mods/:workshopId` | `mods.install` | Update mod properties (enabled, load order) |

---

## Configuration

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/config` | `server.config` | Read serverDZ.cfg |
| PATCH | `/api/servers/:id/config` | `server.config` | Update serverDZ.cfg fields |

---

## Additional Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/audit` | `admin` | View audit trail |
| GET/POST/DELETE | `/api/webhooks` | `admin` | Manage webhook integrations |
| GET/POST/DELETE | `/api/users` | `admin` | User management |
| GET/POST/DELETE | `/api/roles` | `admin` | Role & permission management |
| GET/POST/DELETE | `/api/watchlist` | Any auth | Player watchlist |
| GET/POST/DELETE | `/api/priority-queue` | Any auth | Priority queue management |
| GET | `/api/killfeed` | Any auth | Kill feed data |
| GET | `/api/leaderboard` | Any auth | Player leaderboard |
| GET | `/api/servers/:id/map/*` | Any auth | Live map data |
