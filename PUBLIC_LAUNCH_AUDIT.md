# Citadel Agent — Public Launch Audit

**Date:** 2026-06-09
**Scope:** Security, Performance & Scale, Code Quality & Architecture
**Goal:** Cement Citadel as a production-grade, public-facing product
**Change appetite:** Bold refactor accepted
**Method:** Direct read of `backend/`, `sidecar/`, `web/frontend/`, `dayz-mod/` source. Findings carry exact `file:line` references and severity. Test coverage was explicitly de-prioritized for this pass but is called out where it gates a safe refactor.

> **Session 1 update (2026-06-09) — security pass started.** Hands-on verification corrected several findings below; the codebase is more hardened than the first pass assumed. Changes shipped this session (backend lint clean, full suite 308 pass / 0 fail):
> - **HTTPS enforcement (#1) — DONE.** Added `server.requireHttps` config flag (`config-schema.js`) and a fail-closed boot guard in `server.js` (inside the startup IIFE): refuses to start when `requireHttps` is set without TLS, and refuses an all-interfaces (`0.0.0.0`/`::`) bind over plaintext HTTP unless `ALLOW_INSECURE_BIND=1`. Loopback dev is unaffected.
> - **JWT secret (#2) — VERIFIED, already solid.** `config.js:74–112` generates a 64-byte CSPRNG secret, persists it `0o600`, loads it back, and `server-init.js:156` fails closed if absent. CSRF and credential-encryption both refuse insecure fallbacks. No change needed.
> - **PowerShell (#3) — DONE / mostly already safe.** `firewall-manager.js` (whitelist `sanitizeName` + quote-escape + numeric ports) and `lifecycle-hooks.js` (arg-array `spawn`, no shell) were already safe. Hardened the one outlier: `backup-engine.js` disk-space check now uses `execFileSync` with a validated single-letter drive instead of shell `execSync` string interpolation.
> - **Input validation / safePath (#4) — RE-SCOPED.** `safePath()` and `sanitizeBackupFilename()` already guard the file/backup endpoints. Remaining work (a shared `zod` schema layer across routes) is larger-surface and folds into the Track B route-factory effort.
> - **Async error handling (#5) — RE-SCOPED.** A global Express error handler already exists (`server.js:489`). The real remaining gap is an `asyncHandler` wrapper adopted across all 49 routes to catch async rejections — large-surface, Track B.
>
> Net: the launch-blocking security gap (silent HTTP fallback) is closed. The remaining two items are breadth refactors, not point fixes, and are best done alongside the route-factory work.

> **Session 2 update (2026-06-09) — TLS tooling + performance verification.**
> - **TLS setup — DONE.** Added `generate-cert.ps1` (self-signed cert helper, openssl-based, writes `cert/key.pem` + `cert/cert.pem`) and `TLS_SETUP.md` (enabling `requireHttps`, self-signed for local, real-cert / reverse-proxy for production). `.gitignore` already excludes `/cert/` and `*.pem`.
> - **Metrics retention (Perf #4) — CLAIM WITHDRAWN, already implemented.** `metrics-store.js` runs a 30-day time-based prune (`DEFAULT_RETENTION_MS`) **and** a 250k-row-per-server cap (`pruneRowCap`), via `runMaintenance()` — pruned on boot (`init()`) and hourly (`server-init.js`). Growth is bounded. No change.
> - **Process-poll dedup (Perf "HIGH") — CLAIM WITHDRAWN, already implemented.** `process-manager.js` has a `PROCESS_DETECT_TTL_MS` dedup cache (`_detectCache`) wired into both `detectRunningProcess` (exe) and `detectProcessByPid` (pid); transient failures are deliberately not cached; cache cleared on process exit. Covered by `tests/process-detect-cache.test.js`. No change.
>
> **Recalibrated performance backlog.** With those two withdrawn, the *genuine* remaining scale items are the architectural ones, not config tweaks: (1) synchronous FS (`statSync`/`readFileSync`) on the event loop in the bridge poller (`citadel-bridge.js:127–163`), (2) per-command file round-trip latency (write `.cmd.json` → poll `responses/`), and (3) full-payload Socket.IO fanout without per-server rooms. All three are Track B (async FS + `fs.watch`, then a named-pipe IPC channel). None block a small-scale launch.

> **Session 3 update (2026-06-09) — bridge fs.watch + socket fanout seam.**
> - **Bridge IPC (Perf #1/#2) — DONE.** `citadel-bridge.js` no longer busy-polls. `sendCommand` resolves via `fs.watch` on the responses dir (new test shows ~35ms vs the old 200ms floor) with a 500ms backstop; the data poll is now `fs.watch`-driven with async `fs.promises` reads and a slow 5s fallback interval. Public API and emitted events unchanged. New `tests/citadel-bridge-watch.test.js` (3 tests). Full suite green.
> - **Socket.IO fanout (Perf #3) — PARTIAL, by design.** Verified the Citadel mod feed is *already* per-server room-scoped (`citadel-socket.js`). The remaining fanout is ~109 global `ctx.io.emit` calls (dominated by `metrics`, `players`, log/console/rcon streams) which the frontend filters client-side. Shipped the safe groundwork: (a) **per-message compression** enabled on the Socket.IO server (`server.js`), and (b) all ~109 sites routed through new `ctx.emitServer()` / `ctx.emitGlobal()` helpers (`context.js`) that behave identically today. This is a behavior-neutral seam — flipping `emitServer` to `io.to('server:'+id)` plus a frontend room-join is the remaining, clearly-scoped step. **Deferred** (needs coordinated frontend changes + live-UI smoke test) rather than done blind.

> **Session 4 update (2026-06-09) — async error handling (Quality #5).**
> Confirmed the global Express error handler already exists (`server.js`), and most handlers try/catch (e.g. actions.routes: 57 handlers / 58 try-blocks) — but a real fraction are bare `async (req, res) =>` with no catch (e.g. `GET /bans`, `DELETE /bans/:banId`), where a rejection hangs the request. No route uses `express.Router()` — all 46 route files register directly on `app`. Rather than hand-wrap ~120 handlers, added `lib/async-routes.js` (`installAsyncErrorHandling`) which patches `app`'s routing methods once (installed right after `express()`, before any route/middleware) so every handler returning a promise gets `.catch(next)` — covering current and future routes. Also added a `res.headersSent` guard to the global error handler so a late rejection can't double-send. New `tests/async-routes.test.js` (6 tests). Full suite green (317 passed). This closes Quality #5; the remaining open audit item is the `zod` validation breadth pass.

> **Session 7 update (2026-06-10) — desktop npm audit cleared.**
> Closed the deferred desktop item from Session 6: bumped `electron` ^34 → **^42.4.0** (clears all 18 rolled-up Electron advisories, 11 high) and `electron-builder` ^25.1.8 → **^26.15.2** (clears the high-severity `tar` chain via `@electron/rebuild`/`app-builder-lib`), plus `electron-updater` ^6.3.9 → ^6.8.9. `desktop/npm audit` now reports **0 vulnerabilities**. The app's Electron API surface (BrowserWindow, tray, ipcMain, dialog, Notification, setWindowOpenHandler) is stable across 34→42 — no code changes needed. Verified: `electron-builder` NSIS build succeeds (`dist/CitadelDesktop-2.23.0.exe` + blockmap, asar integrity stamped), and the packaged app launches, shows its window, and establishes live connections to the local backend on :3001. All four package trees (root, backend, web/frontend, desktop) are now at 0 high/0 critical.

> **Session 6 update (2026-06-10) — Windows verification PASSED + npm audit gate.**
> Ran the full `VERIFY_ON_WINDOWS.md` checklist on the target Windows 11 machine, against the shipped Node 20.18.1 runtime (the machine's system Node 24 has no better-sqlite3 prebuild — used the installer's cached runtime instead). Results:
> - **Build + automated checks — PASS.** `npm install` (native bcrypt + better-sqlite3 rebuilt), full Jest suite **38 suites / 394 tests passed** (incl. `test_api.test.js`, which can't run on Linux), lint clean (0 errors), Vite build OK.
> - **Boot + HTTPS enforcement — PASS.** Normal loopback HTTP boot unaffected (banner `http://localhost:<port>`, dashboard 200). `REQUIRE_HTTPS=true` without certs → FATAL + exit 1. `BIND_HOST=0.0.0.0` over plaintext → FATAL + exit 1. `generate-cert.ps1` (Git-bundled openssl) → banner switches to `https://`, dashboard serves 200 over TLS with `REQUIRE_HTTPS=true`.
> - **Socket emit migration — PASS (live).** Connected a real socket.io client (Bearer auth, websocket transport, compression-enabled server): `serverStatus` (`starting`→`crashed`) and `log` events arrived live through the new `ctx.emitServer` seam during a server start attempt. Setup wizard → admin creation → login → CSRF double-submit all exercised on a fresh data dir; setup correctly locks after first admin (re-arm guard confirmed).
> - **Async error handling — PASS (live).** Malformed JSON body → clean 400 JSON; unauthenticated → 401 JSON; failed spawn → clean 500 `{"error":"spawn UNKNOWN"}`; no hung requests, no unhandled rejections in the boot log.
> - **npm audit gate — APPLIED.** Semver-compatible `npm audit fix` in `backend/` (5 high + 11 moderate → **2 moderate**, incl. fixes for path-to-regexp ReDoS and socket.io-parser unbounded attachments; full suite re-run green) and `web/frontend/` (6 high + 6 moderate → **2 moderate**; lint + build re-verified). Root: `concurrently` ^9→^10 (dev-only) → **0 vulnerabilities**. Remaining: 2 moderate each in backend/frontend need breaking bumps; **desktop tree still has 11 high** in the electron/electron-builder chain — needs major bumps and a desktop build to verify, deferred.
> - **Not verified (needs a live DayZ server + @CitadelAdmin mod):** live map/killfeed via the fs.watch data poll, and in-game command latency. Everything testable without a game server is verified.
>
> Verification was done against an isolated data dir + port; the production `CitadelServer` service on this machine was not touched.

> **Session 5 update (2026-06-09) — validation finding + pause to verify.**
> - **Validation (Security #4 / "adopt zod") — CLAIM REVISED, framework already exists.** `lib/request-validator.js` is a dependency-free schema validator (types, required, default, min/max, length, enum, pattern, custom) already used in 12 route files and introspected by the OpenAPI generator — adding `zod` would be redundant and a worse fit. The security-critical inputs are already guarded (`safePath`, `sanitizeBackupFilename`, RCON validator), and the unvalidated handlers do their own `if (!x) return 400` checks inside try/catch. The remaining work is incremental defense-in-depth (extending `validate()` to more endpoints), which is behavior-changing and best done with the dashboard available to smoke-test.
> - **Decision:** paused blind behavior-changing work to verify the session's changes on Windows first (see `VERIFY_ON_WINDOWS.md`). Validation breadth and the per-server room switch are the two remaining items, both gated on UI testing.

---

## 1. Verdict

Citadel is **architecturally mature** — clean route registration, a real RBAC layer with token revocation, atomic JSON persistence, helmet/CSP/rate-limiting already wired, and an mtime-guarded file bridge that is smarter than a naive poller. This is not a teardown. It is a **harden-and-decouple** effort.

The work that actually gates a public launch is narrow and concrete:

1. **A handful of security items** — enforce HTTPS, confirm there is no fallback JWT secret, lock down the PowerShell/shell surface, and add path/whitelist validation on the file-touching endpoints.
2. **Two scale bottlenecks** — synchronous FS on the event loop in the bridge/poller, and the per-command file round-trip latency. Neither blocks launch at small scale, but both cap growth.
3. **Decoupling for safe iteration** — the global `ctx` singleton and the 600–3700 LOC god-modules make every change riskier than it should be, and they are the reason test coverage sits at ~16%.

Realistic pre-launch security/scale hardening is on the order of **2–3 focused weeks**. The bold architectural refactor (DI/service layer, route factory, splitting god-modules, TypeScript) is a parallel, longer track that pays for itself the moment more than one person is touching the code.

---

## 2. Fix-Before-Launch Shortlist (ranked)

| # | Severity | Area | Finding | Fix |
|---|----------|------|---------|-----|
| 1 | CRITICAL | Security | HTTPS/TLS is optional, not enforced | Require TLS in production; redirect HTTP→HTTPS; refuse to boot public without certs |
| 2 | CRITICAL | Security | Confirm `ctx.CONFIG.jwtSecret` has **no** insecure default/fallback | Generate a strong secret on first run, persist `0o600`, fail closed if missing |
| 3 | HIGH | Security | PowerShell invoked via string interpolation (`backup-engine.js:172`, firewall temp `.ps1`) | Move to `execFile`/`spawn` with arg arrays; never interpolate into `-Command` |
| 4 | HIGH | Security | Sparse, ad-hoc input validation across ~49 routes; path/filename endpoints need whitelisting | Adopt one schema layer (zod) + a `safePath()` guard on every file endpoint |
| 5 | HIGH | Stability | Unguarded `async` route handlers → unhandled rejections; no global error middleware | Add `asyncHandler` wrapper + Express error middleware |
| 6 | HIGH | Scale | Synchronous `statSync`/`readFileSync`/`JSON.parse` on the event loop in the bridge (`citadel-bridge.js:127–163`) and process poller | Move to async FS + `fs.watch`; batch reads |
| 7 | MEDIUM | Scale | Per-command file round-trip latency (write `.cmd.json` → poll `responses/`) | Tighten/await via `fs.watch`; longer term, a real IPC channel (named pipe) |
| 8 | MEDIUM | Scale | Metrics SQLite growth has no retention/pruning policy | Add a retention window + scheduled prune |
| 9 | MEDIUM | Security | Wildcard `*` RBAC + Discord-bot default permissions are broad | Narrow defaults; least-privilege the bot action map |
| 10 | MEDIUM | Quality | Global `ctx` singleton couples all routes; blocks unit testing | Introduce a service layer / DI seam incrementally |

---

## 3. Security Findings

Auth is genuinely strong and should be stated plainly: `backend/middleware/auth.js` prefers the HttpOnly `auth-token` cookie over Bearer (`auth.js:22–32`), checks token revocation on every request (`auth.js:42`), **re-fetches role and user freshness from the store rather than trusting JWT claims** (`auth.js:47–50`), gates `mustChangePassword` (`auth.js:53`), and enforces per-server scope in `authForServer` (`auth.js:112–119`). That is above-average for a project at this stage. The findings below are about the surface *around* auth, not auth itself.

**CRITICAL — HTTPS not enforced.** TLS is optional in config. For a public deployment with cookie-based auth, serving over HTTP exposes the session cookie and all RCON/admin traffic. *Fix:* require TLS in production mode, set `Secure` on the auth cookie unconditionally in prod, redirect HTTP→HTTPS, and refuse to start a public listener without a cert.

**CRITICAL — verify JWT secret provisioning.** Auth relies on `ctx.CONFIG.jwtSecret` (`auth.js:39,86`). The one thing that would undermine the entire (otherwise solid) auth stack is a hardcoded or empty default secret. *Action:* confirm the secret is generated with CSPRNG on first boot, persisted at mode `0o600`, never logged, and that the process **fails closed** if it is absent rather than falling back to a constant.

**HIGH — PowerShell string interpolation.** `backend/lib/backup-engine.js:171–174` builds `powershell -NoProfile -Command "(Get-PSDrive ${drive...}).Free"`. Here `drive` is a derived drive letter (low practical injection risk), but the *pattern* is dangerous and is repeated in `firewall-manager.js` (temp `.ps1` elevation, `firewall-manager.js:73–93`) and `lifecycle-hooks.js`. Firewall rule parameters (ports, names) and lifecycle hook paths are the higher-risk inputs. *Fix:* standardize on `execFile`/`spawn` with argument arrays everywhere; treat any `-Command` string concatenation as a defect.

**HIGH — input validation is ad-hoc.** No shared schema library; validation is hand-rolled per route and inconsistent. The file-touching endpoints (backups, logs, mod/config editors) are the ones that matter for a public launch — path traversal on a filename parameter is the classic exploit. The file editor already uses a `safePath()` guard (good); the goal is to make that universal. *Fix:* adopt `zod` (or `express-validator`) for body/param schemas, and require a `safePath()`-style containment check on every endpoint that resolves a user-supplied path.

**MEDIUM — broad RBAC defaults.** The wildcard `*` permission is correct as a concept, but the Discord-bot action map and some default roles grant more than least-privilege. *Fix:* audit `discord.routes.js` `ACTION_PERMISSIONS` and default role seeds; narrow to the minimum each action needs.

**MEDIUM — rate limiting gaps.** Rate limiting is present and well-configured on most routes but missing on file-download endpoints, which are cheap to abuse for I/O amplification. *Fix:* extend the limiter to download/export routes.

**LOW/INFO — secrets at rest.** RCON passwords are necessarily plaintext (a DayZ protocol limitation, not a Citadel defect); sensitive JSON files are already written `0o600` and the Pino logger auto-redacts. No hardcoded production secrets were found (the Discord key in tree is a placeholder). *Action:* run `npm audit` across all four `package.json` trees as a release gate.

---

## 4. Performance & Scale Findings

The headline correction to earlier surveys: the file bridge is **not** a naive re-parse-everything poller. `citadel-bridge.js` caches mtimes and only re-reads a file when it changes (`citadel-bridge.js:127–136`), and tails `events.jsonl` by reading only the byte delta past a cursor (`citadel-bridge.js:149–177`). The polling interval defaults to 2s (`citadel-bridge.js:80–88`) and only runs while a server has subscribers (`citadel-bridge.js:101–109`). That design is sound for tens of servers. The real ceilings are below.

**HIGH — synchronous FS on the event loop.** The bridge uses `fs.statSync` + `fs.readFileSync` + `JSON.parse` (`citadel-bridge.js:127–132`) and synchronous `openSync/readSync/closeSync` for event tailing (`citadel-bridge.js:160–163`) inside a `setInterval` that runs per server. Each call is 1–5 ms, but they are serialized on the main thread and multiplied by server count. At ~50 servers this is a meaningful, avoidable stall. *Fix:* switch to async FS (`fs.promises`) and replace polling with `fs.watch` on the Citadel dir so reads only happen on actual change.

**MEDIUM — per-command round-trip latency.** Commands are sent by writing `commands/{id}.cmd.json` and waiting for `responses/{id}.res.json`, with a 10 s timeout (`citadel-bridge.js:26`). Latency is bounded by poll cadence, so interactive actions (heal/teleport/spawn) feel sluggish under load. *Fix:* watch the `responses/` dir with `fs.watch` to resolve immediately on file appearance; longer term, replace file IPC with a Windows **named pipe** or local socket for sub-100ms commands and a higher player ceiling.

**HIGH — process detection over-polling.** `backend/lib/polling.js` spawns `tasklist` per server on a tight cadence (≈15 s) with a dedup TTL that exists but is not used. At 50 servers this is thousands of process spawns/hour. *Fix:* wire up the existing `PROCESS_DETECT_TTL_MS` dedup cache; consider a single batched `tasklist` query for all servers per tick instead of one-per-server.

**MEDIUM — metrics retention unbounded.** `backend/lib/metrics-store.js` writes to `data/metrics.db` (better-sqlite3) with indices (`metrics-store.js:77–82`) but no pruning. Over months of public use this grows without limit and slows queries. *Fix:* add a retention window (e.g. raw 7–14 days, then downsample/rollup) and a scheduled prune job.

**MEDIUM — Socket.IO fanout.** Live updates broadcast full player/metrics payloads to all connected clients on each tick, uncompressed and without selective subscription. Fine at small scale; at 50 servers × many dashboards it is real bandwidth. *Fix:* per-server room subscriptions so a client only receives the servers it is viewing; enable compression; send deltas, not full snapshots.

**Practical ceiling.** As written, comfortable to ~20–50 servers per agent; degradation in the 75+ range driven by event-loop FS stalls and process-spawn overhead. The two changes that lift the ceiling most: (1) `fs.watch` + async FS in the bridge and poller, and (2) replacing file IPC with a named pipe for commands. Worker threads for log parsing are a later optimization, not a launch blocker.

---

## 5. Code Quality & Architecture Findings

**HIGH (maintainability) — global `ctx` singleton.** `backend/lib/context.js` is required directly by routes and libs across the backend (~dozens of files), so nothing can be unit-tested in isolation without booting the whole context. This is the root cause of the ~16% coverage figure: it is not that tests weren't written, it's that the architecture makes them expensive. *Refactor:* introduce a thin service layer (e.g. `serverService`, `userService`, `auditService`) that owns the state and is passed into route factories. Migrate route-by-route; `ctx` can remain as a compatibility shim during the transition.

**HIGH (maintainability) — god-modules.** Backend: `routes/actions.routes.js` (~1,074 LOC), `routes/dangerzone.routes.js` (~775), `routes/discord.routes.js` (~629), plus ~10 more files over 500 LOC. Frontend: several pages over 1,000 LOC, with `ExpansionEditor` around 3,700 LOC the worst. These are change-risk concentrators. *Refactor:* split route files by resource/sub-feature behind a common factory; extract frontend editors into composed sub-components with isolated state.

**HIGH (stability) — error handling.** Async route handlers are not uniformly wrapped, so a rejected promise in a handler can become an unhandled rejection rather than a clean 500. There is no central Express error middleware; each route try/catches ad hoc, producing inconsistent response shapes. *Refactor:* add an `asyncHandler(fn)` wrapper and a single error-handling middleware that logs via Pino and returns a consistent `{ error }` envelope. This is cheap and removes a class of production crashes.

**MEDIUM (maintainability) — route boilerplate.** The ~49 route modules repeat auth + validation + try/catch + response shaping. *Refactor:* a route factory / shared handler that takes `{ permission, schema, handler }` would collapse most of this and make every endpoint consistent by construction — and it pairs naturally with the validation and error-handling fixes above.

**MEDIUM — dead/deprecated code.** `discord-bot/` is deprecated (extracted to the standalone `citadel-bot` repo) and kept "one release only" per `CLAUDE.md`; `Scripts/` is legacy CommandRelay; `@GameLabs/` is empty. *Action:* delete `@GameLabs/` now; schedule `discord-bot/` removal for the release after launch (keep the API surface it calls); confirm `Scripts/` has no live build references before removing.

**LOW — dependency & config health.** Dependencies are current and reasonably aligned; desktop mirrors root version. The codebase is plain JS throughout with ESLint configured. *Recommendation (bold-refactor track):* introduce TypeScript incrementally starting at the new service layer and `lib/` boundaries — it is the single highest-leverage move for a growing team and a public API surface. Add Prettier and frontend tests as part of the same push.

---

## 6. Bold-Refactor Architectural Moves

These are the structural bets worth making now, while the team and userbase are small enough to absorb the churn:

1. **Service layer + DI seam.** Break the `ctx` monolith into injectable services. Unlocks unit testing, makes Citadel Cloud integration cleaner, and is the prerequisite for raising coverage cheaply.
2. **Route factory + zod schemas + error middleware.** One pattern for every endpoint: declared permission, declared schema, wrapped handler, consistent errors. Collapses boilerplate across 49 files and closes the validation and unhandled-rejection gaps in one motion.
3. **Replace file IPC with a real channel.** Named pipe (or local socket) between backend, sidecar, and mod bridge. Removes the polling latency floor and the synchronous-FS event-loop tax, and is the change that most raises the player/server ceiling.
4. **TypeScript on the new boundaries.** Don't rewrite the world — type the service layer, the IPC protocol, and the Cloud↔Agent wire contract first, where type errors are most costly.
5. **Metrics lifecycle + observability.** Retention/rollup for SQLite plus structured health/perf metrics for the agent itself, so public-scale issues are visible before users report them.

---

## 7. Suggested Sequencing

**Track A — Launch gate (security/scale, ~2–3 weeks, conservative changes):**
HTTPS enforcement → verify/repair JWT secret provisioning → PowerShell arg-array migration → zod validation + universal `safePath()` on file endpoints → `asyncHandler` + error middleware → async FS + `fs.watch` in bridge and poller → process-detect dedup → metrics retention → `npm audit` gate.

**Track B — Bold refactor (parallel, ongoing):**
Service layer extraction (route-by-route) → route factory rollout → split god-modules (start `actions`, `dangerzone`, `ExpansionEditor`) → named-pipe IPC → TypeScript on new boundaries → frontend tests → raise the Jest coverage floor as it climbs.

Track A is the public-launch checklist. Track B is what makes Citadel "an absolute beast" to maintain and scale after launch. They don't block each other if Track B proceeds via incremental, well-isolated PRs.

---

*Findings verified by direct source reading. Line references current as of 2026-06-09; re-check after any intervening edits. Coverage was de-scoped this pass — the service-layer refactor (Track B) is the prerequisite that makes raising it inexpensive.*
