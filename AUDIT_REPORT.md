# Citadel — Full Deep Audit Report

**Date:** 2026-05-06
**Repo:** `DayzServerController` (v2.17.0)
**Scope:** Backend, Discord bot, Electron desktop app, DayZ mod, web frontend, sidecar, installer
**Focus:** Security, code quality / architecture, performance & reliability
**Method:** Read-through of every meaningful file end-to-end, cross-referenced against trust boundaries (HTTP API, IPC, child process spawns, in-game RPC, file I/O). No code was changed.

---

## Executive Summary

Citadel is a large, ambitious, multi-component application: an Express + Socket.IO backend (~33 kloc), a React/Vite web panel (~33 kloc), an Electron wrapper, a Discord bot, a Node sidecar, and a DayZ Enforce-Script mod (~9 kloc). The architectural posture is good in places — Helmet, CORS allowlist, JWT with auth middleware, CSRF double-submit, fail2ban brute-force, AES-256-GCM credential encryption, Electron with `contextIsolation`/`sandbox`/`nodeIntegration:false`, atomic JSON writes — but several security and reliability defects undermine it. The most consequential are:

- A **CSRF fallback secret** that turns into a known constant if `JWT_SECRET` isn't loaded yet (`backend/middleware/csrf.js:20`).
- A **path-traversal bypass** in the cross-platform branch of `safePath()` that's reachable from the file-browser routes (`backend/lib/helpers.js:56`).
- A **broken constant-time login** because the dummy bcrypt hash is malformed and rejected before the compare runs (`backend/routes/auth.routes.js:55`).
- A **CSRF/Discord integration collision** — `/api/discord/action` is not in the CSRF exempt list, so every bot call is rejected with 403 unless this is patched separately (`backend/middleware/csrf.js:98`, `backend/routes/discord.routes.js:31`).
- An **unauthenticated setup wizard** that re-arms whenever `data/setup_complete.json` is missing — including takeover of the existing root admin (`backend/routes/setup.routes.js:27`, `:82`).
- The **Discord bot's API key is full-admin** and bypasses the role/permission system (`backend/routes/discord.routes.js`).
- The **sidecar runs auth-disabled when no API key is configured** and binds to all interfaces (`sidecar/auth.js:12`, `sidecar/server.js:1382`).
- **Tracked files that should be ignored**: `data/audit.json`, all of `dayz-mod/`, `Scripts/examples/`, and a junk file literally named `$null` are committed despite `.gitignore` (`.gitignore` lines for `/data/`, `/dayz-mod/`).
- The general API rate limiter is a **passthrough** (`backend/middleware/rate-limit.js:11`), so non-auth endpoints have no rate limit at all.
- The DayZ mod **sends its API key as a URL query parameter** to the backend, which leaks it into logs/proxies (`Scripts/CommandRelay.c:1575`, `:668`, `:742`, `:813`, `:1075`, `:8674`, `:8690`).

The backend's HTTP attack surface is the most exposed component. The Electron wrapper is mostly fine. The mod has a strong design (file-queue IPC, sequential ack) but its credential transport is weak.

Counts (rough, severity by my read):

- **Critical:** 5
- **High:** 9
- **Medium:** 12
- **Low / Hygiene:** 15+

---

## 1. Backend (Express + Socket.IO)

`backend/server.js` wires Helmet, CORS, CSRF, rate limiting, JWT auth, and ~50 route modules. The structure is clean and the boundary checks exist; the issues below are mostly individual cracks rather than missing armor.

### 1.1 CRITICAL — CSRF fallback secret (`backend/middleware/csrf.js:20`)

```
const CSRF_SECRET = process.env.JWT_SECRET || 'fallback-csrf-secret';
```

This is captured **at module load time**. If for any reason `JWT_SECRET` is not yet set (load-order regression, test harness, code changes that import `csrf.js` before `config.js` runs the auto-generate), the literal `'fallback-csrf-secret'` becomes the HMAC key for every CSRF token in the system — i.e. global CSRF bypass, deterministically. Today's load order in `server.js` happens to set the env var before `csrf.js` is required (line 28 vs. 92), but the dependency is silent and easy to break.

Fix: throw at module load if `process.env.JWT_SECRET` is missing, instead of falling back. Keep the same secret source and length checks `config.js` already enforces.

### 1.2 CRITICAL — Path-traversal bypass in cross-platform branch (`backend/lib/helpers.js:40`–`:69`)

