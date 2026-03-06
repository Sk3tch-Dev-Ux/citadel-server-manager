# Environment Variables

Complete reference for all Citadel configuration variables. Set these in the `.env` file in the project root.

## Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Backend API server port |
| `NODE_ENV` | No | `development` | Environment (`production` or `development`) |
| `JWT_SECRET` | **Yes** | — | Secret key for signing JWT tokens. Use a long random string |
| `SESSION_TIMEOUT` | No | `24h` | JWT token expiration |

## Admin Account

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_USERNAME` | **Yes** | — | Initial admin username |
| `ADMIN_PASSWORD` | **Yes** | — | Initial admin password |

## InHouse Sidecar

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INHOUSE_SIDECAR_URL` | No | `http://localhost:9100` | Sidecar API base URL |
| `INHOUSE_API_KEY` | No | — | API key for sidecar authentication |

## RCON

RCON is configured per-server in the server profile, but defaults can be set:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RCON_HOST` | No | `127.0.0.1` | Default RCON host |
| `RCON_PORT` | No | `2302` | Default RCON port |
| `RCON_PASSWORD` | No | — | Default RCON password |

## Discord Bot

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | No | — | Discord bot token |
| `DISCORD_CHANNEL_ID` | No | — | Channel for status messages |
| `DISCORD_KILLFEED_CHANNEL_ID` | No | — | Channel for kill feed |
| `DISCORD_ADMIN_ROLE_ID` | No | — | Role allowed to use bot controls |

## SteamCMD

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STEAMCMD_PATH` | No | — | Path to SteamCMD executable |
| `STEAM_USERNAME` | No | — | Steam account for Workshop downloads |
| `STEAM_PASSWORD` | No | — | Steam account password |

## Notifications

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WEBHOOK_URL` | No | — | Default Discord webhook URL for notifications |

## Bans

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BAN_KICK_MESSAGE` | No | `You have been banned. Reason: {reason}. To appeal, visit our Discord.` | Message shown to players when kicked for a ban. Supports `{reason}` and `{banId}` placeholders |
| `BAN_APPEAL_URL` | No | — | Discord invite or appeal URL. If set, replaces "our Discord" in the default kick message |

## Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_WINDOW` | No | `15m` | Rate limiting window |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origins |

## Example `.env`

```ini
# ── Citadel Configuration ─────────────────────────
PORT=3000
NODE_ENV=production
JWT_SECRET=change-me-to-a-random-64-char-string

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=secure-password-here

# InHouse Sidecar
INHOUSE_SIDECAR_URL=http://localhost:9100
INHOUSE_API_KEY=your-sidecar-api-key

# Discord (optional)
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CHANNEL_ID=1234567890

# Ban messages (optional)
BAN_APPEAL_URL=https://discord.gg/your-server
```
