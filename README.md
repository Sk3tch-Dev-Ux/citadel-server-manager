# Citadel

An enterprise-grade web dashboard, Discord bot, and in-game admin mod for managing multiple DayZ servers. Built for teams that need reliable, secure server administration at scale.

![Status](https://img.shields.io/badge/status-production-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-blue)

---

## Features

### Web Dashboard
- **Multi-server management** — Server Hub with per-instance monitoring and controls
- **Real-time metrics** — CPU, RAM, FPS, player count with live WebSocket updates
- **Server controls** — Start, stop, restart with health monitoring and auto-restart
- **Player management** — Online player list, kick, ban with reason tracking
- **RCON console** — Send BattlEye commands directly with command history
- **Mod manager** — Search Steam Workshop, install/uninstall/toggle mods, reorder load priority
- **Config editor** — Edit `serverDZ.cfg` from the UI with validation
- **File browser** — Browse and edit server files with Monaco Editor and automatic backups
- **Restart scheduler** — Cron-based automatic restarts with presets
- **Ban management** — View, add, remove bans with ban list export
- **Log viewer** — Filterable real-time log stream by level and source
- **Server deployment** — Deploy new servers via SteamCMD (stable and experimental branches)
- **User & role management** — Granular permissions with custom roles and audit logging
- **Webhook system** — Event-driven webhooks to Discord or any HTTP endpoint with retry logic
- **Notification center** — Real-time in-app notifications for server events
- **Watchlist & priority queue** — Track suspicious players, manage VIP access
- **Killfeed & leaderboard** — Parsed from RPT logs with player statistics

### Discord Bot
- **Interactive control panel** — Persistent button panel deployable in any channel
- **Slash commands** — `/panel`, `/status`, `/players`, `/rcon`, `/broadcast`, `/restart`, `/setup`
- **Full mod management** — Install, uninstall, enable, disable mods from Discord
- **Live feeds** — Chat feed, killfeed, leaderboard, watchlist from Discord
- **Role-based permissions** — Admin actions restricted to a configurable Discord role (fail-closed)
- **Confirmation dialogs** — Prevents accidental server shutdowns
- **Modal inputs** — RCON commands and broadcasts via Discord modals
- **Auto-updating presence** — Bot status shows player count in real-time

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js, Express 4, Socket.IO 4, Pino logger |
| Frontend | React 18, Vite 6, Lucide React icons |
| Discord | Discord.js 14 (slash commands, buttons, modals, select menus) |
| Auth | JWT (jsonwebtoken), bcryptjs, role-based permissions |
| RCON | Custom BattlEye UDP client (dgram) |
| Steam | SteamCMD subprocess, Workshop API |
| Data | JSON file persistence (no database required) |
| Quality | Jest + Supertest (31 tests), ESLint, GitHub Actions CI |

---

## Project Structure

```
Citadel/
├── backend/
│   ├── server.js              # Express + Socket.IO entry point
│   ├── lib/
│   │   ├── config.js          # Environment configuration
│   │   ├── context.js         # Global runtime state
│   │   ├── process-manager.js # Windows process management (spawn/tasklist/wmic)
│   │   ├── polling.js         # Metrics, status, and Steam update polling
│   │   ├── rcon-client.js     # BattlEye RCON UDP client
│   │   ├── steamcmd.js        # SteamCMD wrapper
│   │   ├── workshop.js        # Steam Workshop API
│   │   ├── mod-manager.js     # Mod install/ordering
│   │   ├── notifications.js   # Notification & webhook dispatch
│   │   ├── audit.js           # Audit logging & metrics
│   │   ├── helpers.js         # safePath, validation, password policy
│   │   ├── data-store.js      # JSON persistence
│   │   ├── dayz-config.js     # serverDZ.cfg parser/writer
│   │   ├── rpt-scraper.js     # RPT log parser (killfeed/leaderboard)
│   │   ├── server-init.js     # Server state initialization
│   │   └── logger.js          # Pino structured logger
│   ├── middleware/
│   │   ├── auth.js            # JWT authentication & permission checks
│   │   ├── rate-limit.js      # Rate limiting (API, auth, Discord)
│   │   └── security.js        # CORS, secure cookies
│   ├── routes/                # 25 route handler files
│   │   ├── auth.routes.js
│   │   ├── servers.routes.js
│   │   ├── server-control.routes.js
│   │   ├── rcon-players.routes.js
│   │   ├── mods.routes.js
│   │   ├── workshop.routes.js
│   │   ├── files.routes.js
│   │   ├── config.routes.js
│   │   ├── logs-metrics.routes.js
│   │   ├── schedule.routes.js
│   │   ├── users.routes.js
│   │   ├── roles.routes.js
│   │   ├── webhooks.routes.js
│   │   ├── notifications.routes.js
│   │   ├── audit.routes.js
│   │   ├── deploy.routes.js
│   │   ├── steam.routes.js
│   │   ├── backup.routes.js
│   │   ├── discord.routes.js
│   │   ├── watchlist.routes.js
│   │   ├── priority-queue.routes.js
│   │   ├── killfeed.routes.js
│   │   ├── leaderboard.routes.js
│   │   └── compat.routes.js
│   ├── test_api.test.js       # Jest test suite (31 tests)
│   ├── deploy.ps1             # Windows deployment script
│   └── deploy.sh              # Linux deployment script
├── web/
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── App.jsx        # App shell with sidebar navigation
│   │   │   ├── api.js         # API client
│   │   │   ├── main.jsx       # React entry point
│   │   │   ├── pages/         # 17 page components
│   │   │   ├── components/    # Shared UI components
│   │   │   ├── contexts/      # Auth, Socket, Toast providers
│   │   │   ├── styles/        # Global CSS
│   │   │   └── utils.js       # Utility functions
│   │   ├── vite.config.js
│   │   ├── eslint.config.js
│   │   └── package.json
│   └── dist/                  # Production build output
├── discord-bot/
│   ├── bot.js                 # Discord bot with slash commands & buttons
│   └── package.json
├── data/                      # Persistent JSON data
├── .github/workflows/ci.yml   # GitHub Actions CI pipeline
├── .env.example               # Environment variable template
├── package.json               # Root workspace scripts
└── README.md
```

---

## Quick Start

### Prerequisites
- **Node.js** 18+ ([download](https://nodejs.org))
- **Windows** (process management uses tasklist/taskkill/wmic)
- A **DayZ server** installation
- A **Discord application** for the bot ([create one](https://discord.com/developers/applications))

### 1. Clone & Configure

```bash
git clone https://github.com/yourusername/Citadel.git
cd Citadel

# Copy environment template
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Random secret for auth tokens (`openssl rand -hex 32`) |
| `ADMIN_PASSWORD` | Yes | Admin login password |
| `DISCORD_BOT_API_KEY` | Yes | Random key for bot-to-API auth (`openssl rand -hex 32`) |
| `DAYZ_SERVER_IP` | Yes | Your DayZ server IP |
| `RCON_PASSWORD` | Yes | BattlEye RCON password |
| `DAYZ_INSTALL_DIR` | Yes | Path to DayZ server installation |
| `DISCORD_BOT_TOKEN` | For bot | Discord bot token |
| `DISCORD_CLIENT_ID` | For bot | Discord application client ID |
| `DISCORD_GUILD_ID` | For bot | Your Discord server ID |
| `DISCORD_ADMIN_ROLE_ID` | For bot | Discord role ID for admin actions |
| `CORS_ORIGINS` | No | Comma-separated allowed origins (defaults to localhost) |

### 2. Install & Build

```bash
# Install backend dependencies
cd backend && npm install && cd ..

# Install and build the frontend
cd web/frontend && npm install && npm run build && cd ../..

# Install Discord bot (optional)
cd discord-bot && npm install && cd ..
```

### 3. Start

```bash
# Start the backend (serves API + web UI)
cd backend && npm start

# In a separate terminal, start the Discord bot (optional)
cd discord-bot && npm start
```

Visit **http://localhost:3001** and login with `admin` / your configured password.

### Development Mode

```bash
# Terminal 1: Backend with auto-reload
npm run dev:backend

# Terminal 2: Frontend with hot-reload (proxies API to :3001)
npm run dev:frontend
```

---

## Web UI Pages

| Page | Description |
|------|-------------|
| **Server Hub** | Multi-server overview with status cards and quick actions |
| **Overview** | Server status, players, CPU/RAM, uptime, ports, map |
| **Metrics** | Real-time CPU, RAM, player count, FPS charts |
| **Console** | Live RCON command interface with history |
| **Players** | Online player list with kick/ban actions |
| **Mods** | Installed mods, Workshop search, install/uninstall/reorder |
| **Files** | File browser with Monaco Editor and automatic backups |
| **Configuration** | Edit serverDZ.cfg with field validation |
| **Logs** | Filterable server logs by level and source |
| **Bans** | Ban list management with unban |
| **Scheduler** | Cron-based automatic restart scheduling |
| **Settings** | Per-server configuration (health monitoring, auto-start, etc.) |
| **Deploy** | New server deployment wizard via SteamCMD |
| **Users** | User/role management with granular permissions |
| **Webhooks** | Webhook CRUD with delivery history and test |

---

## Discord Bot Setup

### Creating the Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it
3. Go to **Bot** > **Add Bot**
4. Copy the **Token** and set as `DISCORD_BOT_TOKEN` in `.env`
5. Enable **Message Content Intent** under Privileged Gateway Intents
6. Go to **OAuth2 > URL Generator**
7. Select scopes: `bot`, `applications.commands`
8. Select permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`, `Read Message History`
9. Copy the generated URL and open it to invite the bot

### Commands

| Command | Description | Admin |
|---------|-------------|-------|
| `/panel` | Open the interactive control panel | No |
| `/setup` | Deploy a persistent control panel in the channel | Yes |
| `/status` | Quick server status check | No |
| `/players` | View all online players | No |
| `/rcon <command>` | Execute an RCON command | Yes |
| `/broadcast <message>` | Send a message to all players | Yes |
| `/restart [countdown]` | Restart with optional countdown (now/60s/5m) | Yes |

### Control Panel Buttons

The `/setup` command creates a persistent panel with these button rows:

| Row | Buttons |
|-----|---------|
| Server | Status, Start, Stop, Restart |
| Players | Players, Lock, Unlock, Broadcast |
| Mods | Mods, Mod Status, Install Mod, Uninstall, Enable, Disable |
| Info | Chat Feed, Killfeed, Leaderboard, Watchlist, Priority Queue, Time/Weather, Ban/Whitelist |
| Admin | Kick Player, RCON |

Admin actions require the configured `DISCORD_ADMIN_ROLE_ID`. If not configured, all admin actions are denied (fail-closed).

---

## API Reference

All endpoints require JWT authentication (pass as `Authorization: Bearer <token>`) except login.

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login (returns JWT, brute-force protected) |

### Server Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers` | List all servers with status |
| POST | `/api/servers` | Create a new server |
| PATCH | `/api/servers/:id` | Update server settings |
| DELETE | `/api/servers/:id` | Delete a server |

### Server Control
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:id/status` | Server status, uptime, CPU/RAM |
| POST | `/api/servers/:id/start` | Start the server |
| POST | `/api/servers/:id/stop` | Stop the server |
| POST | `/api/servers/:id/restart` | Restart (with optional countdown) |
| POST | `/api/servers/:id/lock` | Lock server via RCON |
| POST | `/api/servers/:id/unlock` | Unlock server via RCON |

### Players & RCON
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:id/players` | List online players |
| POST | `/api/servers/:id/players/:pid/kick` | Kick a player |
| POST | `/api/servers/:id/players/:pid/ban` | Ban a player |
| GET | `/api/servers/:id/bans` | Get ban list |
| DELETE | `/api/servers/:id/bans/:banId` | Unban a player |
| POST | `/api/servers/:id/rcon` | Send RCON command |
| POST | `/api/servers/:id/message` | Broadcast message |

### Mods & Workshop
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:id/mods` | List installed mods |
| POST | `/api/servers/:id/mods/install` | Install a Workshop mod |
| DELETE | `/api/servers/:id/mods/uninstall/:wid` | Uninstall a mod |
| PATCH | `/api/servers/:id/mods/:wid` | Toggle or reorder a mod |
| GET | `/api/mods/install-status` | Installation progress |
| GET | `/api/workshop/search?q=` | Search Steam Workshop |
| GET | `/api/workshop/popular` | Popular/trending mods |
| GET | `/api/workshop/details/:id` | Mod details |

### Configuration & Files
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:id/config` | Read serverDZ.cfg |
| PATCH | `/api/servers/:id/config` | Update serverDZ.cfg |
| GET | `/api/servers/:id/files?dir=` | Browse directory |
| GET | `/api/servers/:id/files/read?file=` | Read text file |
| PUT | `/api/servers/:id/files/write` | Write file (auto-backup) |

### Logs & Metrics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:id/logs` | Server logs (filterable) |
| GET | `/api/servers/:id/metrics` | Historical metrics |
| GET | `/api/servers/:id/killfeed` | Recent kills from RPT logs |

### Scheduling
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:id/schedule` | List scheduled restarts |
| POST | `/api/servers/:id/schedule` | Create scheduled restart |
| DELETE | `/api/servers/:id/schedule/:taskId` | Delete schedule |

### Users & Roles
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user (password policy enforced) |
| PATCH | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Delete user |
| GET | `/api/roles` | List all roles |
| POST | `/api/roles` | Create custom role |
| PATCH | `/api/roles/:id` | Update role permissions |
| DELETE | `/api/roles/:id` | Delete custom role |

### Webhooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/webhooks` | List webhooks |
| POST | `/api/webhooks` | Create webhook |
| PATCH | `/api/webhooks/:id` | Update webhook |
| DELETE | `/api/webhooks/:id` | Delete webhook |
| GET | `/api/webhooks/:id/deliveries` | Delivery history |
| POST | `/api/webhooks/:id/test` | Test webhook |

### Other Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | Get notifications |
| PATCH | `/api/notifications/read` | Mark as read |
| GET | `/api/audit` | Audit log (paginated) |
| GET | `/api/backup/:type` | Download data backup |
| POST | `/api/restore/:type` | Restore from backup |
| GET | `/api/steam/status` | SteamCMD status |
| POST | `/api/steam/credentials` | Set Steam credentials |
| POST | `/api/deploy` | Deploy new server via SteamCMD |
| GET/POST/DELETE | `/api/watchlist` | Watchlisted players |
| GET/POST/DELETE | `/api/priority-queue` | Priority queue |
| GET | `/api/leaderboard` | Player leaderboard |

---

## Security

### Hardening Measures
- **spawn() over exec()** — All process spawning uses argument arrays to prevent shell injection
- **Path traversal protection** — `safePath()` validates all file operations against a base directory
- **Rate limiting** — 100 req/15min (API), 5 req/15min (auth), 30 req/15min (Discord)
- **Brute-force protection** — 5 failed login attempts triggers a 10-minute lockout
- **Password policy** — Minimum 8 characters, uppercase, lowercase, number, special character required
- **CORS allowlist** — Configurable via `CORS_ORIGINS` environment variable
- **JWT authentication** — 24-hour token expiry, required on all API routes
- **Fail-fast secrets** — Server refuses to start without `JWT_SECRET` and `DISCORD_BOT_API_KEY`
- **Fail-closed Discord admin** — If `DISCORD_ADMIN_ROLE_ID` is not set, all admin actions are denied
- **Secure cookies** — HttpOnly, Secure flags when HTTPS is enabled

### Production Checklist
- [ ] Set `JWT_SECRET` to a strong random string (`openssl rand -hex 32`)
- [ ] Set `DISCORD_BOT_API_KEY` to a strong random string
- [ ] Change default admin password
- [ ] Configure `CORS_ORIGINS` for your domain
- [ ] Use HTTPS (reverse proxy with nginx/caddy, or place cert.pem + key.pem in `cert/`)
- [ ] Restrict network access to trusted IPs
- [ ] Set up firewall rules for RCON port

---

## Deployment

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
npm install -g pm2

cd backend && pm2 start server.js --name citadel
cd discord-bot && pm2 start bot.js --name citadel-bot

pm2 save
pm2 startup
```

---

## Development

### Available Scripts

```bash
# From the project root:
npm test              # Run backend test suite (31 tests)
npm run lint          # Lint backend + frontend
npm run build         # Build frontend for production
npm run dev:backend   # Start backend with nodemon
npm run dev:frontend  # Start Vite dev server with HMR
```

### RCON Configuration

The panel includes a full BattlEye RCON client built on the [BattlEye RCon Protocol](https://www.battleye.com/downloads/BERConProtocol.txt) using Node.js `dgram`. No third-party RCON packages required.

Since DayZ 1.13+, you must set `RConPort` explicitly in `BEServer_x64.cfg`:

```cfg
RConPassword your-rcon-password
RConPort 2305
```

Set `DAYZ_RCON_PORT=2305` in `.env` to match.

### CI/CD

GitHub Actions runs on every push and PR to `main`:
- Backend lint (ESLint)
- Backend tests (Jest, 31 tests)
- Frontend lint (ESLint)
- Frontend build verification (Vite)

Tested on Node.js 18.x and 20.x, Windows.

---

## License

MIT