The non-Windows-on-Windows-path branch (lines 52–59) checks:

```
if (!resolved.startsWith(normalizedBase)) return null;
```

This is the classic "missing trailing separator" bug. With `installDir = "C:/DayZServer"` and `userPath = "../DayZServerEvil/anything"`, the joined path normalizes to `C:/DayZServerEvil/anything`, which starts with the literal string `C:/DayZServer` and passes the check. Any sibling directory with a name that shares the prefix is reachable. The native branch (lines 61–67) does it correctly (`startsWith(realBase + path.sep)`).

This is reachable through `backend/routes/files.routes.js` (read/write/list) when the backend runs on macOS/Linux against a remote Windows DayZ server (a "dev mode" pattern documented in the file). On a Windows-native deploy the realpath branch is taken and the bug is not triggered.

Fix: append `path.posix.sep` to the comparison, i.e. `!resolved.startsWith(normalizedBase + '/') && resolved !== normalizedBase`.

### 1.3 CRITICAL — Constant-time login is broken (`backend/routes/auth.routes.js:55`)

```
const dummyHash = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0';
```

This is **not a valid bcrypt hash**. After the `$2a$10$` prefix, bcrypt expects 22 chars of salt + 31 chars of digest (53 chars). This string has 49 chars after the prefix. `bcrypt.compare()` returns `false` immediately on a malformed hash without doing the work — defeating the timing-side-channel mitigation the dummy is meant to provide. User enumeration via timing is recoverable.

Fix: pre-compute a real bcrypt hash (e.g. `bcrypt.hashSync('citadel-dummy', 10)`) once at module load, store it as a constant, and compare against that.

### 1.4 CRITICAL — Discord-bot endpoint blocked by CSRF middleware (`backend/middleware/csrf.js:98`, `backend/routes/discord.routes.js:31`)

`app.use('/api/', verifyCsrfToken)` (`server.js:127`) applies CSRF verification to every `POST /api/*` route. The exempt list (`csrf.js:98`) is `['/api/auth/login', '/api/setup/', '/api/health', '/api/store/webhook']`. The Discord bot calls `POST /api/discord/action` (server-side, with `Authorization: Bearer <DISCORD_BOT_API_KEY>` and **no cookies**). The bot has no way to fetch a CSRF nonce, so every bot call gets a 403 ("CSRF token missing") today. Either the Discord integration is silently broken or there is a runtime patch I didn't find.

Fix: add `'/api/discord/'` to `exemptPaths`, and document that `/api/discord/action` is authenticated by the static API key (timing-safe-compared at `discord.routes.js:49`) rather than by user JWT + CSRF.

### 1.5 CRITICAL — Setup wizard takeover (`backend/routes/setup.routes.js:27`–`:38`, `:82`–`:84`)

`getSetupState()` returns `'needs_setup'` whenever the only user is `username === 'admin' && isRoot === true` and `data/setup_complete.json` is missing. In that branch, `POST /api/setup/admin` writes `existing.username = username; existing.passwordHash = hash;` with **no authentication at all** (lines 82–84). If `setup_complete.json` is ever lost (manual data-dir cleanup, bug, partial restore from backup), an unauthenticated caller on the network can rename the root admin and set its password. The `requireSetupMode` guard alone is not access control.

Other setup endpoints (`/network`, `/steam`, `/steam/save`) likewise mutate `.env` and `citadel.config.json` with no auth.

Fix: persist a "first-run completed" flag inside `users.json` (or a separate file written **before** the admin record) and refuse setup if **any** non-default state already exists; never re-arm setup based on a single deletable file.

### 1.6 HIGH — Discord-bot API key is god-mode (`backend/routes/discord.routes.js`)

A caller with `DISCORD_BOT_API_KEY` can invoke any of `ALLOWED_ACTIONS` against any server with no role check, no per-Discord-user permission, and no audit attribution beyond what the bot voluntarily passes (`discordUser`/`discordUserId` in the body — both client-supplied and easily spoofed). The ban/kick/RCON/mod-install paths all run in the context of an audit log entry like `Discord Bot`. The bot itself does have `isAdmin()` (`discord-bot/utils/permissions.js:8`) tied to a Discord role, but the backend has no way to verify that — anyone with the API key bypasses it.

