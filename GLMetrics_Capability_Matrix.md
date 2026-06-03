# GLMetrics → Citadel Capability Matrix

> Decision artifact for the "rewrite the mod vs. extend" question. Maps every GLMetrics
> ("Game Logic" / glogic.app) capability — from its dashboard screenshots **and** its fully
> decompiled mod source — against Citadel's three layers: the `@CitadelAdmin` **mod** (does it
> emit the data?), the `citadel-cloud` **cloud** (ingest + read API?), and the cloud **UI**
> (does a page present it?).
>
> Authored 2026-06-02. Sources: GLMetrics decompiled source (`@GLMetrics/GLMetrics_extracted/`)
> + product screenshots; `@CitadelAdmin` source; `citadel-cloud` routes/schema/web (verified).
> Legend: ✅ parity/ahead · 🟡 partial (data or layer exists, not wired through) · ❌ gap.

## Headline verdict

**The mod is not the bottleneck. Do not rewrite it.** Citadel's `@CitadelAdmin` is at parity or
ahead of GLMetrics on **data collection** — it already emits kills (weapon/distance/hitzone),
deaths, hits/damage, chat, connect/disconnect/playtime, positions, per-player combat stats,
vehicles, world events, and server metrics, plus **40+ admin actions GLMetrics doesn't have**.

Everything that makes GLMetrics look more capable in those screenshots is **cloud analytics +
UI presentation** — a leaderboard, a player profile, a per-player map-travel replay, multi-server
analytics charts, and manager screens. Citadel already has the *telemetry* and mostly the *data
model* for these; it's missing the **read APIs and the pages**.

**Coverage estimate:** mod ≈ **90%** · cloud ingest/data ≈ **85%** · cloud read-API+UI ≈ **45%**.
The work is one small mod PR + a focused cloud/UI build — not a new mod.

---

## A. Telemetry foundation (what the mod must produce)

| GLMetrics data | Mod emits | Cloud stores | Verdict |
|---|---|---|---|
| Kills: weapon, distance, hitzone, headshot | ✅ `LogKill` | ✅ `plugin_kills` (30d history) | ✅ parity |
| Deaths: type/cause | ✅ `LogDeath`/`LogSuicide` | ✅ `plugin_deaths` | ✅ parity |
| Hits / dmg dealt + received | ✅ `LogHit` (dmg, zone, attacker, ammo) | ✅ `plugin_hits` table + `recordHit` (built 2026-06-02) | ✅ **DONE** — agent forwards `player_hit`; profile dmg dealt/taken + map-travel damage timeline |
| Chat | ✅ `LogChat` | ✅ `plugin_chat_messages` | ✅ parity |
| Connect / disconnect / playtime | ✅ `LogConnect`/`LogDisconnect` | ✅ `plugin_player_events` | ✅ parity |
| Position history (powers map-travel) | ✅ `players.json` @5s → `player_position` | ✅ `plugin_player_positions` (hypertable) | 🟡 parity; GLMetrics samples denser (5s is coarse for smooth paths) |
| Per-player combat stats (shots/accuracy) | ✅ `playerStats` (PR2) | ✅ `plugin_player_stats` | ✅ parity (just shipped) |
| Distance traveled / vehicle distance | ✅ `playerStats` (mod emit) | ✅ `plugin_player_stats` cols + profile (built 2026-06-02) | ✅ **DONE** — forwarded, stored (migration 0024), shown on profile |
| Vehicles (live) | ✅ `vehicles.json` | ✅ `plugin_vehicles` (snapshot) | ✅ parity |
| World events (gas/heli/contamination) | ✅ `dynamicEvent` + `events_world.json` | ✅ `plugin_world_events` | ✅ parity |
| Server metrics (FPS/AI/entities/uptime) | ✅ `metrics.json` | ✅ `plugin_server_metrics` | ✅ parity (FPS is a display/clamp issue, see note) |
| In-game server time / next restart | ❌ not emitted | ❌ | 🟡 minor (restart is a cloud schedule; server-time is cosmetic) |

> **FPS note:** GLMetrics' own screenshots show `9481 FPS` / `29904 FPS` — the same large
> idle-server reading our mod produces (`41357`). It's not a data defect; our pipeline rejects
> the value and shows 0 while GLMetrics displays it. One-line clamp/display fix, not mod work.

**A-gaps (all small, mod-side data already exists):** forward `hit` events and
`distance_traveled`/`vehicle_distance` as first-class topics; optionally raise position sample rate.

## B. Live ops console (map + feeds) — **Citadel at parity**

