# Architect by CFTools — Ecosystem Deep Dive

**Subject:** The Architect game-server hosting platform by **CFTools Software GmbH**, as deployed on this host running the **"Axiom Main"** DayZ server.

**Method:** Direct inspection of the live installation — the Go Agent daemon, its TOML config, its 70 MB SQLite database, the Electron Manager app (`app.asar` unpacked), the runtime logs, and the on-disk DayZ deployment with its 17-mod Workshop stack. Findings are grounded in observed files, log lines, schema, and code strings; where a value is masked it is for secret hygiene only.

**Versions observed:**
- Architect **Agent**: `1.1.34` (service registry / Uninstall DisplayVersion `1.1.34.0`)
- Architect **Manager**: `1.1.205` (Electron 29 / Node 20.9, Vue 3)
- DayZ dedicated server build: `DayZServer_x64.exe` (PC, Chernarus mission)

---

## How to read this document set

| File | What it covers |
|------|----------------|
| `00_README_Index.md` | This index, scope, glossary pointer |
| `01_Ecosystem_Architecture.md` | The four-tier model, master diagram, component inventory, data-flow overview |
| `02_Architect_Agent.md` | The Go daemon: boot sequence, `config.toml` line-by-line, every internal subsystem, tickers, fail2ban, licensing, filesystem layout |
| `03_SMP_Protocol_and_RPC_API.md` | The `SMP1.0` WebSocket JSON-RPC protocol bit-by-bit, handshake, envelope, idempotence, proxy, pub/sub, binary transfer, full action catalog, permission model |
| `04_Database_Schema.md` | Full SQLite schema, the document-oriented model, per-table breakdown, dynamic per-server tables, metrics cadence, DB growth, secret locations |
| `05_Architect_Manager.md` | The Electron + Vue desktop control plane: process model, IPC bridge, screens, Monaco editor, the cloud-vs-agent split, connection store, security posture |
| `06_CFTools_Cloud.md` | The SaaS backbone: OAuth2 PKCE identity, Workshop catalog CDN, the `proxy`/`universe_status` heartbeat, the Priorities provider, DZSA Launcher publishing, Sentry, region routing |
| `07_Deployment_AxiomMain.md` | The actual DayZ server: mod stack + load order, every config file, engine auto-tuning, profiles, maps, BattlEye, Steam |
| `08_Lifecycle_Flows.md` | End-to-end sequences bit-by-bit: cold boot, login/auth, mod-update→restart, scheduled restart with RCON countdown, backup, the metrics pipeline, webhook delivery, priority sync |
| `09_Security_and_Operational_Notes.md` | Security findings, plaintext-secret locations, TLS posture, operational risks (unbounded metrics, failing priority provider), and remediation |

---

## The one-paragraph summary

Architect is **not one program** — it is a four-tier distributed system. A **Go daemon (the Agent)** runs on the game host as a Windows service and owns everything about hosting: it supervises the `DayZServer_x64.exe` process, downloads and version-syncs Steam Workshop mods, speaks BattlEye RCON, collects 5-second telemetry into SQLite, enforces a bcrypt/RBAC auth model with a full audit trail, and exposes a single control surface — an **HTTPS + WebSocket server on port 8090** speaking a custom JSON-RPC protocol called **`SMP1.0`**. An **Electron + Vue desktop app (the Manager)** is the operator cockpit; it holds no game logic and is purely a remote control that opens an `SMP1.0` session to one or more Agents. Above both sits **CFTools Cloud**, a SaaS backbone providing OAuth2 identity, a curated Workshop mod catalog over a CDN, a priority/reserved-slot queue API, DZSA Launcher publishing, and license/entitlement heartbeats. The thing all of this exists to run is **Tier 4** — the on-disk DayZ deployment "Axiom Main," a "Vanilla+" Chernarus server with a 17-mod stack (DayZ-Expansion suite, CodeLock, KeyRooms, base storage, and a custom "Axiom Core" mod).

See `01_Ecosystem_Architecture.md` for the master diagram and component inventory.