Fix: scope the bot to a server allowlist (per-key); require the bot to sign each call with a per-Discord-user identity that the backend can map to a Citadel role (or at minimum a "discord-bot" role with limited permissions); never trust `discordUser`/`discordUserId` from the request body for audit (mark it explicitly as bot-attributed, log the API-key fingerprint).

### 1.7 HIGH — General API rate limit is a no-op (`backend/middleware/rate-limit.js:11`)

```
const apiLimiter = (req, res, next) => next();
```

Comment says "disabled for local tool". `authLimiter` and `discordLimiter` cover only `/api/auth/*` and `/api/discord/*`. Every other endpoint (file read/write, RCON, server actions, mod install, dangerzone, deploy, workshop search, etc.) has zero rate limiting. With CORS allowlist-misconfigured or with the panel exposed to a LAN, this is a DoS amplifier — and several routes are CPU/IO-heavy (XML parser pages, mod scans, regex pages running on tens of MB of XML).

Fix: replace the no-op with a real `express-rate-limit` instance (e.g. 600 req/min per IP) and exempt only socket-driven streaming endpoints. If the project really only runs on localhost, bind to `127.0.0.1` and document that constraint.

### 1.8 HIGH — File-write whitelist allows scripts in `installDir` → executed by lifecycle hooks (`backend/routes/files.routes.js:17`–`:26`, `backend/lib/lifecycle-hooks.js:33`–`:40`)

`SAFE_WRITE_EXTENSIONS` includes `.bat`, `.cmd`, `.ps1`, `.sh`. A user with `files.edit` permission can write a script anywhere reachable under `srv.installDir`. `lifecycle-hooks.js` then auto-runs any script named `lifecycle.{event}.{ext}` in `installDir/lifecycle_hooks/` on `pre-start` / `started` / `stopped` / `crashed` events using PowerShell (`-ExecutionPolicy Bypass`) / cmd / Python. So `files.edit` is effectively privilege-escalation to the backend's process identity — typically `LOCAL SYSTEM` when run as the Windows service. This is a feature for power users, but it's easy to miss when assigning `files.edit` to a "moderator"-style role.

Fix: split the permission, e.g. `files.edit` (configs only) vs. `files.edit-scripts`; or refuse to write `.bat`/`.cmd`/`.ps1`/`.sh` outside an explicit `lifecycle_hooks/` opt-in path and require `server.rebuild` (or a dedicated `hooks.manage`) for that. At minimum, extend the audit log entry with the destination path classification.

There's also a never-matching whitelist entry — `'.js.bak'` (line 22) — `path.extname()` returns only `.bak` for `foo.js.bak`. Either remove it or normalize on `endsWith()`.

### 1.9 HIGH — Sidecar binds to all interfaces and disables auth without a key (`sidecar/auth.js:12`, `sidecar/server.js:1382`)

```
// auth.js
if (!config.apiKey) return next();      // dev mode: open
// server.js
server = app.listen(config.port, ...)   // binds 0.0.0.0
```

If `SIDECAR_API_KEY` is unset (the default in `sidecar/config.js:13`), the sidecar accepts admin actions (heal/kill/teleport/spawn-item/strip/explode/ban/kick/RCON-style) from anyone who can reach port 9100+. Any LAN-attached attacker with port access becomes a god-mode admin. The sidecar-manager passes the key through (`backend/lib/sidecar-manager.js:68`) only when `srv.inHouseApiKey` is configured.

Fix: refuse to start the sidecar if `SIDECAR_API_KEY` is empty (production) or only-bind to `127.0.0.1` when no key is set. The sidecar-manager should always generate a per-server random API key when the server is created and persist it to `servers.json`.

Also: the timing-safe compare leaks token length via the early-return on mismatch (`auth.js:20`). Padding both buffers to a fixed length before `timingSafeEqual` would close that.

### 1.10 HIGH — DayZ mod sends `api_key` as a URL query parameter (`Scripts/CommandRelay.c:1575`, multiple ack endpoints)

Every poll/ack/event call from the mod attaches `?api_key=...&server_id=...` to the URL. Once it leaves the DayZ server's RestApi:

- The key gets logged by the mod's own `Log("Polling: " + url + params)` (`:1578`) into the `.RPT`.
- It will be captured by any HTTP-access log on the receiving side.
- It traverses any reverse proxy in cleartext if the configured URL is `http://`.

The default in the source is `https://example.com/...`, which mitigates the third concern *if* operators leave it on HTTPS, but the first two are unconditional.

