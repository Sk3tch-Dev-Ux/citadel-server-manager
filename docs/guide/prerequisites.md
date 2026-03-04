# Prerequisites

Before installing Citadel, ensure you have the following.

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **OS** | Windows 10 | Windows Server 2019+ or Windows 11 |
| **Node.js** | 18.x | 20.x+ (LTS) |
| **npm** | 9.x | 10.x+ |
| **RAM** | 512 MB | 1 GB+ |
| **Disk** | 100 MB | 500 MB+ (for backups, mod cache, and logs) |
| **Privileges** | Administrator | Administrator |

::: warning Windows Only
DayZ dedicated servers only run on Windows. Citadel is designed for Windows and uses Windows-specific features (tasklist, taskkill, PowerShell, Windows Firewall, Windows Services).
:::

::: danger Administrator Required
Citadel must run with **Administrator privileges** for full functionality:
- **Windows Firewall** — Creating inbound allow rules for game, query, and RCON ports
- **Windows Service** — Installing and managing the Citadel service
- **Process management** — Starting and stopping DayZ server processes

Without admin rights, firewall operations will trigger individual UAC prompts. See the [Running as Administrator](/guide/backend-setup#running-as-administrator) section for setup options.
:::

## Network Requirements

| Connection | Port | Protocol | Notes |
|------------|------|----------|-------|
| Backend API | 3001 (default) | HTTP/WS | Configurable via `PORT` env var |
| Sidecar API | 9100 (default) | HTTP | Only needs to be reachable from Backend |
| DayZ Game | 2302 (default) | UDP | Firewall rules auto-created by Citadel |
| DayZ Query | 2303 (default) | UDP | Firewall rules auto-created by Citadel |
| BattlEye RCON | 2305 (default) | TCP | Firewall rules auto-created by Citadel |
| Frontend Dev | 5173 | HTTP | Development only |

::: tip Automatic Firewall Rules
Citadel automatically creates Windows Firewall inbound allow rules for your server's game, query, and RCON ports when a server starts. This requires Administrator privileges. Rule names follow the convention: `Citadel - {ServerName} - Game ({port} UDP)`.
:::

::: warning Sidecar Security
The Sidecar port (9100) should **not** be exposed to the public internet. Use a private network or VPN between your backend and DayZ server if they're on separate machines.
:::

## Software Dependencies

### Required

- [Node.js](https://nodejs.org/) 18.x or later
- [Git](https://git-scm.com/) for cloning the repository
- A running DayZ Dedicated Server instance (or deploy one through the Citadel UI)

### Optional

- [SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) — Required for mod installs and server deployment (can be configured during setup wizard)
- [Discord Application](https://discord.com/developers/applications) — Required for the Discord bot
- [PM2](https://pm2.keymetrics.io/) — Alternative process manager (Windows Service is recommended instead)

## Next Steps

- [Getting Started](/guide/getting-started) — Quick start guide
- [Backend Setup](/guide/backend-setup) — Detailed backend installation and deployment
