# What is Citadel?

Citadel is an **enterprise-grade DayZ server management platform** that unifies server control, monitoring, and automation into a single self-hosted stack.

## The Problem

Managing DayZ servers traditionally requires juggling multiple disconnected tools — RCON clients, FTP file access, manual mod updates, hand-edited configs, and third-party services with their own APIs and billing. There's no single pane of glass.

## The Solution

Citadel replaces that fragmented workflow with one integrated platform:

| Component | Role |
|-----------|------|
| **Backend API** | Node.js Express server handling auth, RCON, scheduling, backups, mod management, and all business logic |
| **Web Dashboard** | React + Vite SPA for real-time monitoring, player management, file editing, and server control |
| **Sidecar Server** | Lightweight Node.js service running alongside your DayZ server, bridging file-based commands to the game |
| **DayZ Mod** | `@CitadelAdmin` EnScript mod that executes commands, tracks players, and logs events server-side |
| **Discord Bot** | Optional Discord integration with button controls, live status, and kill feed notifications |

## Key Principles

- **Zero third-party dependencies** — No external APIs or paid services required. Everything runs on your infrastructure.
- **Provider architecture** — The modular provider system lets you choose how commands reach your server (InHouse via Sidecar, or raw RCON).
- **File-based IPC** — The Sidecar ↔ Mod communication uses a simple JSON file queue in `$profile:Citadel/`, making it debuggable and transparent.
- **Multi-server ready** — Manage multiple DayZ server instances from a single dashboard.

## Tech Stack

- **Backend:** Node.js 20+, Express, Socket.IO, BattlEye RCON
- **Frontend:** React 18, Vite 6, CSS Modules
- **Sidecar:** Node.js, Express, Chokidar (file watcher)
- **DayZ Mod:** EnScript (DayZ scripting language)
- **Discord Bot:** discord.js v14
- **Data:** JSON file-based storage (no database required)