Fix: send `api_key` in an HTTP header (`Authorization: Bearer ...` or `X-API-Key`), validate it that way on the backend, and stop logging the URL with credentials.

### 1.11 MEDIUM — JWT in `localStorage` (`web/frontend/src/api.js:5`)

`API.token = localStorage.getItem('token') || ''` and `Authorization: Bearer ${this.token}`. Any DOM-XSS reads the JWT and exfiltrates it. The CSRF design is good but does nothing for token theft. Helmet's CSP at `server.js:96`–`:119` restricts `script-src` to `'self'` and `cdnjs.cloudflare.com`, which helps; still, an HttpOnly cookie + the existing CSRF flow would be defense-in-depth.

Fix: move the JWT to an HttpOnly, Secure, SameSite=strict cookie set on `/api/auth/login`; have the API read it from `req.cookies.token` and keep the existing CSRF nonce header for state-changing requests.

### 1.12 MEDIUM — Lockout-by-username denial of service (`backend/routes/auth.routes.js:71`–`:74`)

`loginAttempts[username]` locks after 5 failures regardless of source IP. An attacker who knows a target's username can lock that account by spamming bad-password attempts. Per-IP fail2ban exists but per-account state is independent — and the per-IP limit is 5 too, so one IP can lock multiple accounts. Combine with the broken constant-time path (1.3) and you get user enumeration + targeted lockout.

Fix: only lock account on consecutive fails *from the same IP*, or shorten lockout to be per-IP-per-username with the IP as the namespace.

### 1.13 MEDIUM — Role-name comparison instead of permission check (`backend/routes/users.routes.js:46`, `:69`)

`req.user.role !== 'admin'` matches the literal role-id string. Custom roles (which the role manager allows) can have `users.manage` permission without being `'admin'`, so a non-admin role with `users.manage` can edit other users only if its id is literally `'admin'`. That's the safe direction (non-admin custom roles can't lateral). But it's brittle: a developer adding "superadmin" later loses the ability to edit other users without realizing it. A permission-based check (e.g. role has `*` or `users.manage-others`) reads better.

### 1.14 MEDIUM — Server name confirm uses CSRF-style equality but does not protect race (`backend/routes/dangerzone.routes.js:241`, `:604`)

Wipe/replicate gate on `confirmName === srv.name`. After the request returns and `setDangerzoneActive` flips, the wipe runs on the *original* `srv` object; nothing prevents a concurrent rename mid-wipe. Low-impact, but you can imagine an admin accidentally typing the new name during a rename + wipe. Take the snapshot up front.

### 1.15 MEDIUM — `executable` / `username` shell args (`backend/lib/process-manager.js`, `backend/lib/steamcmd.js`)

`spawn()` is used everywhere instead of `exec()`/`execSync()` with shell strings — good. Two callers still build PowerShell strings and pass them as `-Command` arguments: `process-manager.js:81` (`Get-Process -Id ${safePid}` — `safePid` is `parseInt`d, OK) and `process-manager.js:239`–`:242` (uses `parseInt(serverConfig.cpuAffinity, 10)` and an allowlist on `priorityLevel`, OK). One concern: `steamcmd.js:32` builds a PowerShell `Expand-Archive` command with single-quote escaping for `zipPath`/`steamCmdDir` (controlled by `ROOT`, not user input — safe today, but the pattern is fragile if a future caller pipes user-controlled paths).

Fix: switch `Expand-Archive` to a `tar` or Node `unzipper` invocation that doesn't require quoting; document the rule that user-controlled paths must never reach a `-Command` PowerShell string.

### 1.16 MEDIUM — Atomic JSON writes susceptible to symlink swap (`backend/lib/data-store.js:69`–`:73`)

`writeFile(tmpPath, ...)` then `rename(tmpPath, filePath)`. If `dataDir` is attacker-writable and `filePath` is replaced with a symlink before the rename, the rename clobbers the symlink target instead of producing a normal file. This is a niche local-attack scenario (the data dir is normally not world-writable), but the code can refuse if `lstat()` shows a symlink at `filePath`.

### 1.17 MEDIUM — Sensitive JSON written without permission tightening

