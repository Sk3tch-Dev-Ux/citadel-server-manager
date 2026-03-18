# REST API Reference

All API endpoints require authentication via JWT bearer token unless noted otherwise. Obtain a token by logging in via `POST /api/auth/login`.

```
Authorization: Bearer <jwt-token>
```

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Authenticate with username/password. Returns JWT token. Brute-force protection: 5 attempts, 10-min lockout. |
| POST | `/api/auth/mfa/setup` | Required | Setup MFA for account |
| POST | `/api/auth/mfa/verify` | Required | Verify MFA code |
| POST | `/api/auth/mfa/disable` | Required | Disable MFA |
| POST | `/api/auth/change-password-forced` | Required | Force password change |

**Request (login):**
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response (login):**
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
| POST | `/api/servers` | `server.deploy` | Create a new server entry (name, installDir required; validates DayZ binary exists) |
| POST | `/api/servers/detect` | `server.deploy` | Detect existing DayZ server in directory |
| PATCH | `/api/servers/:id` | `server.deploy` | Update server properties |
| DELETE | `/api/servers/:id` | `server.deploy` | Delete a server entry (must be stopped) |
| POST | `/api/servers/batch` | `server.deploy` | Batch start/stop/restart |

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
| POST | `/api/servers/:id/update` | `server.deploy` | Trigger manual update |
| GET | `/api/servers/:id/update/status` | Any auth | Get update state |
| POST | `/api/servers/:id/update/cancel` | `server.deploy` | Cancel update |

---

## RCON & Players

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/api/servers/:id/rcon` | `server.rcon` | Send raw RCON command. Body: `{ "command": "..." }` |
| POST | `/api/servers/:id/message` | `chat.send` | Broadcast global message. Body: `{ "message": "..." }` |
| GET | `/api/servers/:id/players` | `players.view` | List online players |
| POST | `/api/servers/:id/players/:playerId/kick` | `players.kick` | Kick player. Body: `{ "reason": "..." }` |
| POST | `/api/servers/:id/players/:playerId/ban` | `players.ban` | Ban player via global ban database. Body: `{ "reason": "...", "expiration": "..." }` |

---

## Admin Actions

These actions route through the Provider System (InHouseProvider → Sidecar, or RCON fallback).

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/actions/capabilities` | `server.view` | Get available actions |
| POST | `/api/servers/:id/actions/heal` | `server.rcon` | Heal a player. Body: `{ "steamId": "..." }` |
| POST | `/api/servers/:id/actions/kill` | `server.rcon` | Kill player |
| POST | `/api/servers/:id/actions/teleport` | `server.rcon` | Teleport player. Body: `{ "steamId", "x", "y", "z" }` |
| POST | `/api/servers/:id/actions/spawn-item` | `server.rcon` | Spawn item. Body: `{ "steamId", "itemClass", "quantity" }` |
| POST | `/api/servers/:id/actions/unstuck` | `server.rcon` | Unstuck player |
| POST | `/api/servers/:id/actions/freeze` | `server.rcon` | Freeze/unfreeze player |
| POST | `/api/servers/:id/actions/strip` | `server.rcon` | Strip inventory |
| POST | `/api/servers/:id/actions/explode` | `server.rcon` | Explode player |
| POST | `/api/servers/:id/actions/message` | `server.rcon` | Send message to player |
| GET | `/api/servers/:id/actions/player/:steamId` | `players.view` | Player details |

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

## Global Ban Database

Centralized ban system with UUID-based shareable ban IDs. Bans apply to all servers and are automatically synced to each server's `ban.txt` on start/restart.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/bans` | `bans.manage` | List all bans in the global database |
| POST | `/api/bans` | `bans.manage` | Add a manual ban. Body: `{ "steamId", "playerName", "reason", "expiresAt" }` |
| DELETE | `/api/bans/:id` | `bans.manage` | Remove a ban by UUID. Cleans all server `ban.txt` files |
| GET | `/api/bans/:id` | `bans.manage` | Get a single ban by UUID |
| GET | `/api/bans/export` | `bans.manage` | Export all bans as a downloadable JSON file |
| POST | `/api/bans/import` | `bans.manage` | Import bans from a JSON array. Returns `{ added, skipped, errors, total }` |

**Import format** (POST body is a JSON array):
```json
[
  {
    "steamId": "76561198012345678",
    "playerName": "PlayerName",
    "reason": "Cheating",
    "bannedBy": "admin",
    "bannedAt": "2026-03-05T12:00:00.000Z"
  }
]
```

**Export response** (download as `citadel-bans-YYYY-MM-DD.json`):
```json
[
  {
    "id": "a1b2c3d4-...",
    "steamId": "76561198012345678",
    "playerName": "PlayerName",
    "reason": "Cheating",
    "bannedBy": "admin",
    "bannedAt": "2026-03-05T12:00:00.000Z",
    "source": "manual"
  }
]
```

---

