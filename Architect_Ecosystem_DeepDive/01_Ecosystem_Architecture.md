# 01 — Ecosystem Architecture

## The four tiers

Architect composes four independently-deployable tiers. Each has a single responsibility and a clean boundary; they are glued by exactly two protocols (OAuth2/HTTPS up to the cloud, and `SMP1.0` over WebSocket between Manager and Agent).

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  TIER 1 — CFTools Cloud  (external SaaS, multi-region)                          │
│                                                                                 │
│   app.cftools.cloud        OAuth2 PKCE identity / login                         │
│   api.cftools.cloud        userinfo, token, entitlements (Bearer)               │
│   cdn.gameserver.cloud     Workshop mod catalog JSON + Manager auto-update      │
│   (priority API)           reserved-slot / queue-skip provider                  │
│   sentry.cftools.cloud     crash + error telemetry                              │
│   gw-architect.cftools.ru  Russia region gateway (failover/locale)             │
└───────▲───────────────────────────────────────────────────▲────────────────────┘
        │ OAuth2 PKCE + Bearer                                │ proxy RPCs (universe_status,
        │ (Manager MAIN process)                              │ installation_details, titles)
        │                                                     │ + Priorities API polling
        │                                                     │ (Agent → cloud, every 5 min)
┌───────┴──────────────────────────┐         ┌───────────────┴───────────────────────┐
│  TIER 2 — Architect Manager      │  SMP1.0 │  TIER 3 — Architect Agent              │
│  Electron 29 + Vue 3 + Pinia     │ ◄═════► │  Go daemon · ArchitectAgent.exe v1.1.34│
│  architect_manager.exe v1.1.205  │  WSS    │  Windows service, runs as Administrator │
│                                  │  :8090  │                                         │
│  • Renderer = the SMP1.0 client  │         │  HTTPS + WSS server  0.0.0.0:8090        │
│  • Main = cloud/OAuth + IPC only │         │  ┌─────────────────────────────────┐    │
│  • Monaco editor, Chart.js,      │         │  │ WEBSOCKET HANDLER (SMP1.0 + auth)│    │
│    globe.gl, rrweb, Sentry       │         │  │ SERVER MANAGER → SERVER OBSERVER │    │
│  • connections.json (agent creds)│         │  │ TITLE MANAGER → TITLE/MOD OBSERVER│   │
└──────────────────────────────────┘         │  │ EVENT MANAGER (webhooks)        │    │
                                              │  │ DATABASE (SQLite + 3h backup)   │    │
                                              │  │ fail2ban · RBAC · audit         │    │
                                              │  └─────────────────────────────────┘    │
                                              └───────────────┬─────────────────────────┘
                                                              │ spawns / supervises / RCON
                                              ┌───────────────▼─────────────────────────┐
                                              │  TIER 4 — Deployment "AxiomMain"         │
                                              │  DayZServer_x64.exe (Chernarus, 60 slots)│
                                              │  + 17 Steam Workshop mods                │
                                              │  + serverDZ.cfg / dayzsetting.xml /       │
                                              │    gamelabs.cfg / profiles / battleye     │
                                              │  ◄── BattlEye RCON (port 2305)            │
                                              │  ──► GameLabs metrics dump (JSON)         │
                                              │  ──► A2S query (port 2303)                │
                                              └───────────────────────────────────────────┘
                                                              │
                                              ┌───────────────▼─────────────────────────┐
                                              │  Players  ── DZSA Launcher / direct ──►   │
                                              │  join via game port 2302                  │
                                              └───────────────────────────────────────────┘
```

## Component inventory

| # | Component | Binary / artifact | Tech | Role |
|---|-----------|-------------------|------|------|
| 1 | **Agent** | `ArchitectAgent.exe` (38 MB) | Go | Host daemon; the engine. Owns process supervision, mods, RCON, metrics, auth, API |
| 2 | **Manager** | `architect_manager.exe` (176 MB) | Electron 29 / Vue 3 | Operator GUI; remote control client |
| 3 | **Cloud** | `*.cftools.cloud`, `cdn.gameserver.cloud` | SaaS | Identity, mod catalog, priority queue, updates, telemetry |
| 4 | **Deployment** | `deployments/AxiomMain/` | DayZ server + PBOs | The game server being hosted |
| 5 | **Database** | `db/ArchitectAgent.db` (70 MB) | SQLite | Agent's state + telemetry store |
| 6 | **Config** | `config.toml` | TOML | Agent boot/runtime configuration |
| 7 | **Certs** | `certs/cert.pem`, `cert.key.pem` | self-signed | TLS for :8090 (issuer org "CFTools Architect") |

## The two glue protocols

1. **Manager ⇄ Agent — `SMP1.0`** (see `03_SMP_Protocol_and_RPC_API.md`)
   - Transport: WebSocket over TLS (`wss://host:8090/ws`), plus side-channel `POST /upload` and `POST /download` for binary.
   - Auth: HTTP Basic (username + password), also presented as WebSocket subprotocol tokens.
   - Payload: JSON-RPC envelopes `{action, parameters, idempotence}` with async correlation.

2. **Manager/Agent ⇄ CFTools Cloud — HTTPS** (see `06_CFTools_Cloud.md`)
   - Manager main process: OAuth2 PKCE → Bearer token → `api.cftools.cloud`.
   - Agent: outbound `proxy` RPCs (forwarded on the Manager's behalf) + a 5-minute Priorities poll. The Agent maintains a persistent "Cloud Controller" connection (`WEBSOCKET HANDLER: Attempting to connect to the Cloud Controller...` at boot).

## Why the split matters (design rationale)

- **The Agent is title-agnostic.** At boot it starts *Title Observers* for `dayz_pc`, `dayz_experimental_pc`, `arma_reforger_pc`, `rust_pc`, `squad`, `scum`, `valheim`, `sdtd`, `palworld`, `pzomboid`, `enshrouded`, and more (see boot log in `02_Architect_Agent.md`). DayZ is one plugin among many. The hosting engine is generic; the DayZ-specific knowledge lives in the *title definition* and the deployment.
- **The Manager holds no game logic.** Everything it can do is an `SMP1.0` action the Agent implements. You could drive the Agent with `curl`/a WebSocket client and never run the Manager.
- **The Cloud adds the "powerful" differentiators** that a local-only panel cannot: curated mod catalog, reserved-slot priority queue, DZSA publishing, centralized identity, and license enforcement.
- **Multi-tenancy is built in but dormant.** The DB has `user_space` scoping on most tables and an empty `user_spaces` table with `system_username`/`system_password` columns — the same Agent code can run a shared multi-customer host, though this install is single-operator (`root` only).

## Data-flow overview (one line each)

- **Control:** Operator → Manager renderer → `SMP1.0`/WSS → Agent WEBSOCKET HANDLER → subsystem → action result back over the same socket.
- **Mods:** CFTools CDN catalog → Manager UI → `install_mod`/`mod_rebuild` → Agent SteamCMD download → integrity snapshot → mod↔server binding → scheduled restart.
- **Telemetry up:** DayZ engine + GameLabs → Agent collectors (5 s server / 10 s host) → SQLite `*_metrics` → streamed to Manager charts on subscribe.
- **Players in:** DZSA Launcher (refreshed every 60 s by Agent) / direct connect → DayZ game port 2302 → BattlEye → priority/queue mediated by Agent's Priorities ticker.
- **Notifications out:** Agent EVENT MANAGER → templated webhook → Discord; every operator action → audit row.

Continue with `02_Architect_Agent.md`.
