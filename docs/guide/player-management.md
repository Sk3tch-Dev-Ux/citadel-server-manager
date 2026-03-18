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

### Advanced Health Actions

| Action | Description |
|--------|-------------|
| **Dry** | Remove wet status |
| **Break Legs** | Break player's legs |
| **Make Sick** | Induce disease (cholera, influenza, etc.) |
| **Cure** | Remove all diseases |
| **Set Blood Type** | Change blood type |
| **Force Drink / Force Eat** | Force hydration/nutrition |
| **Knockout / Wake** | Render unconscious or wake up |
| **Set Bleeding / Stop Bleeding** | Control bleed sources |

### Admin Powers

| Action | Description |
|--------|-------------|
| **Godmode** | Toggle damage immunity |
| **Invisibility** | Toggle player visibility |
| **Infinite Stamina** | Toggle unlimited stamina |

### Inventory & Movement

| Action | Description |
|--------|-------------|
| **Clear Inventory** | Remove all items |
| **Fill Magazines** | Fill all ammo in magazines |
| **Drop Gear** | Force-drop everything on ground |
| **Respawn** | Force respawn at random spawn point |

### Fun/Punishment

| Action | Description |
|--------|-------------|
| **Launch** | Launch player into the air (configurable power and angle) |
| **Ragdoll** | Ragdoll physics for configurable duration |
| **Set Stat** | Modify arbitrary player stats |

## Data Queries

Players can be inspected in detail via the dashboard:
- Position tracking (real-time on live map)
- Full gear inspection (every item, attachment, and condition)
- Inventory contents
- Player statistics (kills, deaths, playtime, K/D ratio)
- Nearby entity scan

## Spawn System (v2.0.0)

The live map and player context menu support click-to-place spawning:
- Zombies (single or horde of 20+)
- Animals (deer, wolves, bears, etc.)
- Vehicles (any class from types.xml)
- Buildings and structures
- Items (with optional attachments)
- Loot piles (military, civilian, etc.)
- Supply crates at coordinates
- Fire and smoke effects
- Helicopter crashes
- Gas zones
- World events (dynamic events at coordinates)

## Area Effects

Admin tools for area-of-effect actions:
- Flatten Trees — Remove trees in configurable radius
- Clear Zombies — Despawn all infected in radius
- Delete Objects — Remove objects by type in radius
- Open/Close Doors — Toggle all doors in radius
- Loot Magnet — Auto-collect nearby loot

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