`saveJSON` writes user records, password hashes, MFA secrets (encrypted), webhooks, audit logs, lockouts, `.jwt-secret` (`backend/lib/config.js:102`). On Windows under NSSM as `LOCAL SYSTEM` the ACLs default to "Administrators + System." On Linux `umask` defaults to 0644 → world-readable. The encryption-at-rest comment in `credential-encryption.js` is sound, but the JWT secret file is plaintext. `fs.writeFileSync(file, data, { mode: 0o600 })` would close that on Linux.

### 1.18 MEDIUM — `JsonFileLoader` round-trips player input without size or shape limits (mod side)

`Scripts/CommandRelay.c` parses inbound JSON via a hand-rolled brace-walker (`:1593`–`:1620`) and ack JSON via `JsonFileLoader`. There's no length cap on `data` (`:1582`), no max-commands, no max-string-fields. A server returning an arbitrarily large JSON to a poll could degrade the mod's tick. Add `if (data.Length() > MAX_BYTES) return;` and trim `commands` to N per tick.

### 1.19 LOW — Junk and accidentally-committed paths

- `$null` (45 bytes; a PowerShell redirection error captured to a file literally named `$null`).
- `C:\DayZServer/profiles/` directory in the repo root (Windows-style path treated as a relative dir on macOS; not committed but present locally).
- `data/audit.json` is committed despite `.gitignore` having `/data/` — contains real user IDs and login timestamps.
- `dayz-mod/` (29 files) is committed despite `.gitignore` having `/dayz-mod/` (the gitignore rule was added later; the files predate it).
- `Scripts/examples/config.json` ships a `"api_key":"REPLACE_ME"` literal that grep flags as a "secret" in default-fallback scans.

Fix: `git rm --cached` the offenders, add a CI check (e.g. `git ls-files | grep -E '^(data|dayz-mod)/'` should be empty), and remove the `$null` file.

### 1.20 LOW — Outdated `bcryptjs` 2.4.3

