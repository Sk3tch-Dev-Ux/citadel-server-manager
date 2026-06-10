# Verify on Windows — Session 2026-06-09 changes

> **STATUS (2026-06-10): VERIFIED on Windows 11** — see the Session 6 entry in
> `PUBLIC_LAUNCH_AUDIT.md` for full results. Steps 1–3 and 6 pass; step 4's
> socket-event flow was confirmed with a live socket.io client (serverStatus +
> log events through `emitServer`). Only the items needing a **running DayZ
> server + @CitadelAdmin mod** remain: live map/killfeed (step 5) and in-game
> command latency. Tests ran on the shipped Node 20.18.1 runtime — note the
> machine's system Node 24 cannot build better-sqlite3 (no prebuild, no VS
> toolchain); use Node 20/22 for local dev installs.

Smoke-test checklist for the security + performance work done this session. I verified everything I could in a Linux sandbox (node --check, ESLint, 317 backend tests). These steps cover what the sandbox can't: the Windows-native bcrypt test suite, and the live dashboard behaviour touched by the socket and route-registration changes.

## What changed (so you know what to watch)

- **HTTPS enforcement** — `server.js`, `config-schema.js`, `config.js` (new `requireHttps` flag + all-interfaces guard)
- **PowerShell hardening** — `backup-engine.js` disk-space check (execFileSync)
- **Bridge fs.watch refactor** — `citadel-bridge.js` (command latency + data poll)
- **Socket.IO** — `server.js` (compression), `context.js` (emitServer/emitGlobal), ~23 files routed through the helpers
- **Async error handling** — `lib/async-routes.js` (new), `server.js` (install + headersSent guard)
- **New tooling/docs** — `generate-cert.ps1`, `TLS_SETUP.md`, `PUBLIC_LAUNCH_AUDIT.md`

## 1. Build + automated checks

```bash
cd backend && npm install        # @node-rs/bcrypt / better-sqlite3 native rebuild for Windows
npm test                         # full Jest suite — test_api.test.js should now run (it can't in Linux)
npm run lint                     # backend + frontend ESLint
cd .. && npm run build           # Vite frontend build succeeds
```

Expected: all suites pass (test_api included this time), lint clean, build OK.

## 2. Boot the agent (HTTP, default loopback)

Start as usual. Confirm the startup banner shows `http://localhost:3001` and the dashboard loads — confirms the HTTPS enforcement guard does NOT trip on the normal loopback case.

## 3. HTTPS enforcement

- Run `./generate-cert.ps1`, restart. Banner should switch to `https://`; dashboard loads over TLS (self-signed warning is expected).
- Set `REQUIRE_HTTPS=true` (env or `citadel.config.json` → `server.requireHttps`), remove/rename `cert/`, restart. The agent should **refuse to boot** with the TLS-required message (in service mode it serves the 503 diagnostic page; in dev it exits).
- Restore certs (or unset the flag) to return to normal.

## 4. Live dashboard — socket events still flow (most important)

Open the dashboard with a running server and confirm real-time updates still arrive (these now go through `ctx.emitServer`/compression):

- **Server status** transitions (start/stop) update the cards live.
- **Player list** updates as players join/leave.
- **Metrics** graph keeps ticking (~15s).
- **Logs / Console** pages stream lines.
- **Notifications** still pop (these use `emitGlobal`).

If any live panel goes silent, that points at the socket emit migration — tell me which event.

## 5. Bridge — in-game commands + live map

With the @CitadelAdmin mod running:

- The **live map / killfeed** populates (fs.watch-driven data poll).
- Run an **interactive command** (heal / teleport / spawn) and confirm it completes promptly (should feel faster — was a 200ms poll floor, now near-instant).

## 6. Async error handling

Hit any endpoint that errors (e.g. an action against a stopped server) and confirm you get a clean JSON error response and no hung request / no `UnhandledPromiseRejection` in `data/service.log`.

## Rollback

All changes are isolated to the files listed above. `git diff` to review; `git checkout -- <file>` to revert any single one. The new files (`lib/async-routes.js`, `generate-cert.ps1`, `TLS_SETUP.md`, tests) are additive.

## Still open (gated on this verification)

- **Per-server Socket.IO rooms** — the `emitServer` seam is ready; flipping it to `io.to('server:'+id)` + a frontend room-join is a small, coordinated change.
- **Validation breadth** — extend the existing `request-validator` to more endpoints (defense-in-depth; behavior-changing, so do it with the UI to test).