| GLMetrics feature | Mod | Cloud API | UI | Verdict |
|---|---|---|---|---|
| Live map: players/vehicles/events | ✅ | ✅ `positions/latest`, `vehicles`, `events/active` | ✅ `LiveMap` | ✅ parity |
| Live kill feed | ✅ | ✅ `/telemetry/kills` | ✅ `KillFeed` | ✅ parity |
| Live chat + send/broadcast | ✅ | ✅ `/telemetry/chat` + `message`/`broadcast` cmds | ✅ `ChatFeed` | ✅ parity |
| Kill-lines on map (killer→victim @dist) | ✅ kills carry both positions | ✅ | 🟡 `LiveMap` may not draw the line | 🟡 small UI add |
| Player list w/ K/D, ping, playtime, IP | ✅ mod + `rcon_players` | ✅ `rcon_players` + summary | 🟡 `PlayerActionMenu` (not a full ping/playtime list) | 🟡 partial |

## C. Player analytics — **leaderboard + profile now BUILT (2026-06-02)**

| GLMetrics feature | Mod | Cloud API | UI | Verdict |
|---|---|---|---|---|
| **Leaderboard / ranking** (points, K/D, last active) | ✅ data | ✅ **`/telemetry/leaderboard`** built | ✅ **page built** (`…/leaderboard`) | ✅ **DONE** (server-scoped; points = kills×2 matching GLMetrics) |
| **Player profile** (stats, first/last seen, name history) | ✅ data | ✅ **`/players/:id/profile`** built (summary+identity+trust) | ✅ **page built** (`…/players/[steamId]`) | ✅ **DONE** (server-scoped + cross-server identity/trust) |
| **Map-travel replay** (per-player path + event timeline) | ✅ positions+events history | ✅ `/replay?steamId=` filter (built) | ✅ **profile "Map travel"** → scrubber + path trail (built 2026-06-02) | ✅ **DONE** |
| Name history / aliases | ✅ names on every event | ✅ surfaced via profile API (`citadel_player_aliases`) | ✅ on profile page | ✅ **DONE** |
| DayZ hours (Steam playtime) | ❌ needs Steam Web API | ❌ | ❌ | ❌ gap (external API) |

## D. Multi-server dashboard & analytics — **BUILT (2026-06-02)**

One operator-wide endpoint `GET /analytics/overview?range=24h|7d|30d` + a `/cloud/dashboard` page
(headline cards, activity trend, engagement, combat, sessions) with a dependency-free `TrendChart`.

| GLMetrics feature | Mod | Cloud API | UI | Verdict |
|---|---|---|---|---|
| Multi-server overview cards (totals) | ✅ | ✅ `/analytics/overview` cards | ✅ dashboard cards | ✅ **DONE** |
| Activity chart (all servers over time) | ✅ | ✅ per-bucket Σ concurrent players | ✅ activity TrendChart | ✅ **DONE** |
| Player engagement (unique/new/returning) | ✅ from `player_events` | ✅ window vs prior-window diff | ✅ engagement panel | ✅ **DONE** |
| Session-duration analytics | ✅ playtime data | ✅ avg `duration_sec` | ✅ avg-session card | ✅ **DONE** |
| Combat-stats analytics (trends) | ✅ kills data | ✅ bucketed kill series | ✅ kills TrendChart | ✅ **DONE** |
| Total bans issued card | ✅ | ✅ `ban_submissions` by operator (built) | ✅ dashboard "Bans issued" card | ✅ **DONE (2026-06-02)** |

## E. Management screens (confirmed from full site scrape)

GLMetrics packages moderation as **reusable lists** you can apply across servers/teams:
BAN Manager = *banlists* (TOTAL/ACTIVE/INACTIVE/REVOKED), Chat Manager = *chat wordlists*,
Player Names Manager = *name lists*. Citadel already holds the equivalent data — but as
**per-server config arrays**, not portable lists, and without dedicated management UIs.

| GLMetrics page | Mod | Cloud API | UI | Verdict |
|---|---|---|---|---|
| BAN Manager — banlists w/ status counters | ✅ `CitadelBanManager` | 🟡 community bans + per-server config; no banlist CRUD | 🟡 cloud-bans admin only | 🟡 partial (data yes, list UI no) |
| Chat Manager — chat wordlists | ✅ enforced in mod | ✅ `chatFilters` in `plugin_server_config` + `/telemetry/chat?q` | ❌ no wordlist UI | 🟡 partial (config yes, list UI no) |
| Player Names Manager — name lists | ✅ name filters in mod | ✅ `nameFilters` in `plugin_server_config` | ❌ no list UI | 🟡 partial |
| Team Manager — staff/teams, team tickets | n/a | 🟡 reviewer-reputation only; **no org/team model** | ❌ | ❌ gap (multi-user) |
| Audit Logs — source/scope/level filters | ✅ `adminAction` | 🟡 `plugin_audit_log`, no read API | 🟡 admin pages only | 🟡 partial |
| Support — ticket system | n/a | ❌ | ❌ | ❌ gap (SaaS ops, low priority) |

