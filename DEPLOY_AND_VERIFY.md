# Deploy & Verify — 2026-06-02 session

> Everything built this session, in **deploy order**, with a **per-feature verification** checklist.
> Spans three codebases: `citadel-cloud` (API + web), `DayzServerController` (Citadel Agent backend +
> `@CitadelAdmin` mod), and server ops (NAT, DB migrations).
>
> Verification state at hand-off: **cloud all `tsc --noEmit` clean · agent 331 jest tests pass · eslint
> clean.** Mod `.c` cannot compile outside the DayZ toolchain — it's the only thing not machine-verified.

## What's in this drop

| Area | Changes | Repo |
|---|---|---|
| **Cloud API** | leaderboard + player-profile + analytics endpoints; replay `?steamId` filter; **hits ingestion** (`plugin_hits`); **distance** cols; **G2 HTTP ingest** (`/plugin/ingest`, `/commands/:id/result`) + raw-telemetry translator | citadel-cloud |
| **Cloud DB** | migrations **0024** (player-stats distance cols) + **0025** (`plugin_hits` table + hypertable) | citadel-cloud |
| **Cloud web** | `/cloud/dashboard` (analytics), leaderboard page, player-profile page, per-player map-travel, damage timeline | citadel-cloud |
| **Agent** | forwarder: `playerStats` + `player_hit` + distance fields; **G1 durable replay** (persisted events cursor) | DayzServerController/backend |
| **Mod** | **FPS fix (doSim gate)**; periodic `playerStats`; distance emit; denser positions (5s→3s); **G2 `CitadelCloudClient`** + EventLogger direct buffer | @CitadelAdmin |
| **Ops** | apply migrations; **NAT/port-forward** for the server to be joinable | server box / router |

---

## Deploy order (dependencies matter — do top to bottom)

### 1. Cloud (first — the API must accept the new telemetry before the mod/agent send it)
```bash
cd citadel-cloud
npm run build                 # builds @citadel/shared FIRST, then api/web (api imports the built shared types)
npm run db:migrate            # applies pending migrations 0024 + 0025 (additive; safe)
```
- Verify migrations landed:
  ```sql
  \d plugin_hits                                  -- table exists, hypertable
  \d plugin_player_stats                          -- has distance_traveled, vehicle_distance
  SELECT * FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;  -- 0025, 0024 present
  ```
- Deploy the built **API** and **web** via your normal process (container/host). Confirm `GET /api/v1/analytics/overview` and `GET /api/v1/servers/:id/telemetry/leaderboard` respond (401 without a session is fine — proves the route is mounted).

### 2. Agent (Citadel Agent — ships the new forwarder + G1 replay)
- Rebuild/redeploy the installed agent at `C:\Citadel`:
  ```powershell
  # from the repo: produce a fresh build/installer, OR update the installed backend in place
  npm run build:installer        # if distributing the installer
  # then reinstall, OR replace C:\Citadel\<backend files> and restart the service:
  npm run service:stop ; npm run service:start   # (or via the Citadel service controls)
  ```
- Verify: agent logs show the cloud-bridge connecting; `data/plugin-servers.json` gains a `cloudAckedOffset` field per linked server after telemetry flows (G1).

### 3. Mod — rebuild the `@CitadelAdmin` PBO (the big one)
The source has FPS fix + all the new emits + the G2 client. The **deployed PBO must be rebuilt** — nothing mod-side is live until this happens.
```
1. Build the PBO from dayz-mod/@CitadelAdmin/scripts with your toolchain
   (Mikero pboProject or DayZ Tools Addon Builder).  New files in
   scripts/{3_Game,4_World,5_Mission} are auto-included — confirm
   5_Mission/CitadelCloudClient.c compiled in.
2. Re-sign:  CitadelAdmin.pbo  →  CitadelAdmin.pbo.<key>.bisign  (your .biprivatekey)
3. Copy CitadelAdmin.pbo + the .bisign into:
   C:\Citadel\deployments\Testing\@CitadelAdmin\addons\
4. Restart the DayZ server.
```
> Sanity after rebuild (optional): grep the new PBO for `doSim` and `CitadelCloudClient` to confirm the
> current source got packed (we used this exact check earlier).

### 4. Server ops — make it joinable
The box is behind NAT (`192.168.0.21`); the server binds + is firewalled locally but isn't internet-reachable.
- **LAN smoke test first:** DayZ client → direct-connect `192.168.0.21:2302`. Should connect (proves the server is healthy).
- **Internet:** port-forward **UDP 2302–2304** on the router → `192.168.0.21`; players connect to your public IP.
- **DZSA listing (modded):** set `dzsaPublish: true` for "Testing" in `C:\Citadel\data\servers.json`, restart; forward **UDP 2312** (gamePort+10).

