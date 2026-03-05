# Discord Bot

The Citadel Discord bot provides full server management directly in your Discord server — interactive panels, slash commands, admin actions, mod management, and live feeds.

## Setup

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it "Citadel"
3. Go to **Bot** → **Add Bot**
4. Copy the **Bot Token**
5. Enable **Message Content Intent** under Privileged Gateway Intents

### 2. Invite the Bot

Generate an invite URL under **OAuth2 → URL Generator**:
- **Scopes:** `bot`, `applications.commands`
- **Permissions:** `Send Messages`, `Embed Links`, `Use External Emojis`, `Read Message History`, `Use Slash Commands`

### 3. Configure Environment Variables

Add the following to your `.env`:

```ini
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-client-id
DISCORD_GUILD_ID=your-discord-server-id
DISCORD_ADMIN_ROLE_ID=your-admin-role-id
DISCORD_BOT_API_KEY=a-random-secret-key
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from the Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Application ID (OAuth2 page) |
| `DISCORD_GUILD_ID` | No | Your Discord server ID (for guild-scoped command registration — faster updates) |
| `DISCORD_ADMIN_ROLE_ID` | Yes | Discord role ID that grants admin actions. **If not set, all admin actions are denied** (fail-closed) |
| `DISCORD_BOT_API_KEY` | Yes | Shared secret for bot-to-backend API authentication |

### 4. Run the Bot

```bash
# Standalone
node discord-bot/bot.js

# With PM2
pm2 start discord-bot/bot.js --name citadel-bot

# As part of the Windows Service (runs with the backend)
npm run service:install
```

## Architecture

The bot is organized into a modular file structure:

```
discord-bot/
├── bot.js              # Entry point — client, router, presence, shutdown
├── config.js           # Environment configuration
├── api.js              # Backend API client with user attribution
├── commands/           # 18 slash commands (auto-loaded)
│   ├── index.js        # Auto-loader + registerCommands()
│   ├── panel.js        # /panel — ephemeral control panel
│   ├── setup.js        # /setup — persistent panel in channel
│   ├── status.js       # /status
│   ├── players.js      # /players
│   ├── rcon.js         # /rcon
│   ├── broadcast.js    # /broadcast
│   ├── restart.js      # /restart
│   ├── playerinfo.js   # /playerinfo
│   ├── heal.js         # /heal
│   ├── kill.js         # /kill
│   ├── teleport.js     # /teleport
│   ├── spawnitem.js    # /spawnitem
│   ├── unstuck.js      # /unstuck
│   ├── freeze.js       # /freeze
│   ├── strip.js        # /strip
│   ├── explode.js      # /explode
│   └── dm.js           # /dm
├── handlers/
│   ├── buttons.js      # 40 button handlers (dispatch map)
│   ├── selectMenus.js  # Server/category/player selects
│   └── modals.js       # Modal submission handlers
├── ui/
│   ├── embeds.js       # Embed builders (status, players, errors, etc.)
│   ├── components.js   # Buttons, modals, select menus, action rows
│   └── colors.js       # Color palette
└── utils/
    ├── permissions.js   # Admin role check
    ├── cooldowns.js     # Per-user per-action cooldown system
    ├── formatting.js    # Playtime, uptime, progress bars
    └── sanitize.js      # Input validation & markdown escaping
