# Player Management

Citadel provides comprehensive player management through the web dashboard.

## Player List

The real-time player list shows all connected players with:
- Player name
- Steam ID
- Connection time
- Position (with InHouseProvider)
- Health/stats (with InHouseProvider)

## Actions

### Quick Actions

Available directly from the player list:

| Action | Provider | Description |
|--------|----------|-------------|
| **Kick** | RCON / InHouse | Remove player from server |
| **Ban** | RCON / InHouse | Ban with reason and duration |
| **Message** | RCON / InHouse | Send private message |

### Advanced Actions (InHouseProvider)

Available when the Sidecar + Mod are configured:

| Action | Description |
|--------|-------------|
| **Heal** | Restore to full health |
| **Kill** | Kill the player |
| **Teleport** | Move to specific coordinates |
| **Spawn Item** | Add items to inventory |
| **Strip** | Remove all inventory |
| **Explode** | Create explosion at position |
| **Unstuck** | Teleport player to terrain surface |
| **Freeze / Unfreeze** | Lock player in place or release them |
| **Message** | Send a direct in-game message |
| **Teleport to Player** | Move one player to another player's location |
| **View Loadout** | Inspect full inventory (item class, quantity, health %) |

## Ban Management

### Viewing Bans

Navigate to **Bans** to see all active bans with:
- Player name and Steam ID
- Ban reason
- Expiration date
- Who issued the ban

### Ban Types

| Type | Description |
|------|-------------|
| **Temporary** | Expires after a set duration |
| **Permanent** | No expiration |

### Removing Bans

Click **Unban** on any ban entry, or use the API:

```bash
DELETE /api/servers/:id/bans/:banId
```

## Watchlist

Add players to a watchlist to receive notifications when they join:

1. Navigate to **Watchlist**
2. Add a Steam ID with an optional note
3. Receive a notification when the player connects

## Priority Queue

Manage VIP/priority queue for your server:

1. Navigate to **Priority Queue**
2. Add players with role and expiration
3. The `@CitadelAdmin` mod checks the priority list on player connect

## Leaderboard

The leaderboard tracks player statistics:
- Kills / Deaths / K/D ratio
- Playtime
- Sessions
- Longest kill distance
