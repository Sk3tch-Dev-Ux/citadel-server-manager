# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Citadel Agent** (`citadel` in package.json) — local DayZ dedicated-server management for Windows. Node/Express backend + React dashboard + per-server Node sidecar + DayZ EnScript mod, shipped as an NSIS installer that registers a Windows Service. Pairs with **Citadel Cloud** (separate product at citadels.cc; sibling repo at `~/OneDrive/Documents/GitHub/citadel-cloud`) for remote operations — the cloud↔agent wire protocol is reconciled in that repo's `CITADEL_AGENT_ALIGNMENT.md`. Windows-only by nature (DayZ dedicated server is Windows-only); firewall/service features need Administrator.

## Commands

All from repo root unless noted:

```bash
npm run dev            # backend (:3001) + Vite frontend (:5173, proxies /api and /socket.io to :3001)
npm start              # setup + frontend build (if missing) + production backend on :3001
npm test               # backend Jest suite (cd backend && jest --forceExit --detectOpenHandles)
npm run lint           # ESLint backend + frontend
npm run build          # Vite build → web/dist/ (served by backend in production)
npm run build:installer  # node installer/build.js → build/CitadelSetup-{version}.exe (downloads Node runtime, needs NSIS)
```

Run a single backend test file (from `backend/`):

```bash
npm test -- data-store.test.js
npm test -- -t "test name pattern"
```

Tests live in `backend/tests/*.test.js`. `tests/setup-env.js` redirects the data dir to a temp location before modules load, so tests never touch the real `./data/`. Jest enforces a coverage **ratchet floor** (low thresholds in `backend/jest.config.js`) — raise it as coverage grows, never lower it.

Windows Service management: `npm run service:install|start|stop|status|uninstall|repair` (run from an Administrator terminal; installs as `CitadelServer` under Local System).

Frontend has no tests — lint only.

## Architecture

### Backend: global context singleton + route factories

- `backend/server.js` bootstraps: loads `data/*.json` into `ctx`, creates Express + Socket.IO, then registers ~40 route modules from `backend/routes/*.routes.js`.
- `backend/lib/context.js` is the shared-state singleton (`ctx`). Routes don't receive services via DI — they `require` `ctx` directly. Key fields:
  - `ctx.servers` — persisted multi-server array, each with a UUID `id` (saved to `data/servers.json`)
  - `ctx.serverStates[serverId]` — runtime state per server (status, pid, players, RCON client, sidecar pid). Parallels `ctx.servers` by the same UUID.
  - `ctx.CONFIG`, `ctx.io`, plus persisted collections (users, roles, webhooks, audit, bans, priority queue…)
- Route files export a factory: `module.exports = function(app) { app.get('/api/...', auth('perm'), handler) }`.
- A `serverId` route param is resolved via `ctx.servers.find(s => s.id === req.params.id)`; runtime lookups use `ctx.serverStates[id]`.

### Persistence: debounced atomic JSON, no database

`backend/lib/data-store.js` is the only persistence layer:
- `loadJSON()` — sync, startup only. `saveJSON()` — debounced (~300ms), writes to a temp file then atomically renames; refuses symlink targets; flushes the queue on shutdown.
- Sensitive files (`users.json`, `webhooks.json`, `audit.json`) are written mode `0o600`.
- Metrics optionally go to `data/metrics.db` (better-sqlite3). Everything else is JSON in `data/`.

### Sidecar + @CitadelAdmin mod: file-based IPC

Command chain for in-game actions (heal, teleport, spawn, etc.):

```
backend → HTTP → sidecar (localhost:9100 + gamePort − 2302)
        → writes {id, command, params} .cmd.json to <profileDir>/Citadel/commands/
        → mod (dayz-mod/@CitadelAdmin EnScript) executes in-game
        → writes {id, ok, data|error} .res.json to <profileDir>/Citadel/responses/
```

- `backend/lib/sidecar-manager.js` spawns one sidecar per running DayZ server (entry `sidecar/server.js`, detached, auth via `SIDECAR_API_KEY`).
- The mod also writes `Citadel/players.json` (position snapshots for the live map) and `Citadel/events.jsonl` (killfeed) which the backend polls.

### Auth & permissions

- `backend/middleware/auth.js`: `auth(permission)` and `authForServer(permission)` (adds per-server scope checks). JWT read from HttpOnly `auth-token` cookie first, Bearer header as fallback. Roles are **re-fetched on every request** (not trusted from JWT claims) so permission changes apply immediately; token revocation is checked on API calls and socket connections.
- RBAC with wildcard `*`; roles may carry a `serverScope` array limiting them to specific servers.
- Frontend (`web/frontend/src/api.js`): cookie-based auth with `credentials: 'include'`; the Electron desktop app instead sets `API.token` / `socket.auth.token` Bearer auth (no cookie jar).
- Logging is Pino (`backend/lib/logger.js`) with auto-redaction of sensitive field names — don't log credentials manually and don't bypass the logger with `console` (backend ESLint forbids it).
- State-changing actions should be recorded via `backend/lib/audit.js` (`addAudit(...)`).

### Discord bot lives in a separate repo

The Discord bot was extracted to the standalone `citadel-bot` repo (May 2026, local at `~/Documents/GitHub/citadel-bot/`); the in-repo `discord-bot/` directory was removed after v2.23.0 (recover from git history if ever needed). What remains here is the API surface the bot calls: `backend/routes/discord.routes.js` (`/api/discord/action`, permission map in `ACTION_PERMISSIONS`), `discord-user-roles.routes.js`, and the built-in `discord-bot` role seed in `server.js`. The legacy `CITADEL_AGENT_SPAWN_BOT=1` escape hatch in `server.js` logs and skips when the bot directory is absent. Don't add bot features to this repo.

### Desktop app

`desktop/` is an Electron (electron-builder, NSIS) wrapper around the same web UI pointed at the local backend, with electron-updater pulling from GitHub Releases (`latest.yml`). Its `package.json` version mirrors the root version.

## Releases & versioning

- Root `package.json` version is the source of truth; `installer/build.js` reads it at build time.
- `CHANGELOG.md` follows Keep a Changelog — add an entry for user-facing changes.
- Pushing a `v*` tag triggers `.github/workflows/release.yml` (windows-latest: NSIS + NSSM, optional code signing, uploads `CitadelSetup-{version}.exe` + `latest.yml`). `ci.yml` runs backend lint/tests and frontend lint/build on pushes and PRs to `main`.

## Directory notes

- `build/` — build artifacts, not source. Never edit `build/staging/`.
- `data/` — runtime data (gitignored), with one exception: `data/expansion-docs/` is tracked reference content served by `backend/routes/expansion-docs.routes.js`.
- `docs/`, `marketing/` — reference/marketing material, not build inputs.
- Removed from the tree after v2.23.0 (retrieve from git history if needed): legacy `Scripts/` CommandRelay mod, `discord-bot/`, `@GameLabs/`, `plans/`, and the root-level gap-analysis/planning documents.
