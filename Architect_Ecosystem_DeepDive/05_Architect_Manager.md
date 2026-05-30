# 05 — The Architect Manager (desktop control plane)

The Manager is the operator's GUI. It is an **Electron 29 / Node 20.9** desktop app whose UI is a **Vue 3 + Pinia + vue-router** SPA bundled with Vite. It contains **no game-hosting logic** — every capability is an `SMP1.0` action implemented by the Agent. You could throw the Manager away and drive the Agent with a WebSocket client; the Manager just makes it pleasant.

```
C:\Users\Administrator\AppData\Local\Programs\architect-manager\
├─ architect_manager.exe        176 MB (Electron shell)
├─ resources\app.asar           the app: dist-electron\ (main) + dist\ (renderer)
├─ resources\elevate.exe        UAC elevation helper
├─ resources\app-update.yml      → https://cdn.gameserver.cloud/manager/latest
├─ *.dll, *.pak, icudtl.dat ...  Chromium/Electron runtime
└─ locales\
```

`package.json`: name `architect-manager`, **v1.1.205**, author "CFTools Software GmbH", `"type":"module"`, main `dist-electron/main/index.js`.

---

## 1. Process model (two worlds)

Electron splits into a **main process** (Node, privileged) and a **renderer** (Chromium, the Vue app). The split here is deliberate and security-relevant:

| Concern | Lives in | Notes |
|---------|----------|-------|
| **CFTools Cloud identity (OAuth2)** | **Main** | Token store, refresh, Bearer calls. Renderer never holds raw cloud creds. |
| **Workshop mod catalog fetch** | **Main** | Pulls `cdn.gameserver.cloud/workshop/dayz.json`, caches, hourly refresh. |
| **Auto-update** | **Main** | `electron-updater` against `app-update.yml`. |
| **Generic HTTP passthrough** | **Main** | A single `make-http-request` IPC the renderer calls via preload `web.fetch`. |
| **Agent `SMP1.0` connection** | **Renderer** | The WebSocket client, RPC map, all server/mod/file actions live in the renderer bundle (`dist/assets/index-*.js`). |
| **DayZ player .db parsing** | **Main** | Bundles `node-sqlite3`; decodes an uploaded base64 `Players` SQLite DB and its blob columns. |
| **External file editing** | **Main** | Writes a file to a temp dir, watches it, opens it in the OS editor, streams changes back to the Agent. |

The **preload bridge** exposes `electronAPI` / `web.fetch` / `exfunctions` to the renderer via `contextBridge`.

---

## 2. Bundled capabilities (libraries → features)

| Library | Feature it powers |
|---------|-------------------|
| **Monaco editor** (json/html/css/ts + many modes) | In-app config-file editor for the deployment (types.xml, cfggameplay.json, Expansion JSONs, serverDZ.cfg, …). |
| **Chart.js + chartjs-plugin-zoom** | The live metrics dashboards (CPU/RAM/FPS/players/AI, zoom & pan). |
| **globe.gl** | A 3D globe view of connected players (uses `ip-api.com` geolocation). |
| **rrweb** | Session replay (UX telemetry). |
| **@sentry/electron** | Crash/error reporting to `sentry.cftools.cloud`. |
| **node-sqlite3** | Parsing DayZ player databases client-side. |
| **electron-updater** | Self-update from the CFTools CDN. |

---

## 3. Renderer screens / feature set

From the chunk names and routes:
- **ControlCenter** — multi-server overview & quick actions.
- **Dashboard / ServerDashboard** — live charts, status, console (`stdout` stream), player list.
- **ServerDeploy** — create/configure a server (ports game/query/rcon, launch params, title selection).
- **Mods** — browse the CFTools catalog, install/remove, bind to servers, watch downloads.
- **Applications** — manage non-game "application instances."
- **WebHooks** — define Discord webhooks + event filters + templated payloads; view deliveries.
- **RBAC** — users, roles, permissions, sessions, audit viewer.
- **ApplicationSettings** — app/connection preferences.
- **File editor** — Monaco + the external-edit round-trip.
- Multi-game/multi-region assets bundled (DayZ, Arma Reforger/Platform, plus art for Rust, Palworld, SCUM, Valheim, 7DTD, Squad, Project Zomboid, ARK).

---

## 4. How it connects to an Agent (the renderer client)

In `dist/assets/index-Du3ycgJ5.js`:
- Connection manager opens `new WebSocket(url, ["SMP1.0", username, password])` (~line 50).
- `_o(connId, msg, timeoutMs)` is the RPC helper: `JSON.stringify({action, parameters, idempotence})`, random idempotence, pending-promise map, 10 s default timeout, per-connection latency tracking.
- Binary transfer: `POST .../upload` (~line 5739) and `POST .../download` with `{token}` (~line 5742).
- Setup probe treats an HTTP **400** to `/ws` as "credentials accepted" (~line 4895).
- On open: `whoami` → `request_system_info` → (≥1.1.26) `proxy installation_details` → `request_agent_health` → conditional `enable_stdout`.

**Connection store:** `connectionsStore-B8qb_BRK.js` persists each Agent connection — name, host, port, username, **password in plaintext** — to `connections.json` under Electron `userData`. (Security note in `09_*`.)

---

## 5. Cloud auth (main process)

`oauth-CkxTqVpu.js` / `startAuth-Dcq9U2co.js` / `authClient-Cq24ANRq.js`:
- **OAuth2 Authorization Code + PKCE (S256)**, loopback redirect `http://127.0.0.1/callback`.
- Packaged build: authorize at `https://app.cftools.cloud`, API at `https://api.cftools.cloud`. Dev build: `api.cftools.app` / `local.cftools.app:42069`. `clientId 69a319eee4bf563b183c8e29`, scope `identify`.
- Token refresh + `Bearer` calls to `/v1/oauth2/token` and `/v1/oauth2/userinfo`.

See `06_CFTools_Cloud.md` for the full cloud surface.

---

## 6. Security posture (as built)

Observed in `dist-electron/main/index.js`:
- `webSecurity:false`, `allowRunningInsecureContent:true`.
- A `certificate-error` handler that **force-accepts all certs**, and a `setCertificateVerifyProc` that **trusts any cert whose issuer org == "CFTools Architect"** — which is exactly the Agent's self-signed cert. This is how the Manager talks to the Agent's self-signed `:8090` without warnings, but it also disables TLS validation broadly.
- CSP allows `*.gameserver.cloud`, `cftools.cloud`, `api.cftools.app`.
- Sentry DSN hardcoded (`...@sentry.cftools.cloud/9`).

These are pragmatic for a self-signed-cert control app but worth understanding; details and remediation in `09_Security_and_Operational_Notes.md`.

Continue with `06_CFTools_Cloud.md`.
