# 🎮 DayZ Server Control Panel

A full-featured web dashboard and Discord bot for managing DayZ servers — making server administration painless.

![Status](https://img.shields.io/badge/status-beta-yellow)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ Features

### 🌐 Web Dashboard
- **Real-time monitoring** — CPU, RAM, FPS, player count with live charts
- **Server controls** — Start, stop, restart (with countdown), lock/unlock
- **Player management** — View online players, kick, ban, broadcast messages
- **RCON console** — Send commands directly with command history
- **Mod manager** — Add/remove/toggle Steam Workshop mods, reorder load priority
- **Config editor** — Edit `serverDZ.cfg` settings from the UI
- **File browser** — Browse and edit server files with automatic backups
- **Restart scheduler** — Cron-based automatic restarts with presets
- **Ban list management** — View, add, remove bans with expiry support
- **Log viewer** — Filterable real-time log stream
- **JWT authentication** — Secure login with role-based access (admin/moderator)
- **WebSocket updates** — Real-time status without refreshing

### 🤖 Discord Bot
- **Button-based control panel** — Deploy a persistent panel in any channel
- **Slash commands** — `/panel`, `/status`, `/players`, `/rcon`, `/broadcast`, `/restart`
- **Interactive buttons** — Start, stop, restart, lock, unlock, kick, broadcast
- **Confirmation dialogs** — Prevents accidental server shutdowns
- **Modal inputs** — RCON commands and broadcasts via Discord modals
- **Player kick menu** — Select dropdown to pick and kick players
- **Restart countdowns** — Warn players before restarting (60s / 5m options)
- **Role-based permissions** — Restrict admin actions to a Discord role
- **Auto-updating presence** — Bot status shows player count in real-time

---

## 📂 Project Structure

```
dayz-panel/
├── backend/              # Express API server (central hub)
│   ├── server.js         # Main API with RCON, auth, WebSocket
│   └── package.json
├── web/                  # React web dashboard
│   └── index.html        # Single-file React app
├── discord-bot/          # Discord.js bot with buttons
│   ├── bot.js            # Bot with slash commands & interactions
│   └── package.json
├── .env.example          # Environment variable template
└── README.md             # This file
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ ([download](https://nodejs.org))
- A **DayZ server** (Windows or Linux with Wine/Proton)
- A **Discord application** (for the bot — [create one](https://discord.com/developers/applications))

### 1. Clone & Configure

```bash
# Clone or download the project
cd dayz-panel

# Copy the environment template
cp .env.example .env

# Edit .env with your actual values
nano .env
```

**Key settings to change:**
| Variable | Description |
|---|---|
| `JWT_SECRET` | Random secret string for auth tokens |
| `ADMIN_PASSWORD` | Your admin login password |
| `DAYZ_SERVER_IP` | Your DayZ server IP |
| `RCON_PASSWORD` | BattlEye RCON password |
| `DAYZ_INSTALL_DIR` | Path to DayZ server installation |
| `DISCORD_BOT_TOKEN` | Your Discord bot token |
| `DISCORD_CLIENT_ID` | Discord application client ID |
| `DISCORD_GUILD_ID` | Your Discord server ID |

### 2. Install & Start the Backend

```bash
cd backend
npm install
npm start
```

The API starts on `http://localhost:3001` — the web dashboard is served from here too.

### 3. Start the Discord Bot

```bash
cd discord-bot
npm install
npm start
```

### 4. Open the Dashboard

Visit **http://localhost:3001** in your browser.  
Default login: `admin` / `admin` (change in `.env`!)

---

## 🤖 Discord Bot Setup

### Creating the Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it "DayZ Panel"
3. Go to **Bot** → Click **Add Bot**
4. Copy the **Token** → paste as `DISCORD_BOT_TOKEN` in `.env`
5. Enable **Message Content Intent** under Privileged Gateway Intents
6. Go to **OAuth2 → URL Generator**
7. Select scopes: `bot`, `applications.commands`
8. Select permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`, `Read Message History`
9. Copy the URL → open it to invite the bot to your server

### Using the Bot

| Command | Description |
|---|---|
| `/panel` | Open the interactive control panel with buttons |
| `/setup` | Deploy a persistent control panel in the channel |
| `/status` | Quick server status check |
| `/players` | View all online players |
| `/rcon <command>` | Execute an RCON command |
| `/broadcast <message>` | Send a message to all players |
| `/restart [countdown]` | Restart with optional countdown |

**The `/setup` command** creates a persistent panel with buttons that anyone in the channel can use (admin actions still require the admin role).

### Button Controls

The panel provides these interactive buttons:

| Button | Action | Requires Admin |
|---|---|---|
| 📊 Status | Refresh server status | No |
| ▶️ Start | Start the server | Yes |
| ⏹️ Stop | Stop the server (with confirmation) | Yes |
| 🔄 Restart | Restart options (now/60s/5m) | Yes |
| 👥 Players | View online players | No |
| 🔒 Lock | Lock server (no new joins) | Yes |
| 🔓 Unlock | Unlock server | Yes |
| 📢 Broadcast | Open modal to type a message | No |
| 👢 Kick Player | Dropdown menu to select & kick | Yes |
| 🖥️ RCON | Open modal for RCON commands | Yes |

---

## 🔧 API Reference

All endpoints require JWT auth (except login). Pass token as `Authorization: Bearer <token>`.

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | Login → returns JWT token |
| POST | `/api/auth/register` | Create user (admin only) |

### Server Control
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/server/status` | Get server status & player count |
| POST | `/api/server/start` | Start the DayZ server |
| POST | `/api/server/stop` | Stop the server |
| POST | `/api/server/restart` | Restart (optional `countdown` in body) |
| POST | `/api/server/lock` | Lock server |
| POST | `/api/server/unlock` | Unlock server |
| POST | `/api/server/rcon` | Send RCON command |
| POST | `/api/server/message` | Broadcast message |

### Players
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/players` | List online players |
| POST | `/api/players/:id/kick` | Kick a player |
| POST | `/api/players/:id/ban` | Ban a player |

### More
| Method | Endpoint | Description |
|---|---|---|
| GET/PATCH | `/api/config` | Server configuration |
| GET/POST/DELETE | `/api/mods` | Mod management |
| GET/POST/DELETE | `/api/schedule` | Restart scheduler |
| GET/DELETE | `/api/bans` | Ban list |
| GET | `/api/logs` | Server logs |
| GET | `/api/metrics` | Performance metrics |
| GET/PUT | `/api/files` | File browser & editor |

---

## 🔒 Production Deployment

### Security Checklist
- [ ] Change `JWT_SECRET` to a strong random string
- [ ] Change default admin password
- [ ] Set `DISCORD_BOT_API_KEY` to a strong secret
- [ ] Use HTTPS (reverse proxy with nginx/caddy)
- [ ] Restrict API access to trusted IPs
- [ ] Set up proper firewall rules

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name panel.yourdomain.com;

    ssl_certificate /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Running with PM2

```bash
# Install PM2
npm install -g pm2

# Start backend
cd backend && pm2 start server.js --name dayz-panel-api

# Start Discord bot
cd discord-bot && pm2 start bot.js --name dayz-panel-bot

# Save & auto-start on boot
pm2 save
pm2 startup
```

---

## 🛠️ Extending the Panel

### RCON Implementation

The panel includes a **full BattlEye RCON client** built directly on the [BattlEye RCon Protocol](https://www.battleye.com/downloads/BERConProtocol.txt) using Node.js's built-in `dgram` UDP module. No third-party RCON packages are needed — the implementation handles login, command sending, keep-alive, server message acknowledgment, and automatic reconnection.

**Important:** Since DayZ 1.13+, you **must** set `RConPort` explicitly in your `BEServer_x64.cfg` (inside the BattlEye directory). It can no longer share the game port and defaults to a random port if not set. Recommended default is `2305`.

```cfg
# BEServer_x64.cfg (in your BattlEye folder)
RConPassword your-rcon-password
RConPort 2305
```

Then set `DAYZ_RCON_PORT=2305` in your `.env` to match.

**Alternative approaches** if you prefer external tools:
- **[bercon](https://github.com/WoozyMasta/bercon)** — A standalone Rust CLI for BattlEye RCON (Linux & Windows). Can be called via `child_process.execFile()`.
- **[battleye](https://www.npmjs.com/package/battleye)** (npm, by nurdism) — A TypeScript RCON client. Last published 6+ years ago but the BE protocol hasn't changed, so it still functions. There's also a fork at `@senfo/battleye`.
- **[dayz-server-manager](https://github.com/mr-guard/dayz-server-manager)** — A full server manager with its own RCON built-in. Worth considering if you want an all-in-one solution instead of building your own panel.

### Adding a Database
Replace the in-memory `store` object with a proper database (SQLite, PostgreSQL, MongoDB) for persistent data across restarts.

### Adding SteamCMD Integration
Add endpoints to update the DayZ server and download mods via SteamCMD:

```bash
steamcmd +force_install_dir /path/to/server +login anonymous +app_update 223350 +quit
```

---

## 📜 License

MIT — use it however you want for your DayZ community.
