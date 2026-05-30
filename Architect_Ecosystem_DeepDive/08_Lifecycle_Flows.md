# 08 — End-to-End Lifecycle Flows

This document traces the major operations bit-by-bit, showing how all four tiers cooperate. Each flow names the subsystems and messages involved.

---

## Flow A — Cold boot of the host

```
Windows service start
 └─ ArchitectAgent.exe
    1. AGENT: opt out of power throttling (best-effort)
    2. AGENT: self-update — "Replacing agent binary..." (updates\ → swap)
    3. AGENT: "Starting ArchitectAgent service." → write v1.1.34 to registry/Uninstall
    4. WEBSOCKET HANDLER: connect to Cloud Controller  (uplink for proxy/universe_status)
    5. EVENT MANAGER: warm up
    6. AGENT: "Agent started (version 1.1.34)."
    7. TITLE MANAGER: start a Title Observer per supported title (dayz_pc, rust_pc, ...)
    8. AGENT: HTTP server goroutine started ×2  → routes registered ×2  (listening on :8090)
    9. TITLE MANAGER: start a Mod Observer per installed Workshop id
   10. SERVER MANAGER: start Server Observer for AxiomMain (state = server.running)
   11. AxiomMain: Queue grace enabled; backup-deletion ticker (3 d); Priority ticker (300 s)
   12. DATABASE: schedule 3-hourly self-backup
```
The Agent reconciles each server to its last persisted state. If `AxiomMain` was `server.running` but no PID exists, the Observer relaunches it.

---

## Flow B — Operator login (two independent auth planes)

```
Manager launch
 ├─ (optional) Cloud login:
 │   main → browser → app.cftools.cloud (OAuth2 PKCE/S256)
 │   → /callback (loopback) → exchange code at api.cftools.cloud/v1/oauth2/token
 │   → Bearer; /v1/oauth2/userinfo
 └─ Agent connect (renderer):
     new WebSocket("wss://host:8090/ws", ["SMP1.0", user, pass])
     Agent: bcrypt check + fail2ban  → upgrade
     renderer bootstrap:
       whoami → {permissions}   (UI gating)
       request_system_info
       proxy installation_details   (Agent → Cloud Controller → back)
       request_agent_health
       enable_stdout (if permitted)
     → every action now logs an audit row {date,user,session,ip,action,params}
```

---

## Flow C — Install a mod and roll it out

```
Manager Mods screen
 1. main: fetch catalog  GET cdn.gameserver.cloud/workshop/dayz.json  (cached, hourly)
 2. operator picks a mod → renderer: install_mod {entity_id, server:"AxiomMain", universe:"steam"}
 3. Agent TITLE MANAGER: SteamCMD download via tuned CDN ([steam_servers]); downloads row logged
 4. Agent: compute SHA-1 integrity snapshot of the new PBOs (stored on servers.details)
 5. Agent: write mods row (id,name,version) + mod_server_bindings (mod ↔ AxiomMain)
 6. Mod Observer now watches that id for future Workshop version changes
 7. SERVER OBSERVER: schedule coordinated restart (Flow D) to load the new -mod= chain
 8. DZSA publish (≤60 s later): players see the updated mod list to re-sync
```
Future auto-update: a Mod Observer detecting a new Workshop version repeats 3–7 automatically.

---

## Flow D — Graceful restart with RCON countdown

```
Trigger: operator `restart`  | scheduled task | mod/build update
 1. SERVER OBSERVER: lock server  ("blocked for action server.stopping")
 2. RCON (BattlEye, port 2305): broadcast countdown — "say -1 Restart in N minutes"
       (logged to AxiomMain_rcon)
 3. At T-0: lock login queue, kick remaining players, stop DayZServer_x64.exe
 4. server_events: server.changed_state (running → stopping → stopped); DB record cleaned
 5. (optional) create_backup → AxiomMain_backup
 6. SERVER OBSERVER: relaunch DayZServer_x64.exe with assembled -mod= chain + params
 7. EVENT MANAGER: match event → deliver webhook(s) (Flow G)
 8. metrics collector resumes 5 s sampling; Manager dashboards update on the open socket
```
A `server_stop` without restart stops at step 4; `server_stop_cancel` aborts the countdown; `server_force_kill` skips the graceful steps (used when PID is unresponsive — note the live log's `pid=0` force-kill errors when the process was already gone).

---

## Flow E — The metrics pipeline (continuous)

```
Host counters ─10s─►  agent_metrics collector  ─► agent_metrics table (cpu/mem/goroutines/disk/net)
DayZ + GameLabs ─5s─►  AxiomMain collector
       │                   ├─ A2S query (port 2303) → player count
       │                   └─ read profiles\gamelabs_metrics.json → serverFps, aiCount,
       │                                                            entityCount, tickTime
       └─────────────────► AxiomMain_metrics table (append-only)
Manager subscribe {topic:"AxiomMain"} ─► Agent pushes live points ─► Chart.js dashboards
```
No pruning on these tables → the DB grows ~linearly (see `09_*`).

---

## Flow F — File edit (Monaco / external editor)

```
renderer: server_filetree {server,root,levels} → tree
renderer: read_file → Monaco editor (or main writes temp file, opens OS editor, watches)
operator edits → write_file (or watcher streams change back)
Agent writes into deployments\AxiomMain\... ; audit row recorded
(large/binary: POST /upload, POST /download {token}; capped 30 MB)
```
This is how `types.xml`, `cfggameplay.json`, Expansion JSONs, `serverDZ.cfg`, etc. are edited in-app.

---

## Flow G — Event → webhook delivery

```
Some event fires (server state change, update, custom)
 EVENT MANAGER: match event against webhooks rows (event filters)
   match?  → render templated payload → POST to Discord webhook URL
            → log webhook_deliveries {payload, response, status}
   no match → log "No Webhooks found for current event." (seen repeatedly at boot)
```

---

## Flow H — Priority / reserved-slot sync (every 300 s)

```
Priority ticker fires
 Agent → CFTools priority API  (priorityApiKey + priorityServer GUID)
   success → apply reserved-slot list to login queue (with serverDZ.cfg loginQueue* + queue grace)
   failure → ERROR "Priorities provider returned an error. Raw={results:null,status:false}"
             (CURRENT STATE on this host — key/binding needs fixing; see 09_*)
Player joins (game port 2302) → BattlEye → queue: priority players skip ahead of the 5-concurrent gate
```

---

## Flow I — Player discovery & join

```
Agent ─every 60s─► DZSA Launcher: publish status + full mod list
Player in DZSA: one-click subscribe to exact mod set → launch DayZ → connect host:2302
BattlEye handshake + verifySignatures=2 (signed PBOs) → login queue (priority-mediated) → in-world
GameLabs begins emitting that player's activity into metrics dump → Agent → charts
```

---

## Putting it together (the "in unison" picture)

At steady state on this host, concurrently:
- WEBSOCKET HANDLER services Manager RPCs + streams telemetry, and proxies `universe_status` to the cloud every ~10 s.
- SERVER OBSERVER keeps `DayZServer_x64.exe` alive and reconciled.
- Two metrics collectors append to SQLite (5 s / 10 s).
- The Priority ticker polls every 300 s; the DZSA publisher every 60 s; the DB self-backup every 3 h; backup-cleanup every 3 d.
- Mod/Title Observers watch for Workshop/build updates and can trigger Flow D unattended.
- Every operator action is gated by RBAC, throttled by fail2ban, and written to the audit log.

Continue with `09_Security_and_Operational_Notes.md`.
