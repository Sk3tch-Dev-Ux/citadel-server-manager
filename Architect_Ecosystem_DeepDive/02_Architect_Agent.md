# 02 — The Architect Agent (Go daemon)

The Agent is the engine of the whole platform. It is a single Go binary, `ArchitectAgent.exe` (~38 MB), installed at:

```
C:\Program Files (x86)\CFTools Software GmbH\Architect\Agent\
```

It runs as a **Windows service** under an Administrator-class account (it manipulates process power-throttling, CPU affinity, and writes Program Files), and it is the *only* component that touches the game server directly.

---

## 1. Filesystem layout

```
Agent\
├─ ArchitectAgent.exe        the daemon (self-updating — see §3)
├─ uninstall.exe
├─ config.toml               boot/runtime config (§2)
├─ root.txt                  one-time root password reveal (PLAINTEXT — see security doc)
├─ applications\             generic "application instances" (non-game services) — empty here
├─ backups\                  server/deployment backup archives
├─ cache\                    transient working data
├─ certs\                    cert.pem + cert.key.pem  (TLS for :8090)
├─ db\                       ArchitectAgent.db (70 MB) + .db.backup (3-hourly copy)
├─ deployments\              one folder per managed server  → AxiomMain\ (Tier 4)
├─ logs\                     ArchitectAgent-<ISO timestamp>.log (one per start, JSON-line)
├─ plugins\                  agent plugin slots — empty here
├─ scripts\                  scheduled-script bodies — empty here (engine dormant)
└─ updates\                  staging area for self-update payloads
```

The canonical paths are pinned in `config.toml`'s `[filesystem]` block, so the Agent never guesses where things are.

---

## 2. `config.toml` — line by line

The Agent's entire runtime posture is declared here. Sections and their meaning:

### `[authorization]`
| Key | Value (this host) | Meaning |
|-----|-------|---------|
| `disable_remote_root` | `false` | The `root` user may authenticate from a remote IP (not just localhost). |
| `fail2ban_attempts` | `10` | After 10 failed auth attempts an IP is banned. |
| `fail2ban_ban_time` | `60` | Ban duration in seconds. |
| `license_key` | *(base64 JWT)* | The product license. It is a base64-wrapped JWT; decoded it carries `v` (version), `i` (instance id), `s` (a GUID), `c` (issued time `2024-12-05T15:18:11`), `t` ("Y"), and an HS256 signature. This gates the Agent's right to run and is validated against the cloud. |

### `[cloud_controller]`
| Key | Value | Meaning |
|-----|-------|---------|
| `keepalive` | `false` | Whether to hold the Cloud Controller socket open with keepalives. |
| `keepalive_interval` | `60` | Keepalive cadence (s) when enabled. |

At boot the WEBSOCKET HANDLER logs `Attempting to connect to the Cloud Controller...` — this is the persistent uplink to CFTools used for `proxy` actions and entitlement.

### `[config_system]`
`version = "NA=="` — base64 of `4` (the config-schema generation marker).

### `[dayz]`
| Key | Value | Meaning |
|-----|-------|---------|
| `dzsa_launcher_update` | `60` | Publish server status + mod list to the **DZSA Launcher** every 60 s. |
| `dzsa_launcher_update_enable` | `true` | DZSA publishing is ON (this is how players discover/one-click-join the modded server). |
| `priority_update_interval` | `300` | Poll the CFTools **Priorities** provider every 300 s (reserved-slot/queue sync). |

### `[filesystem]`
Pins every working directory (agent/backups/cache/certs/db/deployments/logs/plugins) to absolute paths, plus:
- `database_backup_interval = 3` → DB is copied to `*.db.backup` every **3 hours** (confirmed in logs at 01:13, 04:13, 07:13 … exactly 3 h apart).
- `max_manager_download_size = 30` → cap (MB) on files the Manager may pull via `/download`.
- `python_path = ""` → optional Python for the script engine (unset).

### `[http_server]`
| Key | Value | Meaning |
|-----|-------|---------|
| `address` | `0.0.0.0` | Listen on all interfaces. |
| `port` | `8090` | The single control port. |
| `ssl_cert_file` / `ssl_cert_key_file` | `certs\cert.pem` / `cert.key.pem` | TLS material. |
| `use_ssl` | `true` | HTTPS/WSS enforced. |

> Note: the boot log prints **`HTTP server goroutine started.`** twice and **`registering routes...`** twice — the Agent runs two listener goroutines (the HTTPS/WSS control listener and a second internal/util listener).

### `[immutable_deployments]`
`enabled = false`, `mode = ""` — an optional lockdown mode that would make deployment files read-only/agent-managed. Off here.

### `[logging]`
- `audit_logs_retention = 7` — audit rows kept 7 days (note: the *metrics* tables are NOT covered by this — they grow unbounded; see security doc).
- `verbose = true` — DEBUG-level logging (why the logs are chatty with `DEBUG OK` lines).

### `[rcon]`
| Key | Value | Meaning |
|-----|-------|---------|
| `connection_timeout` | `180` | BattlEye RCON socket timeout (s). |
| `disable_rcon` | `false` | RCON integration ON. |
| `rcon_ip_address` | `"unset"` | RCON bind override (defaults to loopback when unset). |

### `[steam_servers]` — the Workshop/SteamCMD downloader tuning
| Key | Value | Meaning |
|-----|-------|---------|
| `chunk_download_timeout` | `5` | Per-chunk timeout (s). |
| `disable_buffered_download` | `true` | Stream chunks straight to disk. |
| `download_batch_size` | `60` | Concurrent chunk batch size. |
| `max_downloads_per_cdn` | `0` | 0 = unlimited per CDN. |
| `reinclusion_period` | `1` | How quickly an excluded/slow CDN is retried. |
| `repopulation_cycle` | `24` | Refresh the CDN server list every 24 (hours). |
| `use_http2` | `false` | Force HTTP/1.1 for content fetch. |