## F2. Onboarding & reach — **the deepest architectural difference** (corrected 2026-06-02)

Both products run a **server-side mod**. The difference is how the mod's data reaches the cloud:

| Dimension | GLMetrics | Citadel | Implication |
|---|---|---|---|
| **Server-side mod** | ✅ yes (`@GLMetrics`) | ✅ yes (`@CitadelAdmin`) | parity on requiring a mod |
| **How mod data reaches cloud** | **Mod POSTs directly** to `glm.glogic.app` (`ApiConnection.c` → `GetRestContext()`) — self-sufficient | **Mod writes files → local Citadel Agent bridges to cloud** — needs the agent | GLMetrics' mod is independent of any host-side process |
| **Works on rented hosts** (Nitrado/GPORTAL) | ✅ yes — install the mod via the host's workshop manager; no extra process | ❌ **no** — can't run the separate Agent on a managed host | **Most DayZ owners rent.** Today Citadel only reaches self-hosted/VPS |
| **RCON** | layered on top for base admin + onboarding validation | ✅ have it (`rcon-client.js`) | parity; not the differentiator |
| **Server lifecycle (start/stop/backups/mods)** | ❌ none | ✅ full | Citadel does far more — but only where the Agent can run |

**The reach lever is mod self-sufficiency, not RCON.** To serve the rented-host market the way
GLMetrics does, `@CitadelAdmin` needs an **optional direct mod→cloud path** (the deferred **G2** in
`GLMetrics_vs_Citadel_GapAnalysis.md`): let the mod POST telemetry straight to the Citadel cloud
(with its own key/endpoint) when no Agent is present, falling back to the file-IPC+Agent bridge for
self-hosters who want full lifecycle management. RCON pairing complements this for base admin. This
is a bigger lever than any single dashboard page — but it's a separate track from the parity build.

## F. Admin actions & trust — **Citadel AHEAD**

| Capability | GLMetrics | Citadel | Verdict |
|---|---|---|---|
| In-game admin actions | ~30 | **40+** (godmode, invis, stamina, disease/cure, blood type, …) | ✅ Citadel ahead |
| Cheat detection pipeline | basic alert | `cheat_detections` + rules + ops-sweep | ✅ Citadel ahead |
| Cross-server ban reputation (vouch network) | ❌ none | ✅ Cloud Bans + trust score | ✅ Citadel ahead |
| On-call mobile triage | ❌ | ✅ `/cloud/oncall` | ✅ Citadel ahead |
| Server lifecycle / RCON / integrity / backups / DZSA | ❌ (telemetry mod only) | ✅ full agent | ✅ Citadel far ahead |

---

## Where the gaps cluster

Almost every ❌ is in **column 3 (cloud read-API) or column 4 (UI)** — leaderboard, player
profile, per-player map-travel, multi-server analytics, manager screens. The **mod column is
green** except three tiny data-forwarding items (hits, distance, denser positions) where the mod
*already collects* the data and just isn't putting it on the wire.

**Translation:** rewriting the mod would spend weeks re-earning the 40+ actions, hooks, command
runner, ban/filter enforcement, and killfeed engine `@CitadelAdmin` already has — and would close
**none** of the visible GLMetrics gaps, because those live in the cloud/UI. It's the wrong lever.

## Recommended build order (extend, don't rewrite)

0. **Strategic decision first — reach (RCON mode).** Decide whether Citadel pursues the rented-host
   market. If yes, an **RCON-only monitoring connection** (no agent/mod, reuse `rcon-client.js`) is
   the highest-leverage item on this whole page — it multiplies the addressable market and feeds the
   same cloud/UI you're about to build. If Citadel stays self-hoster-only, skip and start at 1.
1. **Mod micro-PR (small):** forward `hit` events + `distance_traveled`/`vehicle_distance` as
   first-class telemetry topics (data already collected in `CitadelPlayerStats`/`LogHit`);
   optionally raise the position emit rate for smoother replay paths.
2. **Cloud read-APIs:** `leaderboard` (rank by K/D/score from `plugin_kills`+`plugin_deaths`+
   `plugin_player_events`) and `player profile` (expose `citadel_players` + per-steamId aggregate
   + `citadel_player_aliases`).
3. **UI pages:** leaderboard, player profile, and **per-player map-travel** (reuse the existing
   `/replay` data filtered to a steamId — the scrubber already exists).
4. **Multi-server analytics dashboard** (activity / engagement / session / combat rollups).
5. **Manager UIs** (ban / chat / names) — incremental.
6. **Ops (not mod work):** the FPS display clamp, and the NAT/port-forward/DZSA discoverability
   fixes from the live-debug session.

