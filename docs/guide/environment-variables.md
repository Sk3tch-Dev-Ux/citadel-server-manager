# Environment Variables

Complete reference for all Citadel configuration variables. Set these in the `.env` file in the project root, or use `citadel.config.json` for non-sensitive settings.

::: tip Auto-generated
The setup wizard generates a `.env` file with a secure `JWT_SECRET` on first run. You only need to create one manually if you skip the wizard.
:::

## Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Backend API server port |
| `JWT_SECRET` | Auto | — | Secret key for signing JWT tokens. Auto-generated and persisted to `data/.jwt-secret` on first run |

## Admin Account

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_USERNAME` | Yes | — | Initial admin username (set during setup wizard) |
| `ADMIN_PASSWORD` | Yes | — | Initial admin password (must be changed on first login) |

## DayZ Server Defaults

These set the default values for the first server profile. Per-server config is managed via the web UI after setup.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DAYZ_SERVER_IP` | No | `127.0.0.1` | DayZ server IP address |
| `DAYZ_RCON_PORT` | No | `2305` | BattlEye RCON port |
| `RCON_PASSWORD` | No | — | BattlEye RCON password |
| `DAYZ_INSTALL_DIR` | No | `C:\DayZServer` | Path to DayZ server installation |
| `DAYZ_PROFILE_DIR` | No | — | Server profile directory (e.g. `profiles`) |
| `DAYZ_EXECUTABLE` | No | `DayZServer_x64.exe` | Server executable name |
| `DAYZ_LAUNCH_PARAMS` | No | `-config=serverDZ.cfg -port=2302 -profiles=profiles -dologs -adminlog -netlog -freezecheck` | Server launch parameters |

## Discord Bot

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | For bot | — | Discord bot token |
| `DISCORD_CLIENT_ID` | For bot | — | Discord application client ID |
| `DISCORD_GUILD_ID` | For bot | — | Your Discord server (guild) ID |
| `DISCORD_ADMIN_ROLE_ID` | For bot | — | Role ID allowed to use admin bot commands |
| `DISCORD_BOT_API_KEY` | For bot | — | Random key for bot-to-API authentication |
| `DISCORD_WEBHOOK_URL` | No | — | Default Discord webhook URL for notifications |
| `PANEL_API_URL` | No | `http://localhost:3001` | URL for the Discord bot to call back to the panel API |

## SteamCMD

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STEAMCMD_PATH` | No | — | Path to SteamCMD executable (e.g. `C:\SteamCMD\steamcmd.exe`) |
| `STEAM_USERNAME` | No | — | Steam account for Workshop downloads |
| `STEAM_PASSWORD` | No | — | Steam account password |

## InHouse Sidecar

The sidecar runs alongside your DayZ server and bridges commands to the `@CitadelAdmin` mod. Configured per-server in the web panel.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INHOUSE_SIDECAR_PORT` | No | `9100` | Sidecar API port |
| `INHOUSE_API_KEY` | No | — | API key for sidecar authentication |

## Bans

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BAN_KICK_MESSAGE` | No | `You have been banned. Reason: {reason}. To appeal, visit our Discord.` | Message shown to players when kicked for a ban. Supports `{reason}` and `{banId}` placeholders |
| `BAN_APPEAL_URL` | No | — | Discord invite or appeal URL. If set, replaces "our Discord" in the default kick message |

## Cloud Integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLOUD_ENABLED` | No | `false` | Enable Citadel Cloud connection |
| `CLOUD_RELAY_URL` | No | `wss://cloud.citadel.cc` | WebSocket relay URL |

## Store

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STRIPE_SECRET_KEY` | No | — | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | No | — | Stripe webhook signing secret |
| `STORE_ENABLED` | No | `false` | Enable/disable VIP store |

## Sidecar TLS

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SIDECAR_TLS_CERT` | No | — | Path to TLS certificate for sidecar HTTPS |
| `SIDECAR_TLS_KEY` | No | — | Path to TLS private key for sidecar HTTPS |

## Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CORS_ORIGINS` | No | `http://localhost:3001,http://127.0.0.1:3001` | Comma-separated list of allowed CORS origins |
| `USE_HTTPS` | No | `0` | Force HTTPS (1 to enable) |

## Auto-Update

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTO_UPDATE_ENABLED` | No | `false` | Enable automatic server updates |
| `UPDATE_COUNTDOWN_SECONDS` | No | `300` | Countdown before update restart |

## Example `.env`

```ini
# ── Citadel Configuration ─────────────────────────
PORT=3001
JWT_SECRET=change-me-to-a-random-64-char-string

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=secure-password-here

# DayZ Server
DAYZ_SERVER_IP=127.0.0.1
DAYZ_RCON_PORT=2305
RCON_PASSWORD=your-rcon-password
DAYZ_INSTALL_DIR=C:\DayZ\Server

# Discord (optional)
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-client-id
DISCORD_GUILD_ID=your-guild-id
DISCORD_ADMIN_ROLE_ID=your-admin-role-id
DISCORD_BOT_API_KEY=generate-a-random-32-byte-hex-string

# SteamCMD
STEAMCMD_PATH=C:\SteamCMD\steamcmd.exe
STEAM_USERNAME=your-steam-username

# Ban messages (optional)
BAN_APPEAL_URL=https://discord.gg/your-server
```
