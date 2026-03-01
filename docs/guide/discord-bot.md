# Discord Bot

The Citadel Discord bot provides server control and monitoring directly in your Discord server.

## Setup

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it "Citadel"
3. Go to **Bot** → **Add Bot**
4. Copy the **Bot Token**
5. Enable **Message Content Intent** under Privileged Intents

### 2. Invite the Bot

Generate an invite URL under **OAuth2 → URL Generator**:
- **Scopes:** `bot`, `applications.commands`
- **Permissions:** `Send Messages`, `Embed Links`, `Use External Emojis`, `Read Message History`

### 3. Configure Environment Variables

Add the following to your `.env`:

```ini
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CHANNEL_ID=your-channel-id
```

### 4. Install & Run

```bash
cd discord-bot
npm install
node bot.js

# Or with PM2
pm2 start discord-bot/bot.js --name citadel-bot
```

## Features

### Server Status Embed

The bot posts a live-updating embed showing:
- Server online/offline status  
- Current player count
- Map and version info
- Last restart time

### Button Controls

Interactive buttons for common operations:
- **Restart Server** — Triggers a graceful server restart
- **Lock / Unlock** — Toggle server password protection
- **Send Message** — Broadcast a message to all players
- **Kick Player** — Select and kick a player

### Kill Feed

Real-time kill notifications posted to a designated channel with:
- Killer and victim names
- Weapon used
- Distance
- Timestamp

### Notifications

Configurable alerts for:
- Server start/stop events
- Player connection spikes
- Low server FPS warnings
- Scheduled restart countdowns

## Commands

The bot uses Discord button interactions rather than slash commands. All controls are available through the persistent status message posted in your configured channel.