### `[steam_servers_list]`
`enabled = false`, `http2 = false` — optional static CDN list override. Off; the Agent discovers content servers dynamically.

### `[windows]`
- `powershell_execution_policy = ""`, `session_username = ""`, `start_server_non_interactive = false` — Windows session/launch behavior. Non-interactive launch is OFF, so the DayZ server is started in a way that can attach a console.

---

## 3. Boot sequence (bit by bit, from the logs)

Observed startup, in order, from `logs/ArchitectAgent-2026-05-19T22_13_30.log`:

1. **Power throttling opt-out attempt** — `AGENT: Could not opt agent out of power throttling! Err: SetProcessInformation(...)` (best-effort; it tries to keep the daemon at full CPU priority).
2. **Self-update swap** — `AGENT: Replacing agent binary...` then service start. The Agent updates itself in place (`updates\` staging → swap), then:
3. `AGENT: Starting ArchitectAgent service.`
4. `AGENT: Updated service registry version to 1.1.34.` and `Updated Uninstall DisplayVersion to 1.1.34.0.` — it writes its own version into the Windows registry / uninstall entry.
5. **Cloud uplink** — `WEBSOCKET HANDLER: Attempting to connect to the Cloud Controller...`
6. **Event manager warm-up** — `EVENT MANAGER: No Webhooks found for current event.`
7. `AGENT: Agent started (version 1.1.34).`
8. **Title Observers spawned** — one per supported title: `dayz_pc`, `dayz_experimental_pc`, `arma_reforger_pc`, `arma_exp_reforger_pc`, `rust_pc`, `rust_staging_pc`, `squad`, `squad_experimental`, `scum`, `valheim`, `sdtd`, `palworld`, `pzomboid`, `pzomboid_unstable`, `enshrouded`. *(This is the proof the engine is multi-game.)*
9. **HTTP listeners** — two `HTTP server goroutine started.` lines.
10. **Mod Observers spawned** — one per installed Workshop mod id (`1559212036`, `2545327648`, `2116157322`, `1832448183`, `3700436870`, `3210162677`, `3682890365`, `2464526692`, `3514469093`, `2572331007`, `1564026768`, `3700815342`, …). Each observer watches that mod for Workshop version changes.
11. **Routes registered** — `WEBSOCKET HANDLER: HTTP server: registering routes...` → `routes registered.` (twice, one per listener).
12. **Queue grace** — `AxiomMain: Queue grace updated. Enabled: true.` (login-queue grace window for the server).
13. **Server Observer spawned** — `SERVER MANAGER: Started Server Observer for the server 'AxiomMain' with state 'server.running'.`
14. **Tickers created**:
    - `Automated backup deletion ticker ... Backup deletion interval: 3 days.`
    - `Priority ticker created for server AxiomMain!` (drives the 300 s priority poll).
15. **DB maintenance ticker** — every 3 h: `DATABASE: backing up Architect Agent database...`

---

## 4. Internal subsystems (the "e" event sources)

The Agent logs every line with an `"e"` field naming the subsystem. Observed taxonomy and responsibilities:

| Subsystem | Responsibility |
|-----------|----------------|
| **AGENT** | Process bootstrap, self-update, service/registry, power/priority, global tickers. |
| **WEBSOCKET HANDLER** | The :8090 server. Terminates TLS, authenticates (Basic + fail2ban), parses `SMP1.0` envelopes, routes actions, handles `proxy` requests to the cloud, manages pub/sub subscriptions, and streams push messages. By volume the busiest subsystem (~17k lines/log). |
| **SERVER MANAGER** | Owns the set of managed servers; creates a **SERVER OBSERVER** per server; adjusts per-server metrics tables. |
| **SERVER OBSERVER** | The per-server supervisor/state-machine. Deploy/start/stop/force-kill, PID tracking, liveness probes, per-server lock during transitions (`blocked for action server.stopping` / `unblocked`), graceful shutdown with player kick/lock countdown, DB record cleanup on stop. |
| **TITLE MANAGER** | Owns the catalog of supported game titles; creates a **TITLE OBSERVER** per title and a **MOD OBSERVER** per installed mod. |
| **TITLE OBSERVER / MOD OBSERVER** | Watch a title's game build / a mod's Workshop version for updates; trigger downloads and dependent-server rebuilds/restarts. |
| **EVENT MANAGER** | The internal event bus → outbound webhook delivery (matches events to configured webhooks; logs deliveries). |
| **DATABASE** | SQLite access layer + the 3-hourly self-backup. Surfaces query errors (e.g. `no such column: state` from a schema-migration mismatch). |

---

## 5. Cross-cutting facilities

- **Auth + fail2ban:** username/password (bcrypt) checked on every WS connect; brute-force throttled per `[authorization]`. `disable_remote_root=false` permits remote root.
- **RBAC:** roles are permission maps; `root = {"*":true}`, `default` = a read allow-list. Permissions are dotted keys (`server.start`, `file.read`, `user.create`, `rcon.message`, …) enforced server-side on every action.
- **Audit trail:** every authenticated action writes an `audit` row `{date,user,session,ip_address,action,parameters}`. 8,400+ rows present.
- **Metrics collectors:** a host collector (10 s) and a per-server collector (5 s) that samples both OS counters and the DayZ **GameLabs** metrics dump.
- **Self-healing supervision:** the SERVER OBSERVER restarts crashed servers and reconciles state; on update of any bound mod or the game build, it schedules a coordinated restart.

Continue with `03_SMP_Protocol_and_RPC_API.md`.
