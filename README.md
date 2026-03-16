# Citadel

An enterprise-grade web dashboard, Discord bot, and in-game admin mod for managing multiple DayZ servers. Built for teams that need reliable, secure server administration at scale.

![Status](https://img.shields.io/badge/status-production-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-Proprietary-red)
![Platform](https://img.shields.io/badge/platform-Windows-blue)

---

## Features

### Web Dashboard
- **Multi-server management** — Server Hub with per-instance monitoring and controls
- **Real-time metrics** — CPU, RAM, FPS, player count with live WebSocket updates
- **Live map** — Real-time player and vehicle positions on interactive map with in-game actions
- **Server controls** — Start, stop, restart with health monitoring and auto-restart
- **Rich console** — Live RPT log streaming + RCON output in a unified real-time console
- **Player management** — Online player list with kick/ban reason prompts, heal, teleport, spawn items, unstuck, freeze, message, strip gear, view loadout, teleport to player
- **RCON console** — Send BattlEye commands directly with command history
- **Mod manager** — Search Steam Workshop, install/uninstall/toggle mods, reorder load priority, mod cache
- **Config editor** — Edit `serverDZ.cfg` from the UI with validation
- **File browser** — Browse and edit server files with Monaco Editor and automatic backups
- **Restart scheduler** — Cron-based automatic restarts with presets and in-game warnings
- **Automated messenger** — Scheduled broadcast messages to players via RCON
- **Global ban database** — Centralized ban system with UUID-based shareable ban IDs, JSON export/import for sharing between server owners, automatic sync to all server `ban.txt` files on start/restart, configurable kick message with appeal URL
- **Log viewer** — Filterable real-time log stream by level and source (RPT, RCON, system)
- **Server deployment** — Deploy new servers via SteamCMD (stable and experimental branches)
- **Dangerzone** — Wipe missions, rebuild server files, full reinstall from the UI
- **User & role management** — Granular permissions with custom roles and audit logging
- **Webhook system** — Event-driven webhooks to Discord or any HTTP endpoint with retry logic
- **Notification center** — Real-time in-app notifications for server events
- **Priority queue (VIP)** — Automated VIP system with time-limited entries (30d/90d/1y/permanent/custom), role tiers (VIP/Supporter/Premium), automatic `priority.txt` sync to all servers, expiration cleanup, JSON import/export
- **Watchlist** — Track suspicious players across servers
- **Killfeed & leaderboard** — Parsed from RPT logs with player statistics
- **Automated backups** — Scheduled server file backups with retention policies
- **Firewall management** — Automatic Windows Firewall rule creation for server ports (elevated)
- **Windows Service** — Install Citadel as a Windows Service for auto-start on boot
- **First-run setup wizard** — Guided 7-step setup (admin account, network, SteamCMD, server profile, license activation)
- **Citadel Cloud integration** — Connect to Citadel Cloud for remote management, webhooks, and premium features
- **License activation** — Activate your plan directly in the setup wizard or from the License page

### In-Game Admin Mod (@CitadelAdmin)
- **Player actions** — Heal, kill, teleport, spawn items, strip gear, explode, unstuck, freeze, message, teleport to player
- **Vehicle actions** — Delete, repair, refuel, unstuck, explode, engine kill, eject driver, teleport to coordinates
- **World actions** — Set time, weather control, AI wipe, vehicle wipe
- **Config actions** — Live config reload without server restart
- **Player tracking** — Real-time position snapshots for live map
- **Event logging** — Kills, connections, disconnections, vehicle events
- **File-based IPC** — Commands relayed through the Citadel Sidecar (no network dependency)

### Discord Bot
- **Modular architecture** — 31-file enterprise structure (commands, handlers, UI, utils)
- **Interactive control panel** — Persistent button panel deployable in any channel
- **18 slash commands** — `/panel`, `/setup`, `/status`, `/players`, `/rcon`, `/broadcast`, `/restart`, `/playerinfo`, `/heal`, `/kill`, `/teleport`, `/spawnitem`, `/unstuck`, `/freeze`, `/strip`, `/explode`, `/dm`
- **Full mod management** — Install, uninstall, enable, disable mods from Discord
- **Admin actions** — Heal, kill, teleport, spawn items, unstuck, freeze, strip gear, explode, message player — all with player select menus
- **Live feeds** — Chat feed, killfeed, leaderboard, watchlist, time/weather from Discord
- **Per-user cooldowns** — Three-tier rate limiting (query 3s, admin 10s, control 30s)
- **Input validation** — Steam64 IDs, coordinates, workshop IDs, and broadcasts validated before API calls
- **Audit trail** — Every Discord action logged with Discord username attribution
- **Role-based permissions** — Admin actions restricted to a configurable Discord role (fail-closed)
- **Confirmation dialogs** — Prevents accidental server shutdowns
- **Modal inputs** — RCON commands, broadcasts, teleport coordinates, item spawning via Discord modals
- **Multi-server presence** — Bot status rotates through all servers showing total player count

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | Windows 10 or later (DayZ dedicated server is Windows-only) |
| **Node.js** | 18.x or later (bundled with installer, or [download](https://nodejs.org) for source installs) |
| **Administrator** | Required for firewall rule management and Windows Service installation |
| **DayZ Server** | A DayZ dedicated server installation (or deploy one through the UI) |
| **SteamCMD** | Required for mod installs and server deployment (configured via setup wizard) |
| **Discord App** | Optional — only needed for the Discord bot ([create one](https://discord.com/developers/applications)) |

> **Important:** Citadel must run with **Administrator privileges** to manage Windows Firewall rules for your server ports. Without admin rights, the firewall management will prompt for UAC elevation on each operation. See [Running as Administrator](#running-as-administrator) for recommended approaches.

---

## Quick Start

### Option A: Installer (Recommended)

Download the latest installer from [GitHub Releases](https://github.com/Sk3tch-Dev-Ux/DayzServerController/releases):

1. Download `CitadelSetup-x.x.x.exe` from the latest release
2. Run the installer (requires Administrator)
3. Open **http://localhost:3001** to start the setup wizard

The installer bundles everything (Node.js runtime, backend, frontend, Discord bot) and registers Citadel as a Windows Service that starts automatically on boot.

### Option B: From Source

```bash
git clone https://github.com/Sk3tch-Dev-Ux/DayzServerController.git
cd DayzServerController
npm install
npm start
```

This automatically installs dependencies, builds the frontend, and starts the backend. The Discord bot auto-starts if `DISCORD_BOT_TOKEN` is configured in `.env`. All components are managed by a single process — no separate terminal windows needed.

### Setup Wizard

On first launch, navigate to **http://localhost:3001** — you'll be redirected to the setup wizard:

1. **Welcome** — Introduction and overview
2. **Admin Account** — Create your admin username and password
3. **Network** — Configure your server IP address
4. **SteamCMD** — Configure SteamCMD path for mod management (or skip)
5. **First Server** — Add your first DayZ server (install directory, ports, RCON) or skip
6. **Citadel Cloud** — Activate your license key to unlock premium features (or skip for Free tier)
7. **Complete** — Summary of everything configured

After setup, log in with the credentials you created. You can always change your license or connect to Citadel Cloud later from the dashboard.

### Development Mode

```bash
# Start both backend and frontend with hot-reload
npm run dev
```

- **Backend API:** `http://localhost:3001`
- **Frontend Dev:** `http://localhost:5173` (proxies API to :3001)

---

## Architecture

Citadel runs three components, all managed automatically from a single `npm start`:

| Component | Purpose | Startup |
|-----------|---------|---------|
| **Backend** | Express API + web dashboard on port 3001 | Always starts |
| **Discord Bot** | 18+ slash commands, interactive panels, real-time server intel | Auto-starts if `DISCORD_BOT_TOKEN` is set in `.env` |
| **Sidecar** | Per-server file IPC bridge between backend and @CitadelAdmin mod | Auto-spawned when a DayZ server starts |

### Discord Bot

The Discord bot runs as a managed child process of the backend. If the bot crashes, it automatically restarts with exponential backoff (5s → 15s → 30s → 60s). To enable it, add these to your `.env`:

```env
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-client-id
DISCORD_GUILD_ID=your-guild-id
DISCORD_ADMIN_ROLE_ID=your-admin-role-id
DISCORD_BOT_API_KEY=a-shared-secret-key
```

If `DISCORD_BOT_TOKEN` is not set, the bot is simply skipped — no errors, no crash loops.

### Sidecar

Each DayZ server gets its own sidecar process that bridges the backend to the @CitadelAdmin mod via file-based IPC. Sidecars are automatically started when you start a server from the dashboard and stopped when the server stops. No manual management needed.

---

## Running as Administrator

Citadel needs Administrator privileges for:
- **Windows Firewall rules** — Creating inbound allow rules for game/query/RCON ports
- **Windows Service** — Installing and managing the Citadel service
- **Process management** — Starting and stopping DayZ server processes

### Option 1: Windows Service (Recommended for Production)

Install Citadel as a Windows Service that starts automatically on boot:

```bash
# Run from an Administrator terminal
npm run service:install    # Install the service
npm run service:start      # Start it
npm run service:status     # Check status
```

The service runs as `CitadelServer` under the Local System account (full admin rights). Manage it from the Windows Services panel or with:

```bash
npm run service:stop       # Stop the service
npm run service:uninstall  # Remove the service
```

### Option 2: Administrator Terminal

Right-click your terminal (Command Prompt, PowerShell, or Windows Terminal) and select **"Run as Administrator"**, then start Citadel normally:

```bash
npm start
```

### Option 3: PM2 (Run from Admin Shell)

```bash
npm install -g pm2

# From an Administrator terminal:
pm2 start backend/server.js --name citadel
# Discord bot is auto-managed by the backend — no separate PM2 entry needed
pm2 save
pm2 startup
```

> **Note:** If Citadel is not running as Administrator, firewall operations will trigger a UAC elevation prompt each time. The server will still function, but firewall rules must be approved individually.

---

## Configuration

The setup wizard generates a `.env` file automatically. You can also create it manually from `.env.example`:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Auto-generated | Secret for auth tokens (generated by setup wizard) |
| `ADMIN_USERNAME` | Yes | Admin login username |
| `ADMIN_PASSWORD` | Yes | Admin login password |
| `PORT` | No | API port (default: 3001) |
| `DAYZ_SERVER_IP` | Yes | Your DayZ server IP address |
| `DAYZ_INSTALL_DIR` | Yes | Path to DayZ server installation |
| `RCON_PASSWORD` | Yes | BattlEye RCON password |
| `DAYZ_RCON_PORT` | No | RCON port (default: 2305) |
| `DISCORD_BOT_TOKEN` | For bot | Discord bot token |
| `DISCORD_CLIENT_ID` | For bot | Discord application client ID |
| `DISCORD_GUILD_ID` | For bot | Your Discord server ID |
| `DISCORD_ADMIN_ROLE_ID` | For bot | Discord role ID for admin actions |
| `DISCORD_BOT_API_KEY` | For bot | Random key for bot-to-API auth |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
| `BAN_KICK_MESSAGE` | No | Custom ban kick message template (supports `{reason}` and `{banId}` placeholders) |
| `BAN_APPEAL_URL` | No | Discord invite or appeal URL shown in ban kick messages |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js, Express 4, Socket.IO 4, Pino logger |
| Frontend | React 18, Vite 6, Lucide React icons, Radix UI |
| Discord | Discord.js 14 (slash commands, buttons, modals, select menus) |
| Auth | JWT (jsonwebtoken), bcryptjs, role-based permissions |
| RCON | Custom BattlEye UDP client (dgram) |
| In-Game Mod | DayZ EnScript (@CitadelAdmin) |
| Sidecar | Node.js bridge between backend and DayZ mod (file-based IPC) |
| Steam | SteamCMD subprocess, Workshop API |
| Data | JSON file persistence (no database required) |
| Quality | Jest + Supertest, ESLint, GitHub Actions CI |

---

## Project Structure

```
Citadel/
├── backend/
│   ├── server.js              # Express + Socket.IO entry point
│   ├── lib/                   # Core libraries (47 modules)
│   │   ├── config.js          # Environment configuration
│   │   ├── context.js         # Global runtime state
│   │   ├── process-manager.js # Windows process management
│   │   ├── polling.js         # Metrics, status, and update polling
│   │   ├── rcon-client.js     # BattlEye RCON UDP client
│   │   ├── firewall-manager.js# Windows Firewall rule management
│   │   ├── server-lifecycle.js# Start/stop/restart orchestration
│   │   ├── sidecar-manager.js # Sidecar process lifecycle
│   │   ├── rpt-tailer.js      # RPT log streaming to console
│   │   ├── service-installer.js# Windows Service installer
│   │   ├── mod-manager.js     # Mod install/ordering/type management
│   │   ├── steamcmd.js        # SteamCMD wrapper
│   │   └── ...
│   ├── middleware/            # Auth, rate-limit, security
│   └── routes/                # 37 API route files
├── web/frontend/              # React 18 + Vite 6 SPA
│   └── src/
│       ├── pages/             # Dashboard page components
│       ├── components/        # Radix UI-based components
│       └── contexts/          # Auth, Socket, Toast providers
├── sidecar/                   # Node.js bridge to DayZ mod
├── dayz-mod/@CitadelAdmin/    # EnScript server-side mod
├── discord-bot/               # Modular Discord bot (commands, handlers, UI, utils)
├── data/                      # JSON file persistence (runtime)
├── docs/                      # VitePress documentation site
└── package.json               # Root workspace with service scripts
```

---

## Security

### Hardening Measures
- **spawn() over exec()** — All process spawning uses argument arrays to prevent shell injection
- **Input sanitization** — PowerShell command parameters sanitized (firewall rules, process names)
- **Path traversal protection** — `safePath()` validates all file operations against a base directory
- **Property allowlists** — PATCH endpoints only accept whitelisted fields (no mass-assignment)
- **XSS prevention** — HTML escaping on user-generated content in map markers and UI
- **Server-scoped auth** — `authForServer()` middleware enforces per-server permission boundaries
- **Rate limiting** — 100 req/15min (API), 5 req/15min (auth), 30 req/15min (Discord)
- **Brute-force protection** — 5 failed login attempts triggers a 10-minute lockout
- **Password policy** — Minimum 8 characters, uppercase, lowercase, number, special character required
- **CORS allowlist** — Configurable via `CORS_ORIGINS` environment variable
- **JWT authentication** — 24-hour token expiry, required on all API routes
- **Fail-fast secrets** — Server refuses to start without `JWT_SECRET` and `DISCORD_BOT_API_KEY`
- **Fail-closed Discord admin** — If `DISCORD_ADMIN_ROLE_ID` is not set, all admin actions are denied
- **Discord input sanitization** — Steam64 IDs, coordinates, workshop IDs validated; broadcasts sanitized; markdown escaped in player names
- **Discord cooldowns** — Per-user per-action rate limiting (query 3s, admin 10s, control 30s)
- **Discord audit attribution** — All bot actions logged with Discord username and user ID
- **Credential stripping** — RCON passwords never included in API responses
- **Concurrent operation guards** — Prevents duplicate restart operations on the same server
- **Elevated firewall ops** — Firewall rules use UAC elevation with temp script files (no persistent admin shell)

### Production Checklist
- [ ] Run Citadel as Administrator (Windows Service recommended)
- [ ] Set strong `ADMIN_PASSWORD` during setup wizard
- [ ] Configure `CORS_ORIGINS` for your domain
- [ ] Use HTTPS (reverse proxy with nginx/caddy)
- [ ] Restrict network access to trusted IPs
- [ ] Set up BattlEye RCON password in `BEServer_x64.cfg`
- [ ] Review user roles and permissions after initial setup

---

## Deployment

### Windows Service (Recommended)

```bash
# From an Administrator terminal:
npm run service:install
npm run service:start
```

The `CitadelServer` Windows Service:
- Starts automatically on boot
- Runs under Local System account
- Restarts on failure
- Manageable via Windows Services panel (`services.msc`)

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

### PM2 (Alternative)

```bash
npm install -g pm2

pm2 start backend/server.js --name citadel
# Discord bot is auto-managed by the backend — no separate PM2 entry needed

pm2 save
pm2 startup
```

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
| `/playerinfo <steamid>` | Look up a player's stats and history | Yes |
| `/heal <steamid>` | Heal a player to full health | Yes |
| `/kill <steamid>` | Kill a player | Yes |
| `/teleport <steamid> <x> <y> [z]` | Teleport a player to coordinates | Yes |
| `/spawnitem <steamid> <item> [qty]` | Spawn an item on a player (max 100) | Yes |
| `/unstuck <steamid>` | Teleport a stuck player to the surface | Yes |
| `/freeze <steamid> [unfreeze]` | Freeze or unfreeze a player in place | Yes |
| `/strip <steamid>` | Strip all gear from a player | Yes |
| `/explode <steamid>` | Explode a player | Yes |
| `/dm <steamid> <message>` | Send a direct message to a player | Yes |

---

## Development

### Available Scripts

```bash
# From the project root:
npm start             # Setup + build + start production
npm run dev           # Start backend + frontend with hot-reload
npm test              # Run backend test suite
npm run lint          # Lint backend + frontend
npm run build         # Build frontend for production
npm run dev:backend   # Start backend with nodemon
npm run dev:frontend  # Start Vite dev server with HMR

# Windows Service management:
npm run service:install    # Install as Windows Service
npm run service:uninstall  # Remove Windows Service
npm run service:start      # Start the service
npm run service:stop       # Stop the service
npm run service:status     # Check service status

# Documentation:
npm run docs:dev      # Start VitePress dev server
npm run docs:build    # Build documentation site
```

### RCON Configuration

The panel includes a full BattlEye RCON client built on the [BattlEye RCon Protocol](https://www.battleye.com/downloads/BERConProtocol.txt) using Node.js `dgram`. No third-party RCON packages required.

Since DayZ 1.13+, you must set `RConPort` explicitly in `BEServer_x64.cfg`:

```cfg
RConPassword your-rcon-password
RConPort 2305
```

### CI/CD

GitHub Actions runs on every push and PR to `main`:
- Backend lint (ESLint)
- Backend tests (Jest)
- Frontend lint (ESLint)
- Frontend build verification (Vite)

### Releases

Pushing a version tag triggers the release workflow which builds the NSIS installer and publishes it as a GitHub Release:

```bash
git tag v2.1.0
git push --tags
```

The workflow runs on `windows-latest`, builds the installer via `node installer/build.js`, and uploads `CitadelSetup-x.x.x.exe` as a release asset. Tags containing `-beta` or `-rc` are marked as pre-releases.

---

## Documentation

Full documentation is available at the VitePress docs site:

```bash
npm run docs:dev
```

Covers architecture, environment variables, provider system, DayZ mod setup, and more.

---

## License

Proprietary. Copyright (c) 2024-2026 Sk3tch Dev. All rights reserved. See [LICENSE](LICENSE) for details.
