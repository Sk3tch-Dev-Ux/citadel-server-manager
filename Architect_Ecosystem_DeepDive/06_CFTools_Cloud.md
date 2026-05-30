# 06 — CFTools Cloud (the SaaS backbone)

Tier 1 is what elevates Architect from "a local server panel" to "a hosting platform." Both the Manager and the Agent reach up to CFTools-operated cloud services. None of these run on the host; they are external endpoints.

---

## 1. Endpoints observed

| Host | Used by | Purpose |
|------|---------|---------|
| `app.cftools.cloud` | Manager (main) | OAuth2 authorize / login UI. |
| `api.cftools.cloud` | Manager (main) | OAuth2 token + `/v1/oauth2/userinfo`, entitlements. |
| `cdn.gameserver.cloud` | Manager (main) | Workshop mod catalog JSON; Manager auto-update feed. |
| `gw-architect.cftools.ru` | Manager (region) | Russia-region content gateway (locale/failover). |
| `sentry.cftools.cloud` | Manager | Crash/error telemetry (DSN `/9`). |
| (priority API) | **Agent** | Reserved-slot / queue-skip provider, polled every 300 s. |
| Cloud Controller (WS) | **Agent** | Persistent uplink for `proxy` RPCs + entitlement/`universe_status`. |
| `ip-api.com` | Manager | Player IP → geolocation for the globe view (third-party). |

---

## 2. Identity — OAuth2 PKCE (Manager → Cloud)

1. User clicks login; Manager main process starts a local loopback listener and opens the system browser to `https://app.cftools.cloud/...` with PKCE challenge (S256), `clientId 69a319eee4bf563b183c8e29`, scope `identify`, redirect `http://127.0.0.1/callback`.
2. After consent the browser hits the loopback `/callback` with an auth code; Manager exchanges it at `https://api.cftools.cloud/v1/oauth2/token` for access + refresh tokens.
3. Tokens are stored (main-process token store) and refreshed automatically; `Bearer` calls hit `/v1/oauth2/userinfo`.

This authenticates the **human operator to CFTools**, separate from the **operator-to-Agent** Basic auth. The two identities are independent: cloud login gates catalog/entitlement features; Agent login gates server control.

---

## 3. Workshop mod catalog (curated)

- Manager main fetches `GET https://{contentSource}/workshop/{dayz|arma_platform}.json` from `cdn.gameserver.cloud` (region-switchable to the `.ru` gateway), caches it, and refreshes hourly.
- This is a **CFTools-curated** catalog, not a live Steam scrape — so the in-app mod browser shows vetted metadata (names, ids, dependencies, art). When the operator installs a mod, the Manager passes the Workshop `entity_id` to the Agent's `install_mod`, and the **Agent** does the actual SteamCMD download (Tier 3 owns the bytes).

---

## 4. The `proxy` bridge & `universe_status` heartbeat

The Agent holds a persistent **Cloud Controller** WebSocket (opened at boot: `Attempting to connect to the Cloud Controller...`). The Manager sends certain actions wrapped in `proxy`; the Agent forwards them upstream and relays the answer back:
- `installation_details` — license/install metadata (called once on connect for Agent ≥ 1.1.26).
- `titles` — authoritative supported-title list.
- `universe_status` — recurring (~every 10 s in the live log) entitlement/content-availability heartbeat. This keeps the Agent's view of "what am I licensed/allowed to run" fresh and lets the cloud signal status to all connected Managers.

Architecturally: **the Agent is the cloud broker**; the Manager does not need its own line to these services.

---

## 5. Priorities provider (reserved-slot queue)

This is a headline "powerful hosting" feature. The server config carries `priorityApiKey` (44-char CFTools key) + `priorityServer` (GUID). The Agent's **Priority ticker** (created at boot) polls the CFTools priority API every `priority_update_interval = 300` seconds to sync the list of players who get **reserved slots / queue-skip** on this server.

- On success the Agent applies the priority list to the login queue (works with `loginQueueConcurrentPlayers`/`loginQueueMaxPlayers` in `serverDZ.cfg` and the boot-time "Queue grace updated. Enabled: true.").
- **On this host it is currently FAILING** — the live log shows, every 5 minutes:
  ```
  ERROR server-error  AxiomMain: Priorities provider returned an error. Raw={"results":null,"status":false}
  ```
  `status:false` means the cloud rejected the request — typically an invalid/expired `priorityApiKey` or a `priorityServer` GUID not bound to the operator's CFTools account. Remediation in `09_Security_and_Operational_Notes.md`.

---

## 6. DZSA Launcher publishing (player discovery)

With `dzsa_launcher_update_enable = true`, the Agent publishes the server's status + full mod list to the **DZSA Launcher** every `dzsa_launcher_update = 60` seconds. DZSA is the de-facto third-party launcher for modded DayZ; this is how players **find the server and one-click-install the exact mod set** before joining. Without this, a modded server is hard to discover and join.

---

## 7. Auto-update & telemetry

- **Manager auto-update:** `electron-updater` reads `app-update.yml` → `https://cdn.gameserver.cloud/manager/latest/{win32|linux}`.
- **Agent self-update:** observed at boot (`AGENT: Replacing agent binary...`), staged via the local `updates\` dir and swapped on restart; version then written to the Windows registry.
- **Crash telemetry:** Sentry (`sentry.cftools.cloud`).

---

## 8. Identity map (who authenticates to what)

```
Operator (human) ──OAuth2 PKCE──► CFTools Cloud        (catalog, entitlement, account)
Operator (human) ──Basic auth───► Agent :8090          (server control via SMP1.0)
Agent ───────────license JWT────► CFTools Cloud        (right to run)
Agent ───────────priorityApiKey─► CFTools priority API (reserved slots)
Agent ───────────gamelabs apiKey► GameLabs/CFTools     (in-game metrics + tools)
Server ──────────DZSA publish───► DZSA Launcher        (player discovery)
```

Continue with `07_Deployment_AxiomMain.md`.
