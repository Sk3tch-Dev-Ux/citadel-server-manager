# 04 — The Agent Database (SQLite)

The Agent persists all of its state and telemetry in a single SQLite file:

```
db\ArchitectAgent.db        ~70 MB (live)
db\ArchitectAgent.db.backup ~70 MB (copied every 3 hours by the DATABASE subsystem)
```

It was read **read-only** (copied to temp, opened `OPEN_READONLY`) — the live DB was never written or locked.

---

## 1. Design pattern: document-oriented over SQLite

Most tables follow the same shape:

```sql
CREATE TABLE <name> (
  id          TEXT PRIMARY KEY,
  user_space  TEXT,          -- multi-tenant scope (empty/default here)
  details     TEXT           -- a JSON blob holding the real structure
  -- ...occasional typed columns, often legacy/NULL
);
```

Implications:
- **The real schema lives inside the JSON `details` blobs**, not in columns. This makes the Agent's model evolvable without migrations — but it also produced the observed `no such column: state` error when a query assumed a promoted column that only exists in JSON.
- **`user_space` is everywhere** → multi-tenancy is wired throughout, though only the default space is used.
- **Per-server tables are created dynamically** with a `<ServerId>_` prefix: `AxiomMain_metrics`, `AxiomMain_rcon`, `AxiomMain_backup`. Adding a server creates its own metrics/rcon/backup tables.

Engine fingerprint: timestamps render as Go's `... +0000 UTC`; metrics include `goroutines` — confirming the Agent is a **Go** program. SQLite library version 3.41.1.

---

## 2. Table inventory (with row counts observed)

| Table | Rows | Purpose |
|-------|-----:|---------|
| **AxiomMain_metrics** | **120,975** | Per-server telemetry, 5 s cadence. CPU/mem, disk & net IO, A2S player count, and GameLabs in-game stats (serverFps, aiCount, entityCount, tickTime). |
| **agent_metrics** | **61,444** | Host/agent telemetry, 10 s cadence. Agent cpu/mem/goroutines + system cpu/mem/disk/net. (`cpu_usage`/`memory_usage` columns are legacy NULL; data is in `details`.) |
| audit | 8,431 | Operator action audit trail `{date,user,session,ip_address,action,parameters}`. Has `sqlite_autoindex`. |
| server_events | 1,191 | Server lifecycle events (`server.changed_state` before/after, etc.). |
| webhook_deliveries | 330 | Outbound webhook delivery log (payload + HTTP response/status). |
| AxiomMain_rcon | 244 | BattlEye RCON in/out log (restart broadcasts, `say`, etc.). |
| agent_events | 78 | Operator-facing event log: logins, force-kill, stop requests. Indexed by `(date, level)`. |
| titles | 15 | Supported game titles (Steam app metadata: dayz_pc, enshrouded, pzomboid, palworld, sdtd, …). |
| mods | 12 | Steam Workshop mods (id, name, version, downloaded flags). |
| mod_server_bindings | 12 | Mod ↔ server M:N mapping (FKs to mods/servers). |
| AxiomMain_backup | 10 | Per-server backup records. |
| webhooks | 4 | Webhook definitions (Discord URLs, event filters, templated payloads). |
| downloads | 4 | Download operation log (Steam mod downloads: started/completed). |
| roles | 2 | RBAC roles: `root = {"*":true}`, `default = {limited reads}`. |
| servers | 1 | The managed server `AxiomMain` (full config snapshot — see §4). |
| users | 1 | Single user `root` (bcrypt `password_hash`, 60 chars). |
| user_role_bindings | 1 | Binds root user → root role. |
| system_configuration | 5 | Key/value singletons: `AgentLocation`, `LastShutdown`, install id, etc. |
| scripts / script_executions | 0 | Cron-style script engine (schedule/executor/stdout/stderr) — defined, unused. |
| sql_databases | 0 | Managed game-server SQL DBs — unused. |
| app_instances / instance_events | 0 | Generic application-instance model — unused. |
| user_spaces | 0 | Multi-tenant spaces (`system_username`/`system_password`) — unused. |

Only one non-autoindex index exists: `idx_agent_events_date_level`. The big telemetry tables are intentionally **un-indexed append logs** (write-cheap; read via time-range scans for charts).

---

## 3. What fills the 70 MB

Roughly 95% of the file is time-series telemetry — there is **no player history or RPT-log storage in the DB** (those live in the deployment's `profiles/`):

| Table | Share |
|-------|------:|
| `AxiomMain_metrics` | **70.3 %** (~47 MB) |
| `agent_metrics` | **25.3 %** (~17 MB) |
| `audit` (+ autoindex) | ~3 % (~2 MB) |
| everything else | < 0.3 % each |

These two tables are **append-only with no visible retention/pruning** (the `audit_logs_retention=7` setting does not cover them), so the file grows roughly linearly with uptime. See `09_Security_and_Operational_Notes.md`.

---

## 4. The `servers` row (AxiomMain) — what a "server" is

The single `servers.details` JSON is the authoritative config snapshot the SERVER OBSERVER acts on. It contains (structurally):
- **Identity:** id `AxiomMain`, title `dayz_pc`, current `state` (`server.stopped` / `server.running` / `server.stopping`).
- **Process:** launch parameters, working dir, executable, **`rcon_password`** (8 chars), CPU **priority/affinity**, liveness-probe config, graceful-shutdown timings.
- **Ports:** game `2302`, query `2303`, rcon `2305`.
- **Environment:** **`priorityApiKey`** (44-char CFTools key) + **`priorityServer`** GUID — the reserved-slot integration.
- **Integrity snapshot:** a large blob of SHA-1 hashes of every PBO/addon, used to detect drift / verify deployment integrity.
- **Queue grace:** login-queue grace settings (`Queue grace updated. Enabled: true.` at boot).

---

## 5. Secrets present (masked in analysis; listed for rotation)

| Location | Secret |
|----------|--------|
| `users.details.password_hash` | bcrypt hash (60 chars). |
| `servers.details.process.rcon_password` | BattlEye RCON password (8 chars). |
| `servers.details.environment.priorityApiKey` | 44-char CFTools API key (+ `priorityServer` GUID). |
| `system_configuration` | an install/secret id and a token-like value. |
| `webhooks.details.url` | **full Discord webhook URLs in cleartext** (grant channel post access). |
| `audit` / `agent_events` | operator **IP addresses** in cleartext (e.g. `91.229.114.40`). |

---

## 6. What the schema tells us about the Agent's job

- **Server lifecycle** with a real state machine and per-server lock (`servers`, `server_events`).
- **Mod/title management** with version tracking, M:N server binding, integrity snapshots, and auto-restart on update (`mods`, `mod_server_bindings`, `titles`, `downloads`).
- **Backups** per server (`AxiomMain_backup`, 3-day retention ticker).
- **RCON** logging (`AxiomMain_rcon`).
- **Continuous metrics** — the dominant data volume, both host and in-game.
- **Auth/RBAC** with bcrypt + permission-map roles + session login.
- **Compliance-grade audit** (`audit`, 8.4k rows).
- **Eventing + webhooks** (`agent_events`, `server_events`, `webhooks`, `webhook_deliveries`).
- **A broader dormant platform**: cron scripts, managed SQL DBs, generic app instances, and multi-tenant user-spaces — all present in schema, unused on this single-operator DayZ box.

Continue with `05_Architect_Manager.md`.