---

## Per-feature verification (after all of the above)

Join the server (or have a tester join) so telemetry actually flows, then:

| # | Feature | How to confirm it's live |
|---|---------|--------------------------|
| 1 | **FPS fix** | `…/profiles/Citadel/metrics.json` → `fps` is ~3000–6000 (×100 of 30–60), **not** ~4,000,000. Cloud console FPS card shows ~30–60. *(If still huge: doSim runs every frame on this build — fall back to a wall-clock frame counter; see CitadelFPSTracker comment.)* |
| 2 | Metrics / counts | Console header populates (players/AI/entities/vehicles). |
| 3 | **playerStats** | Mod emits `{"type":"playerStats"}` to events.jsonl every ~30s → `plugin_player_stats` rows appear → `GET /telemetry/players/:steamId/summary` shows non-zero **accuracy**. |
| 4 | Kill feed / chat | Live console feeds populate as players fight/talk. |
| 5 | **Leaderboard** | `/cloud/console/:id/leaderboard` lists players; **points = kills×2**; sort tabs work. |
| 6 | **Player profile** | `…/players/:steamId` shows kills/deaths/K-D/accuracy + **name history** + **trust band** + **Dmg dealt/taken** + **Distance**. |
| 7 | **Map-travel** | Profile → "Map travel" → scrubber draws the player's **path trail**; timeline shows their kills + **damage events**. |
| 8 | **Hits/damage** | `plugin_hits` rows appear after combat; profile dmg cards non-zero. |
| 9 | **Analytics dashboard** | `/cloud/dashboard` → cards (servers/players/chat/kills/avg-session/**bans**) + activity/kills **TrendCharts** + engagement panel, across 24h/7d/30d. |
| 10 | **G1 durable replay** | Kill the cloud WS (or `taskkill` the backend) ~10 min under live kill/chat traffic → on reconnect the console feeds **backfill the gap** (no operator action). |
| 11 | **G2 direct mode** (optional) | See below. |

### G2 direct-mode test (rented-host path — optional, no agent)
On a host **without** the Citadel Agent (or to simulate it), drop a `cloud.json` next to the other Citadel files and restart:
```jsonc
// $profile:Citadel/cloud.json
{
  "endpoint": "https://<your-cloud-host>/api/v1/plugin",
  "apiKey": "<plugin api key from the dashboard: POST /api/v1/plugin-servers>",
  "postIntervalMs": 3000
}
```
Verify: cloud receives telemetry on `/plugin/ingest` (server appears live, feeds populate **without** an agent WS). Issue an admin command from the dashboard → it executes in-game (delivered in the ingest response, run by `CitadelCommandRunner`, result POSTed back). Note the **D4 guard**: a server can't be on both the agent WS and HTTP ingest at once — the cloud returns 409 if a live agent owns it.

---

## Rollback & safety
- **Migrations are additive** (new table + nullable-defaulted columns) — no data loss; safe to apply. To roll back code, redeploy the previous build; the new columns/table simply go unused.
- **Self-hosters are unaffected by G2** — `CitadelCloudClient` is a no-op unless `cloud.json` exists.
- **FPS / mod changes** are server-side only.

## Known residuals (not blockers, tracked in the gap docs)
- Mod `.c` (FPS fix, playerStats/distance emits, `CitadelCloudClient`) is **not machine-verified** — the DayZ toolchain validates it at PBO build. Watch the server's script log for compile errors on first boot.
- **G1/G2 in-process state** (durable cursor, HTTP command queue, WS registry) is single-node — needs sticky-by-serverId or Redis fan-out if the cloud API is sharded.
- **G2 Phase 3** (dashboard "issue key → cloud.json" onboarding flow + Nitrado/GPORTAL docs + mod offline buffering on POST failure) is not built yet.
- Optional polish: widen `plugin_server_metrics.fps` from smallint if you ever want to display GLMetrics-style raw idle FPS instead of the meaningful sim FPS.

## Reference docs (this session)
- `GLMetrics_vs_Citadel_GapAnalysis.md` — the gap register (G1–G6).
- `GLMetrics_Capability_Matrix.md` — GLMetrics→Citadel parity (now mostly ✅).
- `GLMetrics_Gap_G1_G3_ImplementationPlan.md`, `GLMetrics_Gap_G2_ImplementationPlan.md` — the build plans.
