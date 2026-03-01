# Prerequisites

Before installing Citadel, ensure you have the following.

## System Requirements

### Backend + Dashboard Host

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **OS** | Windows 10 / Linux / macOS | Windows Server 2019+ or Ubuntu 22.04+ |
| **Node.js** | 20.x | 22.x (LTS) |
| **npm** | 9.x | 10.x+ |
| **RAM** | 512 MB | 1 GB+ |
| **Disk** | 100 MB | 500 MB+ (for backups and logs) |

### DayZ Server Host (Sidecar + Mod)

| Requirement | Details |
|-------------|---------|
| **OS** | Windows (DayZ dedicated server is Windows-only) |
| **Node.js** | 20.x+ (for the Sidecar) |
| **DayZ Server** | Steam Dedicated Server with `-mod` support |

::: tip Co-located Setup
The simplest deployment runs everything on the same Windows machine as your DayZ server. The backend, sidecar, and mod all share the same filesystem.
:::

## Network Requirements

| Connection | Port | Protocol | Notes |
|------------|------|----------|-------|
| Backend API | 3000 (default) | HTTP/WS | Configurable via `PORT` env var |
| Sidecar API | 9100 (default) | HTTP | Only needs to be reachable from Backend |
| BattlEye RCON | 2302+ | UDP | Only if using RCON provider |
| Frontend Dev | 5173 | HTTP | Development only |

::: warning Firewall
The Sidecar port (9100) should **not** be exposed to the public internet. Use a private network or VPN between your backend and DayZ server if they're on separate machines.
:::

## Software Dependencies

### Required

- [Node.js](https://nodejs.org/) 20.x or later
- [Git](https://git-scm.com/) for cloning the repository
- A running DayZ Dedicated Server instance

### Optional

- [PM2](https://pm2.keymetrics.io/) — Process manager for production deployments
- [SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) — Required for mod/workshop management features
- [Discord Application](https://discord.com/developers/applications) — Required for the Discord bot

## Next Steps

- [Getting Started](/guide/getting-started) — Quick start guide
- [Backend Setup](/guide/backend-setup) — Detailed backend installation