```

## Commands

### General Commands

| Command | Description | Admin |
|---------|-------------|-------|
| `/panel` | Open an ephemeral interactive control panel | No |
| `/setup` | Deploy a persistent control panel in the current channel | Yes |
| `/status` | Quick server status check (CPU, RAM, FPS, players, uptime) | No |
| `/players` | View all online players | No |

### Server Commands

| Command | Description | Admin |
|---------|-------------|-------|
| `/rcon <command>` | Execute a BattlEye RCON command | Yes |
| `/broadcast <message>` | Send a message to all online players | Yes |
| `/restart [countdown]` | Restart the server (now, 60s, or 5m countdown) | Yes |

### Admin Action Commands

| Command | Description | Admin |
|---------|-------------|-------|
| `/playerinfo <steamid>` | Look up player stats, sessions, K/D ratio | Yes |
| `/heal <steamid>` | Heal a player to full health | Yes |
| `/kill <steamid>` | Kill a player | Yes |
| `/teleport <steamid> <x> <y> [z]` | Teleport a player to coordinates | Yes |
| `/spawnitem <steamid> <item> [qty]` | Spawn an item on a player (max qty: 100) | Yes |
| `/unstuck <steamid>` | Teleport a stuck player to the terrain surface | Yes |
| `/freeze <steamid> [unfreeze]` | Freeze or unfreeze a player in place | Yes |
| `/strip <steamid>` | Strip all gear from a player | Yes |
| `/explode <steamid>` | Explode a player | Yes |
| `/dm <steamid> <message>` | Send a direct in-game message to a player | Yes |

## Interactive Control Panel

The `/panel` and `/setup` commands deploy a rich interactive panel with:

### Core Buttons
- **Status** — Refresh the server status embed
- **Start / Stop / Restart** — Server lifecycle controls with confirmation dialogs

### Category Dropdown
Select a category to reveal its action buttons:

| Category | Actions |
|----------|---------|
| **Server** | Lock, Unlock, Broadcast, RCON |
| **Players** | Player List, Kick Player, Player Info |
| **Mods** | Mod List, Install, Uninstall, Enable, Disable |
| **Intel** | Chat Feed, Killfeed, Leaderboard, Watchlist, Priority Queue, Time/Weather |
| **Admin Actions** | Heal, Unstuck, Spawn Item, Teleport, Message, Freeze, Strip Gear, Kill, Explode (via player select menus) |

### Multi-Server Support
If multiple servers are configured, a server selector dropdown appears at the top of the panel. Switching servers updates all subsequent actions to target the selected server.

## Security

### Role-Based Permissions
Admin commands and panel actions require the Discord role specified by `DISCORD_ADMIN_ROLE_ID`. If this variable is not set, **all admin actions are denied** (fail-closed design).

### Cooldown System
Per-user per-action cooldowns prevent command spam:

| Tier | Cooldown | Actions |
|------|----------|---------|
| **Query** | 3 seconds | Status, players, mods, intel feeds, leaderboard |
| **Admin** | 10 seconds | Heal, kill, teleport, spawn, unstuck, freeze, strip, explode, message, kick, RCON, broadcast, mod operations |
| **Control** | 30 seconds | Start, stop, restart |

### Input Validation
All user inputs are validated before reaching the backend:
- **Steam64 IDs** — Must be a 17-digit number starting with `7656119`
- **Coordinates** — Must be finite numbers
- **Workshop IDs** — Must be numeric strings (up to 15 digits)
- **Broadcast messages** — Control characters stripped, limited to 256 characters
- **Player names** — Markdown characters escaped in embeds to prevent formatting exploits

### Audit Trail
Every action from Discord is logged in the backend audit system with the Discord user's tag and ID. Actions appear in the Citadel audit log alongside web panel actions, providing a unified activity record.

### API Authentication
The bot authenticates to the backend using a shared `DISCORD_BOT_API_KEY` with timing-safe comparison. This key is separate from user JWT tokens.

## Bot Presence

The bot's Discord status automatically updates every 60 seconds:
- **Online** — Shows total players across all running servers (e.g., "12/120 players | 2 servers")
- **Idle** — Shows "All servers offline" when no servers are running

## Troubleshooting

### Bot doesn't respond to commands
- Verify `DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID` are correct in `.env`
- Ensure the bot has been invited with `applications.commands` scope
- Check that the backend is running and accessible at the configured `PANEL_API_URL`

### Admin commands say "Admin role required"
- Set `DISCORD_ADMIN_ROLE_ID` in `.env` to the ID of your admin Discord role
- Ensure the user has that role assigned in Discord
- Right-click the role in Discord → Copy ID (enable Developer Mode in Discord settings)

### Commands timeout with no response
- The backend API must be reachable from the bot. Default: `http://localhost:3001`
- Check that `DISCORD_BOT_API_KEY` matches between the bot's `.env` and the backend's `.env`

### "Cooldown active" messages
- Wait for the cooldown to expire (3s for queries, 10s for admin, 30s for controls)
- Each user has independent cooldowns — other users are not affected