`bcryptjs ^2.4.3` (2017). Modern alternative is the native `bcrypt` package or `@node-rs/bcrypt`. `bcryptjs` still works but is significantly slower (pure-JS), which is felt on every login because the login flow always runs a compare even on negative-cache. Native bcrypt would let you raise the cost factor (you're at 10) without the latency hit.

### 1.21 LOW — `uuid` version drift

Backend pins `^9.0.1`, sidecar pins `^13.0.0`. Both work fine with `v4()`, but a single shared version avoids surprises if you ever pass UUIDs across the boundary.

### 1.22 LOW — `cookie-parser` runs after `csrfProtection` (`server.js:123`–`:127`)

`csrfProtection` reads `req.cookies['csrf-token']` (`csrf.js:42`); on the very first request, before `cookieParser()` has parsed the cookie header, `req.cookies` is `undefined` and the optional-chaining hides it. This works because of the order on subsequent requests, but reading the code in isolation, the chain `req.cookies && req.cookies['csrf-token']` looks defensive; really it's masking a load-order issue. Move `app.use(cookieParser())` above `csrfProtection`.

### 1.23 LOW — Big monolithic route files

`backend/routes/actions.routes.js` is 1,245 lines, `dangerzone.routes.js` 759, `expansion-trader.routes.js` 659, `expansion-quests.routes.js` 626. They're internally consistent but harder to review. Many have a `playerRoute()` helper; most could be table-driven from a config (`{slug, actionType, providerMethod, label, perm}`) and become 50 lines.

---

## 2. DayZ Mod (`Scripts/CommandRelay.c`, `~9 kloc`)

Architecturally solid: long-poll a single URL, dedupe by id (processed.json wiped each run for fresh queue), ack with a simple JSON envelope, command dispatch via a string→enum lookup. The Vector3 helpers and JSON escape are written carefully; the brace-walker JSON parser is the right call given DayZ's lack of a real JSON parser.

Notable concerns:

- **API key in URL** (covered in 1.10).
- **Plaintext logging of full URL with key** (`:1578`).
- **No length cap on response body** (`:1582`–`:1586`) — server-controlled DoS.
- **Default config writes a `REPLACE_ME` api_key on first run** (`:392`). That config is *also* committed in `Scripts/examples/config.json` — fine as an example, surprising as a default that ships.
- **Single mutex on `m_Processed`** is fine for one polling task.
- **All HTTP done over `RestApi`/`RestContext`** — DayZ's RestApi enforces an allowlist via the server's `*.cfg`; this is a strength, but it means operators have to allowlist your endpoint. Document this.
- **Death/connect/disconnect events are fire-and-forget** (`:611`, `:679`, `:996`). If the ack endpoint is briefly unavailable, events are dropped; consider a small ring buffer that retries N times.

---

## 3. Sidecar (`sidecar/`)

- **No-auth-without-key + binds 0.0.0.0** (covered in 1.9).
- **Production HTTP fallback is `warn` only** (`server.js:1376`–`:1380`) — production deployments without TLS certs will silently run cleartext. Refuse to start unless `ALLOW_HTTP_PRODUCTION=1` is set.
- **`fs.watch` + polling** (`command-queue.js:118`–`:148`) — fine pattern. Polling at 100 ms means up to 10 IPC ops/s/server are allocations only — cheap.
- **Stale-file cleanup runs every 60 s** (`server.js:1342`) and uses `mtime > 60_000 ms` — a slow command (~10 s timeout per command-queue) could be killed mid-flight if the cleanup fires; the timeout window is wide enough to be safe in practice but you'd want to verify under heavy load.
- **`refreshPlayers` / `refreshMetrics` / `refreshVehicles` / `refreshWorldEvents` each on their own 5 s `setInterval`** (`server.js:1331`–`:1336`) — four uncoordinated reads of different files. Consider a single tick that reads all four atomically; less context switching, easier to reason about.

---

## 4. Discord Bot (`discord-bot/`)

- **`isAdmin()` is the only authorization** (`utils/permissions.js`). Anyone with the Discord role can run `/rcon`, `/explode`, `/restart`, etc. Per-Discord-user mapping into Citadel roles would let you run "moderator can /kick but not /rcon."
- **`discordUser` / `discordUserId` are passed in the body** (`api.js:139`–`:140`) — covered in 1.6.
- **`isValidSteam64`** at `utils/sanitize.js:23` checks `^7656119\d{10}$` — that's correct for Steam's individual-account format, well done.
- **Cooldown table per user/command** is in-memory only (`utils/cooldowns.js`); cooldowns reset on bot restart. Acceptable but worth noting.
- **`fetchWithRetry`** retries any 5xx once after 2 s (`api.js:113`–`:117`). For idempotent commands that's fine; for `/restart` the server may already be shutting down.

---

## 5. Electron Desktop (`desktop/`)

This is the cleanest component:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `preload` is minimal, `contextBridge` exposes a vetted surface (`preload.js:17`–`:84`).
- `setWindowOpenHandler` deny-lists everything that isn't `BACKEND_URL`/`about:`/`devtools://` and kicks the rest to `shell.openExternal` (`main.js:73`–`:79`).
- `shell:open-external` IPC enforces `^https?://` (`ipc.js:53`).
- Auto-updater pulls from the public GitHub releases — depends on the integrity of HTTPS to GitHub; the Node binary in the installer is verified against `SHASUMS256.txt` (`installer/build.js:206`–`:215`). NSSM is downloaded but **not checksum-verified** (`build.js:39`–`:42`) — supply-chain risk if `nssm.cc` is compromised.

Minor:

- `BACKEND_URL` default is `http://localhost:3001`, which means the desktop won't pick up a TLS-configured backend. For local-only it's fine.
- `mainWindow.webContents.send('backend:unavailable')` after timeout — splash should stay long enough for the user to read; consider extending `BACKEND_TIMEOUT_MS` defaults if NSSM startup is sluggish (60 s today).

---

## 6. Web Frontend (`web/frontend/`, `~33 kloc`)

I read the API client and the page index; I did not read every 3 kloc page (`ExpansionEditorPage`, `TraderEditorPage`). Spot observations:

- Uses `react-router-dom@^7.13.1`, `react@^18.3.1`, `vite@^6.0.7`, `monaco-editor@^0.55.1` — all current.
- `localStorage` for the JWT (covered 1.11).
- `vite-plugin-javascript-obfuscator@^3.1.0` — performance penalty and limited security benefit. Code obfuscation in a JS bundle does not protect anything. Worth removing unless you have a specific anti-tamper requirement.
- `eslint@^9.39.3` is the new flat-config; `backend/.eslintrc.json` uses the old format. Two ESLint configs, two lockfiles (root + frontend), two `node_modules`. Consider hoisting via npm workspaces.
- 18 page files exceed 500 lines. Several are 1k–3.6k. Splitting into `<Page>` + smaller view components would help long-term maintainability and code-split bundle size.
- `monaco-editor` is bundled into `FilesPage.jsx` only, and `FilesPage` is already `lazy()`-loaded at the router level (`web/frontend/src/router.jsx:29`). So Monaco does NOT ship in the main bundle — first-paint is unaffected. (The 2026-05-06 first read incorrectly listed this as "not lazy-loaded"; the deeper "split into tree view + editor pane" win is left as a follow-up, not a defect.)

---

## 7. Installer & PowerShell

- `install.ps1:16` self-elevates via `Start-Process -Verb RunAs` — standard, fine.
- `install.bat:4` runs PS with `-ExecutionPolicy Bypass`. Standard for one-shot installers; document the source so users can audit before double-clicking.
- `installer/build.js`:
  - **Verified:** Node 20.18.1 zip checksum (`:206`–`:215`).
  - **Not verified:** NSSM 2.24 zip — fall through to a second URL on failure but no SHA. Pin NSSM by hash (publish your own mirror or vendor it), or at minimum add a known-good SHA-256 constant.
  - The NSIS installer is **not code-signed** in the script. Unsigned installers raise SmartScreen warnings; for a paid product (the README suggests Citadel is licensed/paid), signing is essential for trust.
  - `RequestExecutionLevel admin` with `oneClick: false`, `perMachine: true` — good defaults.

---

## 8. Cross-cutting

### 8.1 `.gitignore` / tracked files

Already covered (1.19). The `.gitignore` rules that exist are *correct*; the problem is that `git rm --cached` was never run when the rules were added.

### 8.2 No `npm audit` was executed in this audit (no internet/npm in this environment)

I read the dependency manifests but did not resolve transitive CVEs. Run:

```
npm audit --omit=dev --workspaces
cd web/frontend && npm audit
```

and pay attention to `monaco-editor` (large dep tree), `discord.js` minor pins, and anything from `vite`'s transitive deps. The current top-level pins (helmet 8, express 4.18, jsonwebtoken 9, socket.io 4) are recent enough to have current CVE coverage at the time of the most recent push.

### 8.3 Uncaught error handlers (`backend/server.js:421`–`:427`)

```
process.on('unhandledRejection', ...) — log only, do not exit.
process.on('uncaughtException', ...) — log fatal, then process.exit(1).
```

Asymmetric — an unhandled rejection in 2024+ Node defaults *to* a process exit; here it's swallowed. That's defensible for a long-running service but actively masks bugs (the rejection that triggered may have left state inconsistent). Pair these so unhandled rejections are also fatal — let NSSM restart you.

### 8.4 Logging

`pino@^10.3.1` everywhere; the redact list is not configured (`logger.js`). Sensitive headers (`Authorization`) and bodies (passwords on login) could land in logs if a route accidentally `logger.info({ req })`. Recommend adding:

```
const logger = pino({ redact: { paths: ['req.headers.authorization','req.body.password','req.body.apiKey','*.password','*.apiKey'], remove: true } });
```

### 8.5 Tests

`backend/test_api.test.js` exists; the coverage I could see is shallow. The deep paths — auth, dangerzone, mod-install, replicate — are exactly the places that have the issues above. Adding a smoke suite that boots the server with a fixture data dir, hits each route's auth contract, and walks the setup wizard would catch ~1.4 and ~1.5 immediately.

---

## 9. Performance & Reliability Notes

- **`apiLimiter` is a no-op** (1.7) — the single highest-impact perf/avail issue.
- **`getDirSize` is synchronous and recursive** (`backend/lib/helpers.js:86`–`:100`). On a 100 GB DayZ mods folder it blocks the event loop. Used by `dangerzone-preview` and `wipe-presets` on demand, not on a hot path, but a user clicking "preview" while another request is in flight will stall for seconds.
- **`setInterval` cleanups everywhere** — the WS bucket cleanup, login-attempts cleanup, IP ban prune, PID-sample cleanup, polling, FPS sampling, etc. Most are `unref()`'d (good). Some are not (`process-manager.js:58`–`:70`).
- **PowerShell-per-tick metrics** (`backend/lib/process-manager.js:81`) — already collapsed two PS calls into one (good); 4 servers = 4 PS spawns per 15 s. PS startup is ~150 ms — that's 600 ms of wall time for sampling. A long-lived PowerShell host (background script reading from a named pipe) would cut that by ~10×, but it's substantially more code.
- **`fs.watch` reliability** — the sidecar relies on it for response detection (`sidecar/command-queue.js:118`). On Linux, `fs.watch` can drop events under load; the polling fallback at 100 ms covers it but doubles the IO. Increase poll interval to 250–500 ms when watch is active.
- **Atomic-rename writes use a per-write random suffix** (`data-store.js:69`) — avoids tmp-file collisions but creates churn in the data dir that some backup tools will pick up. Consider a stable `*.tmp` per filename and a queue.

---

## 10. Quick Wins (next-PR candidates)

In rough order of effort × impact:

1. Replace `'fallback-csrf-secret'` with a hard fail (1.1).
2. Fix `safePath` separator check (1.2).
3. Replace `dummyHash` with a real bcrypt hash (1.3).
4. Add `'/api/discord/'` to CSRF exempt list (1.4).
5. Lock setup re-arm to "users.json has fewer than 1 root user *and* never had one" — reading e.g. a write-once `data/.first-run-completed` (1.5).
6. Replace `apiLimiter` no-op with a real limiter (1.7).
7. Refuse to start sidecar without `SIDECAR_API_KEY` and bind to `127.0.0.1` (1.9).
8. Move DayZ mod's `api_key` from URL to header (1.10).
9. `git rm --cached` `data/`, `dayz-mod/`, `$null` (1.19).
10. Move JWT into HttpOnly cookie (1.11).

The detailed punch list is in **`PRIORITIZED_FIXES.md`**.

---

## Appendix A — File map (top-level)

| Component | Path | Approx. LOC | Trust boundary |
|---|---|---|---|
| Backend API | `backend/` | 32,841 | HTTPS/HTTP from web + Electron + Discord bot |
| Frontend | `web/frontend/` | 32,910 | Browser, JWT in localStorage |
| DayZ mod | `Scripts/` | 8,936 | DayZ Enforce-Script in-process |
| Sidecar | `sidecar/` | 2,090 | HTTP from backend (per-server), file-IPC to mod |
| Discord bot | `discord-bot/` | 2,673 | Discord WS + HTTPS to backend |
| Desktop | `desktop/src/` | 1,228 | Electron renderer ⇄ main IPC |
| Installer | `installer/`, `install.ps1`, `install.bat` | small | NSIS + NSSM |

## Appendix B — Independent second-pass notes

A spot-check by a second reviewer verified C1–C5 against their cited file:line. Two minor additions surfaced:

- **L31 — SPA fallback shadows non-existent API paths.** `app.get('*', (req,res) => res.sendFile(WEB_DIST/index.html))` at `backend/server.js:300` runs after all routes; any `GET /api/foo-typo` returns `index.html` (HTML, 200) instead of a JSON 404. This breaks API clients (the bot, the desktop wrapper) when they hit a misnamed path — they'll try to JSON-parse HTML and surface a confusing error. Add `app.use('/api', (req,res) => res.status(404).json({error:'Not found'}))` before the catch-all.

- **L32 — `javascript-obfuscator` is installed but not wired in.** `web/frontend/package.json` lists `vite-plugin-javascript-obfuscator` and `javascript-obfuscator`, but `web/frontend/vite.config.js` only loads `@vitejs/plugin-react`. So the bundle is *not* obfuscated despite ~1 MB of devDependencies dragged in. Either remove the deps (recommended) or wire the plugin (and accept the perf cost).

The reviewer's headline claim — that unauthenticated static-file serving is itself critical — is incorrect for an SPA: the HTML/JS shell must load before login. Vite is configured without `sourcemap: true`, so the production bundle does not ship source maps (`web/frontend/vite.config.js`).

## Appendix C — Trust boundaries

```
[Web / Desktop renderer]  ── HTTPS+JWT+CSRF ──▶  [backend Express]
                                                    │
                                                    ├─ child_process: NSSM, PowerShell, SteamCMD, lifecycle hooks
                                                    ├─ fs: data/*.json, server installDir/*
                                                    ├─ socket.io
                                                    └─ HTTPS out: GitHub releases, citadels.cc, xam.nu (proxied)
[Discord]    ── WS ───▶  [discord-bot]   ── HTTPS+API key ──▶  [backend Express, /api/discord/action]
[backend]    ── HTTPS+API key ──▶  [sidecar Express]  ── file IPC ──▶  [DayZ server + mod]
[mod]        ── HTTPS+api_key URL ──▶  [backend Express, /api/citadel-bridge/*]
```
