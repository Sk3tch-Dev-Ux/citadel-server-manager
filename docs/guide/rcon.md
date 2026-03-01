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
| `ban <player#> <minutes> <reason>` | Ban a player |
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
