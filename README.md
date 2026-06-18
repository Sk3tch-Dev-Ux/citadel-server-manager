# Citadel Agent

The local DayZ server management app for Windows. Install, configure, mod, and operate dedicated servers from one desktop dashboard running on the box that hosts them.

**Citadel Agent** (this repo) handles everything that touches the server's actual files and process: SteamCMD installs, mod management, `serverDZ.cfg`, mission and profile folders, launch parameters, backups, RPT/crash logs, and start/stop/restart controls.

**Citadel Cloud** (separate, optional, at [citadel-hub.com](https://citadel-hub.com/cloud)) is the remote layer that pairs with the Agent: scheduled restarts, automated messages, multi-server fleet view, the Trust Network ban database, alerts, and Discord bot — anything that needs centralized infrastructure or has to keep running when the owner's PC is asleep.

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
- **Windows Service** — Install Citadel Agent as a Windows Service for auto-start on boot
- **First-run setup wizard** — Guided 6-step setup (welcome, admin account, network, SteamCMD, first server, completion). License activation happens afterward from the License page.
- **License activation** — Activate your subscription from the setup wizard or License page (verifies against [citadel-hub.com](https://app.citadel-hub.com/account))
- **Citadel Cloud pairing (optional)** — Connect to [Citadel Cloud](https://citadel-hub.com/cloud) to add remote control, automations (scheduled restarts/messages), the Trust Network shared-ban database, alerts, and the Citadel Discord bot. Everything in the feature list above runs locally without it.

### In-Game Admin Mod (@CitadelAdmin)
- **Player actions** — Heal, kill, teleport, spawn items, strip gear, explode, unstuck, freeze, message, teleport to player
- **Vehicle actions** — Delete, repair, refuel, unstuck, explode, engine kill, eject driver, teleport to coordinates
- **World actions** — Set time, weather control, AI wipe, vehicle wipe
- **Config actions** — Live config reload without server restart
- **Player tracking** — Real-time position snapshots for live map
- **Event logging** — Kills, connections, disconnections, vehicle events
- **File-based IPC** — Commands relayed through the Citadel Sidecar (no network dependency)

### Discord Bot (now part of Citadel Cloud)
The Citadel Discord bot — interactive control panel, slash commands, live feeds,
and Discord-driven admin actions — was extracted out of the Agent in the v2.19.0
product split. It now lives in the separate **[citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot)**
repo and is hosted by [Citadel Cloud](https://citadel-hub.com/cloud), so its uptime
no longer depends on the owner's home PC.

The Agent still exposes the `/api/discord/*` API surface that the bot calls into,
so a self-hosted citadel-bot (or the Cloud-hosted one) authenticates and operates
against your local Agent as before. The Agent itself no longer launches the bot.

> The bundled `discord-bot/` directory was removed from this repo after the
> one-release migration window (v2.23.0). Run the bot from the citadel-bot
> repo or use the Cloud-hosted one.

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

Download the latest installer from [GitHub Releases](https://github.com/Sk3tch-Dev-Ux/citadel-server-manager/releases):

1. Download `CitadelSetup-x.x.x.exe` from the latest release
2. Run the installer (requires Administrator)
3. Open **http://localhost:3001** to start the setup wizard

The installer bundles everything (Node.js runtime, backend, frontend) and registers Citadel as a Windows Service that starts automatically on boot. (The Discord bot is no longer bundled — it ships separately via [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot) / Citadel Cloud.)

### Option B: From Source

```bash
git clone https://github.com/Sk3tch-Dev-Ux/citadel-server-manager.git
cd citadel-server-manager
npm install
npm start
```

This automatically installs dependencies, builds the frontend, and starts the backend. The Discord bot is no longer part of the Agent — run it from [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot) (or use the Cloud-hosted bot) and point it at this Agent's `/api/discord/*`. All Agent components are managed by a single process — no separate terminal windows needed.

### Setup Wizard

On first launch, navigate to **http://localhost:3001** — you'll be redirected to the setup wizard:

1. **Welcome** — Introduction and overview
2. **Admin Account** — Create your admin username and password
3. **Network** — Configure your server IP address
4. **SteamCMD** — Configure SteamCMD path for mod management (or skip)
5. **First Server** — Add your first DayZ server (install directory, ports, RCON) or skip
6. **Complete** — Summary of everything configured

After setup, log in with the credentials you created. License activation is **not** part of the wizard — activate your subscription afterward from the **License page** (email + password against [citadel-hub.com](https://app.citadel-hub.com/account)), and connect to Citadel Cloud whenever you like from the dashboard.

### Development Mode

```bash
# Start both backend and frontend with hot-reload
npm run dev
```

- **Backend API:** `http://localhost:3001`
- **Frontend Dev:** `http://localhost:5173` (proxies API to :3001)

---

## Architecture

The Agent runs two components, both managed automatically from a single `npm start`:

| Component | Purpose | Startup |
|-----------|---------|---------|
| **Backend** | Express API + web dashboard on port 3001 | Always starts |
| **Sidecar** | Per-server file IPC bridge between backend and @CitadelAdmin mod | Auto-spawned when a DayZ server starts |

The Discord bot is a separate process that lives in its own repo / Citadel Cloud — see [Discord Bot](#discord-bot-now-part-of-citadel-cloud) above. The Agent only exposes the `/api/discord/*` surface it calls into.

### Discord Bot

The Discord bot was extracted to the [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot) repo and is hosted by [Citadel Cloud](https://citadel-hub.com/cloud). The Agent **does not** launch it. Self-hosters run citadel-bot independently and point it at this Agent via `DISCORD_BOT_API_KEY` (the shared secret the Agent issues for `/api/discord/*` calls).

> **Legacy escape hatch (removed):** the `CITADEL_AGENT_SPAWN_BOT=1` flag used to spawn a bundled `discord-bot/` as a managed child process. That directory was removed from the repo after v2.23.0, so the flag now logs a notice and skips — run [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot) as its own process instead.

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
# The Discord bot is a separate process (citadel-bot repo / Cloud) — not managed here
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
| Discord | `/api/discord/*` integration surface (the bot itself lives in [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot)) |
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
├── desktop/                   # Electron wrapper (packaged installer shell)
├── installer/                 # NSIS installer + build.js staging script
├── data/                      # JSON file persistence (runtime)
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
# The Discord bot is a separate process (citadel-bot repo / Cloud) — not managed here

pm2 save
pm2 startup
```

---

## Discord Bot

The Discord bot is no longer part of the Agent. It lives in the
**[citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot)** repo and is
hosted by [Citadel Cloud](https://citadel-hub.com/cloud).

- **Cloud-hosted:** connect your Discord from [citadel-hub.com/cloud](https://citadel-hub.com/cloud) — no token wrangling, and it stays online when your PC is asleep.
- **Self-hosted:** clone [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot) and follow its README to create the Discord application, set the token, and invite it. Point it at this Agent's API and the `DISCORD_BOT_API_KEY` the Agent issues; the bot calls into the Agent's `/api/discord/*` surface to drive RCON, player actions, mod management, and live feeds.

The full slash-command reference (`/panel`, `/status`, `/players`, `/rcon`, `/restart`, the admin player actions, etc.) is documented in the citadel-bot repo, which owns that code.

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

## License

Proprietary. Copyright (c) 2024-2026 Sk3tch Dev. All rights reserved. See [LICENSE](LICENSE) for details.
