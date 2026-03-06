# RCON Commands

Citadel provides a built-in RCON console for sending raw BattlEye RCON commands to your DayZ server.

## Using the Console

### Dashboard

Navigate to a server and open the **RCON Console** tab. Type commands directly and see output in real-time.

### API

```bash
POST /api/servers/:id/rcon
{
  "command": "say -1 Hello everyone!"
}
```

## Common Commands

| Command | Description |
|---------|-------------|
| `say -1 <message>` | Broadcast message to all players |
| `say <player#> <message>` | Send private message to a player |
| `kick <player#> <reason>` | Kick a player |
| `ban <player#> <minutes> <reason>` | Ban a player (`-1` for permanent) |
| `players` | List connected players |
| `bans` | List active bans |
| `removeBan <ban#>` | Remove a ban |
| `lock` | Lock the server |
| `unlock` | Unlock the server |
| `shutdown` | Graceful server shutdown |
| `#restart` | Restart the server |
| `reassign` | Force all clients to reconnect |
| `loadBans` | Reload bans from file |
| `writeBans` | Write bans to file |
| `maxPing <ms>` | Set maximum allowed ping |

## RCON vs Provider Actions

RCON commands are low-level BattlEye protocol operations. For advanced actions like teleporting, healing, or spawning items, use the **Provider System** (InHouseProvider) which routes through the Sidecar and DayZ mod.

| Feature | RCON | InHouseProvider |
|---------|------|-----------------|
| Kick/ban | ✅ | ✅ |
| Messages | ✅ | ✅ |
| Lock/unlock | ✅ | ✅ |
| Teleport | ❌ | ✅ |
| Heal/kill | ❌ | ✅ |
| Spawn items | ❌ | ✅ |
| Vehicle control | ❌ | ✅ |
| Weather/time | ❌ | ✅ |

## Ban Management

Citadel uses a **global ban database** rather than per-server bans. When you ban a player through the dashboard or API:

1. The ban is recorded in `data/bans.json` with a unique UUID
2. The player is immediately kicked from the server via RCON
3. The player's Steam ID is written to the server's `ban.txt` file
4. On server start/restart, all global bans are synced to the server's `ban.txt`

Bans can be exported as JSON and shared with other server owners for cross-community ban lists. Import shared ban lists via the Bans page or the `/api/bans/import` endpoint.

::: tip
Raw RCON `ban` commands bypass the global ban database. Use the dashboard Bans page or API for persistent bans that survive server restarts and apply across all your servers.
:::