## Mods

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/mods` | `mods.view` | List installed mods |
| POST | `/api/servers/:id/mods/install` | `mods.install` | Install mod (workshopId). Body: `{ "workshopId", "name" }` |
| DELETE | `/api/servers/:id/mods/uninstall/:workshopId` | `mods.install` | Uninstall mod |
| PATCH | `/api/servers/:id/mods/:workshopId` | `mods.install` | Update mod properties (enabled, load order) |
| PATCH | `/api/servers/:id/mods/:modName/type` | `mods.install` | Set mod type (client/server) |
| POST | `/api/servers/:id/mods/reorder` | `mods.install` | Reorder load priority |
| POST | `/api/servers/:id/mods/check-updates` | `mods.install` | Check for updates |
| POST | `/api/servers/:id/mods/update/:workshopId` | `mods.install` | Update single mod |
| POST | `/api/servers/:id/mods/update-all` | `mods.install` | Update all mods |
| GET | `/api/servers/:id/mods/updates` | `mods.view` | Get pending updates |
| DELETE | `/api/servers/:id/mods/updates/:workshopId` | `mods.install` | Clear pending update |
| GET | `/api/mods/install-status` | `mods.view` | Get install progress |
| GET | `/api/mods/cache/stats` | `admin` | Cache statistics |
| POST | `/api/mods/cache/clean` | `admin` | Clean cache |

---

## Configuration

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/config` | `server.config` | Read serverDZ.cfg |
| PATCH | `/api/servers/:id/config` | `server.config` | Update serverDZ.cfg |
| GET | `/api/servers/:id/config/templates` | `server.config` | List templates |
| POST | `/api/servers/:id/config/templates` | `server.config` | Save template |
| POST | `/api/servers/:id/config/templates/:templateId/restore` | `server.config` | Restore from template |
| DELETE | `/api/servers/:id/config/templates/:templateId` | `server.config` | Delete template |

---

## Backups

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/backups` | Any auth | List all backups |
| POST | `/api/servers/:id/backups` | `server.restart` | Trigger manual backup |
| DELETE | `/api/servers/:id/backups/:filename` | `server.restart` | Delete backup. Query: `?type=manual|automated` |
| GET | `/api/servers/:id/backups/:filename/download` | `server.restart` | Download backup zip |
| POST | `/api/servers/:id/backups/:filename/restore` | `server.restart` | Restore backup |
| GET | `/api/servers/:id/backups/:filename/contents` | `server.restart` | Preview backup contents |
| GET | `/api/servers/:id/backup-config` | Any auth | Get backup configuration |
| PUT | `/api/servers/:id/backup-config` | `server.restart` | Update backup config (interval, retention, paths) |

### Config Backups

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/backup/:type` | `admin` | Download config backup (servers/users/roles/webhooks) |
| POST | `/api/restore/:type` | `admin` | Restore config from backup JSON |

---

## Deployment & Dangerzone

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/api/deploy` | `server.deploy` | Deploy new server via SteamCMD |
| POST | `/api/servers/:id/rebuild` | `server.deploy` | Rebuild server |
| GET | `/api/servers/:id/dangerzone/wipe-presets` | `admin` | Wipe presets |
| POST | `/api/servers/:id/dangerzone/wipe` | `admin` | Execute wipe |
| GET | `/api/servers/:id/dangerzone/logs-scan` | `admin` | Scan logs |
| POST | `/api/servers/:id/dangerzone/clear-logs` | `admin` | Clear logs |
| POST | `/api/servers/:id/dangerzone/replicate-preview` | `admin` | Preview replication |
| POST | `/api/servers/:id/dangerzone/replicate` | `admin` | Execute replication |

---

## Files

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/files` | `server.config` | List files |
| GET | `/api/servers/:id/files/read` | `server.config` | Read file |
| PUT | `/api/servers/:id/files/write` | `server.config` | Write file |

---

## Items & Types Editor

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/items` | `server.config` | List items from types.xml |
| GET | `/api/servers/:id/types/files` | `server.config` | List types files |
| GET | `/api/servers/:id/types/items` | `server.config` | Load types items |
| GET | `/api/servers/:id/types/limits` | `server.config` | Load limits |
| PUT | `/api/servers/:id/types/save` | `server.config` | Save items |
| POST | `/api/servers/:id/types/add` | `server.config` | Add item |
| DELETE | `/api/servers/:id/types/item` | `server.config` | Delete item |

---

## Logs & Metrics

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/servers/:id/logs` | `server.view` | Get server logs |
| GET | `/api/servers/:id/console` | `server.view` | Get console output |
| GET | `/api/servers/:id/metrics` | `server.view` | Get metrics history |

---

## Priority Queue (VIP)

Automated VIP system that syncs entries to DayZ's native `priority.txt` file. Players in the queue get priority position in the login queue. Entries support time-limited expiration and are automatically cleaned every 60 seconds.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/priority-queue` | `priority.manage` | List entries |
| POST | `/api/priority-queue` | `priority.manage` | Add entry. Body: `{ "steamId", "name", "role", "expiresAt" }` |
| PATCH | `/api/priority-queue/:id` | `priority.manage` | Update entry. Body: `{ "name", "role", "expiresAt" }` |
| DELETE | `/api/priority-queue/:id` | `priority.manage` | Remove entry. Cleans all server `priority.txt` files |
| GET | `/api/priority-queue/export` | `priority.manage` | Export all entries as downloadable JSON |
| POST | `/api/priority-queue/import` | `priority.manage` | Import entries from JSON array. Returns `{ added, skipped, errors }` |
| POST | `/api/priority-queue/cleanup` | `priority.manage` | Manually trigger expired entry cleanup. Returns `{ removed, remaining }` |