## If you still want a fresh mod (honest cost)

A clean-slate mod means re-implementing: the event logger + all `Log*` types, the metrics/FPS/
tick trackers, the player/vehicle/AI/entity hooks, the command runner + 40+ actions, ban/whitelist/
filter enforcement, the killfeed engine, map markers, and config — **weeks of work to return to
today's parity**, with the competitor's obfuscated source unusable as anything but a reference
(and copying it verbatim is a copyright exposure since GLMetrics is a live commercial product).
Net: large cost, zero movement on the actual gaps. Reserve this only for a deliberate rebrand/
namespace reset — and even then, port the existing mod, don't rewrite it.

## Status log
- 2026-06-02 — Matrix created. Conclusion: extend (cloud/UI + 1 mod micro-PR), do not rewrite.
  Cloud/UI coverage verified against `citadel-cloud` routes + `packages/web` pages.
- 2026-06-02 — Added §E (management pages) and §F2 (onboarding/reach) from the full GLMetrics site
  scrape. Corrected §F2: GLMetrics also runs a server-side mod — the reach lever is **mod
  self-sufficiency (direct mod→cloud, the deferred G2)**, not RCON.
- 2026-06-02 — **Built Leaderboard + Player Profile** in `citadel-cloud`. API: two new routes in
  `telemetry-read.routes.ts` (`/telemetry/leaderboard`, `/players/:steamId/profile`) — type-check clean.
  Web: `useLeaderboard`/`usePlayerProfile` hooks + a leaderboard page + a profile page + a header link;
  web type-check clean. (Repo has no test harness or eslint config — `tsc --noEmit` is the verification.)
  Closes §C leaderboard/profile/aliases.
- 2026-06-02 — **Built per-player map-travel + distance vertical.** Map-travel: `/replay?steamId=` filter
  (`replay.routes.ts`) + `ReplayMap` path-trail polyline + profile "Map travel" link reusing the scrubber.
  Distance: mod `LogPlayerStats` emits `distance_traveled`/`vehicle_distance` → agent `_emitPlayerStats`
  forwards → cloud `plugin_player_stats` 2 cols (migration `0024_lively_wolverine.sql`) + sink + profile
  display. All cloud packages type-check (rebuilt `@citadel/shared`); agent forwarder tests 17/17.
  **Still pending: `hit` events** — a full vertical (new `plugin_hits` table + `recordHit` + dmg
  dealt/received timeline), deferred as its own slice.
- 2026-06-02 — **Built multi-server analytics dashboard (§D).** New operator-wide
  `GET /api/v1/analytics/overview?range=24h|7d|30d` (`analytics.routes.ts`, registered in `app.ts`) rolling
  up cards / activity / engagement / combat / sessions across the caller's owned servers. Web:
  `useAnalyticsOverview` hook + a dependency-free `TrendChart` + `/cloud/dashboard` page + an "Analytics"
  link on the console picker. All three cloud packages type-check clean. Deferred: a "Total bans" card.
- 2026-06-02 — **Built the hits / damage vertical (§A last item).** Agent `_emitHit` forwards `hit` →
  `player_hit`; cloud adds `PluginHitMessage`, `plugin_hits` hypertable (migration `0025` incl.
  `create_hypertable`), `recordHit` sink + dispatch; profile gains **dmg dealt / taken** aggregate; the
  replay bundle carries hits and the **per-player map-travel timeline shows damage events**. All cloud
  packages type-check; agent forwarder tests 20/20 (3 new). Mod already emitted `hit` — no mod change.
  **Parity track is now essentially complete.** Remaining: strategic **G2 mod self-sufficiency**
  (rented-host reach), the optional bans card, and denser position sampling for smoother trails.
- 2026-06-02 — **Polish done.** Dashboard "Bans issued" card (sourced from `ban_submissions` by the
  operator) — analytics endpoint + card, type-checks clean. Mod `playerUpdateIntervalMs` default 5s→3s
  for denser map-travel trails. **§D fully ✅.**
- 2026-06-02 — **G2 planned + Phase 1 built.** Wrote `GLMetrics_Gap_G2_ImplementationPlan.md` (direct
  mod→cloud over HTTP for rented-host reach). Decisions locked (command-in-response; auto + cloud guard).
  **Cloud Phase 1 done & type-checks clean:** `plugin-http-queue.ts` + `plugin-ingest.routes.ts`
  (`POST /api/v1/plugin/ingest` reusing `authenticatePlugin`+`sinkPluginMessage`, returns queued commands;
  `/commands/:id/result`), `dispatchCommand` HTTP routing, 409 coexistence guard. §F2 reach lever now has
  its cloud foundation. Next: Phase 2 mod `CitadelCloudClient` (Enforce, needs a live host to validate).