**Add entry example:**
```json
{
  "steamId": "76561198012345678",
  "name": "PlayerName",
  "role": "VIP",
  "expiresAt": "2026-04-06T23:59:59.999Z"
}
```

**Roles:** `VIP`, `Supporter`, `Premium`

**Expiration:** Set `expiresAt` to an ISO date string for time-limited VIP, or `null` for permanent access.

**Import format** (POST body is a JSON array):
```json
[
  {
    "steamId": "76561198012345678",
    "name": "PlayerName",
    "role": "VIP",
    "expiresAt": null,
    "addedBy": "admin"
  }
]
```

---

## Webhooks

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/webhooks` | `admin` | List webhooks |
| POST | `/api/webhooks` | `admin` | Create webhook |
| PATCH | `/api/webhooks/:id` | `admin` | Update webhook |
| DELETE | `/api/webhooks/:id` | `admin` | Delete webhook |
| GET | `/api/webhooks/:id/deliveries` | `admin` | Delivery records |
| POST | `/api/webhooks/:id/test` | `admin` | Test webhook |
| GET | `/api/webhooks/events` | `admin` | List event types |

---

## Notifications

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/notifications` | Any auth | List notifications |
| PATCH | `/api/notifications/read` | Any auth | Mark read |
| DELETE | `/api/notifications` | Any auth | Clear all |

---

## Users & Roles

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/users` | `admin` | List users |
| POST | `/api/users` | `admin` | Create user |
| PATCH | `/api/users/:id` | `admin` | Update user |
| DELETE | `/api/users/:id` | `admin` | Delete user |
| GET | `/api/roles` | `admin` | List roles |
| POST | `/api/roles` | `admin` | Create role |
| PATCH | `/api/roles/:id` | `admin` | Update role |
| DELETE | `/api/roles/:id` | `admin` | Delete role |

---

## License

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/license` | Any auth | Get license status |
| GET | `/api/license/tiers` | Any auth | Get tier info |
| POST | `/api/license/activate` | `admin` | Activate key |
| DELETE | `/api/license` | `admin` | Deactivate |

---

## Cloud Integration

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/cloud/status` | `admin` | Get cloud status |
| POST | `/api/cloud/enable` | `admin` | Enable cloud |
| POST | `/api/cloud/disable` | `admin` | Disable cloud |
| POST | `/api/cloud/connect/:serverId` | `admin` | Connect server |
| POST | `/api/cloud/disconnect/:serverId` | `admin` | Disconnect server |
| POST | `/api/cloud/reconnect/:serverId` | `admin` | Reconnect server |

---

## Steam & Workshop

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/steam/status` | Any auth | Steam status |
| POST | `/api/steam/credentials` | `admin` | Set credentials |
| POST | `/api/steam/credentials/save` | `admin` | Save without validation |
| GET | `/api/workshop/search` | Any auth | Search workshop |
| GET | `/api/workshop/details/:id` | Any auth | Mod details |
| GET | `/api/workshop/popular` | Any auth | Popular mods |

---

## VIP Store

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/store/status` | None | Store status (public) |
| GET | `/api/store/products` | None | List products (public) |
| POST | `/api/store/checkout` | Any auth | Create Stripe checkout |
| POST | `/api/store/webhook` | None | Stripe webhook |
| GET | `/api/store/admin/products` | `admin` | Admin: list products |
| POST | `/api/store/admin/products` | `admin` | Admin: create product |
| PATCH | `/api/store/admin/products/:id` | `admin` | Admin: update product |
| DELETE | `/api/store/admin/products/:id` | `admin` | Admin: delete product |
| GET | `/api/store/admin/purchases` | `admin` | Admin: list purchases |
| GET | `/api/store/admin/stripe-config` | `admin` | Admin: Stripe config |
| POST | `/api/store/admin/stripe-config` | `admin` | Admin: save Stripe config |

---

## System

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/system/info` | `admin` | System info |
| GET | `/api/system/metrics` | `admin` | System metrics |
| GET | `/api/system/service` | `admin` | Service status |
| GET | `/api/system/config` | `admin` | System config |
| PATCH | `/api/system/config` | `admin` | Update config |

---

## Health

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/health` | None | Comprehensive health check |
| GET | `/api/health/ping` | None | Lightweight ping |

---

## Audit

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/audit` | `admin` | View audit trail |

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

## Watchlist

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/watchlist` | Any auth | List entries |
| POST | `/api/watchlist` | Any auth | Add entry |
| DELETE | `/api/watchlist/:id` | Any auth | Remove entry |

---

## Additional Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/killfeed` | Any auth | Kill feed data |
| GET | `/api/leaderboard` | Any auth | Player leaderboard |
| GET | `/api/servers/:id/map/*` | Any auth | Live map data |
