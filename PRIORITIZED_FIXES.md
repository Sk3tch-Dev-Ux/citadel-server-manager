# Citadel — Prioritized Fix List

Companion to `AUDIT_REPORT.md`. Items ranked by severity × effort. Each item links back to the report section, lists the file(s) to touch, and sketches the fix.

Severity legend:
- **C** = Critical — exploit-ready or data-loss risk
- **H** = High — meaningful security or availability impact
- **M** = Medium — defense-in-depth, latent bug, hardening
- **L** = Low — hygiene / nice-to-have

Effort legend (rough):
- **xs** = ≤ 30 min  ·  **s** = 1–2 h  ·  **m** = half-day  ·  **l** = 1–3 days

---

## C1 — CSRF fallback secret (`xs`)
- Report: §1.1
- File: `backend/middleware/csrf.js:20`
- Action: replace `process.env.JWT_SECRET || 'fallback-csrf-secret'` with a load-time check that throws if `JWT_SECRET` is missing. Move the secret read inside the `signNonce`/`verifyCsrfToken` closures so it's late-bound.
- Verify: unit test that `require('./csrf')` after deleting `process.env.JWT_SECRET` throws.

## C2 — `safePath()` traversal in cross-platform branch (`xs`)
- Report: §1.2
- File: `backend/lib/helpers.js:56`
- Action: change to `if (!resolved.startsWith(normalizedBase + '/') && resolved !== normalizedBase) return null;`
- Verify: add a unit test with `safePath('C:/DayZServer', '../DayZServerEvil/x')` returning `null`.

## C3 — Broken constant-time login (`xs`)
- Report: §1.3
- File: `backend/routes/auth.routes.js:55`
- Action: at module load, compute `const DUMMY_HASH = bcrypt.hashSync('citadel-dummy-' + crypto.randomBytes(8).toString('hex'), 10);` and use it in place of the literal.
- Verify: time `POST /api/auth/login` with a known-good username vs a random one — both should run a real bcrypt compare.

## C4 — Discord-bot endpoint blocked by CSRF (`xs`)
- Report: §1.4
- File: `backend/middleware/csrf.js:98`
- Action: add `'/api/discord/'` to `exemptPaths`. Document on the endpoint that it's API-key-authenticated, not session-authenticated.
- Verify: integration test issuing `POST /api/discord/action` with valid Bearer key returns 200.

## C5 — Setup wizard re-arm takeover (`s`)
- Report: §1.5
- Files: `backend/routes/setup.routes.js:27`, `:82`, `backend/lib/setup.js`
- Action:
  1. After admin creation, write a `data/.first-run-completed` (or a `firstRunCompleted: <iso>` field on the root user record) **before** the response is sent.
  2. `getSetupState()` returns `'complete'` if either the file exists OR any non-default user/role/server data exists.
  3. Refuse `requireSetupMode` if `data/.first-run-completed` exists, regardless of `setup_complete.json`.
- Verify: deleting `data/setup_complete.json` while leaving `users.json` populated must not allow `POST /api/setup/admin` to succeed.

## H6 — Discord-bot key has god-mode (`m`)
- Report: §1.6
- Files: `backend/routes/discord.routes.js`, `discord-bot/`
- Action:
  1. Introduce a "discord-bot" Citadel role (id `discord-bot`) with curated permissions.
  2. Authenticate `/api/discord/action` against the API key, **then** evaluate the requested action against the role's permission list.
  3. Stop trusting `discordUser`/`discordUserId` from the body for audit attribution; add a per-call HMAC of `(discordUserId, ts, action)` produced by the bot using the API key.
- Verify: a non-admin Discord user mapped to a "viewer" Citadel role cannot run `restart` via the bot.

## H7 — General API rate limit is a no-op (`s`)
- Report: §1.7
- File: `backend/middleware/rate-limit.js:11`
- Action: replace `apiLimiter` with `express-rate-limit({ windowMs: 60_000, max: 600, standardHeaders: true })` keyed by `req.ip`. Exempt `/api/maps/tiles/*` (browser-cached) and websocket upgrade.
- Verify: load-test 1000 concurrent GET `/api/health` returns 429 after threshold.

## H8 — Files whitelist allows scripts that lifecycle-hooks auto-runs (`m`)
- Report: §1.8
- Files: `backend/routes/files.routes.js:17`, `backend/lib/lifecycle-hooks.js:33`
- Action:
  - Remove `.bat`/`.cmd`/`.ps1`/`.sh` from `SAFE_WRITE_EXTENSIONS`.
  - Introduce `files.edit-scripts` permission and gate writes to `lifecycle_hooks/` with it; reject other locations for those extensions even with the new perm.
  - Audit log: include classification (`config`, `script`, etc.).
- Verify: a `moderator` role with `files.edit` cannot write `.ps1` anywhere; an `admin` can write only inside `lifecycle_hooks/`.

## H9 — Sidecar binds 0.0.0.0 with no key (`s`)
- Report: §1.9
- Files: `sidecar/server.js:1382`, `sidecar/auth.js:12`, `sidecar/config.js:13`
- Action:
  - In `auth.js`, throw on startup if `process.env.NODE_ENV === 'production' && !apiKey`.
  - In `server.js`, bind `'127.0.0.1'` when no key is set: `app.listen(config.port, '127.0.0.1', ...)`.
  - In `backend/lib/sidecar-manager.js`, always populate `srv.inHouseApiKey` with `crypto.randomBytes(32).toString('hex')` when the server is created if missing; persist to `servers.json`.
  - Pad both buffers in `auth.js` to a fixed length before `crypto.timingSafeEqual` to remove the length leak.
- Verify: `nc 127.0.0.1 9100` works; `nc <lan-ip> 9100` is refused when no key set.

## H10 — Mod sends api_key in URL (`s`)
- Report: §1.10
- Files: `Scripts/CommandRelay.c:1575`, all `?api_key=` builders, plus the matching backend route.
- Action: build a header in the EnScript layer (`ctx.SetHeader("Authorization", "Bearer " + m_Config.api_key)` or `X-API-Key`); strip the query-string assembly. Update the backend to accept either form during a transition window, then drop the query-string acceptance.
- Verify: tail the mod's RPT during a poll — no `api_key=` should appear.

## M11 — JWT in `localStorage` (`m`)
- Report: §1.11
- Files: `web/frontend/src/api.js`, `backend/routes/auth.routes.js`, `backend/middleware/auth.js`
- Action: on login, set `Set-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/`. Have `auth()` middleware read from `req.cookies.token` first, falling back to the `Authorization` header for the bot/desktop. Remove `localStorage.setItem('token', ...)` from the frontend; rely on the cookie + the existing CSRF nonce.
- Verify: open DevTools → Application → Local Storage; `token` should not exist after login.

## M12 — Username-only lockout DoS (`s`)
- Report: §1.12
- File: `backend/routes/auth.routes.js:71`
- Action: change the lockout key from `username` to `${ip}:${username}`. Adjust `MAX_ATTEMPTS` to 5 per (ip, username) and 25 per ip globally (already covered by fail2ban).
- Verify: failing logins from IP A do not lock the same username when IP B logs in successfully.

## M13 — Role-id literal compares (`xs`)
- Report: §1.13
- File: `backend/routes/users.routes.js:46`, `:69`
- Action: replace `req.user.role !== 'admin'` with a permission check (`!hasPermission(req.user, 'users.manage-others')`).
- Verify: a custom role with `*` permission can edit other users.

## M14 — Wipe/replicate confirmName race (`xs`)
- Report: §1.14
- File: `backend/routes/dangerzone.routes.js:235`–`:316`
- Action: snapshot `srv.name` at the start of the handler and use the snapshot for both `confirmName` comparison and the in-progress message.

## M15 — PowerShell `-Command` strings (`s`)
- Report: §1.15
- File: `backend/lib/steamcmd.js:32`
- Action: replace `Expand-Archive` with Node's `unzipper` (or `tar -xf` on Windows 11+). Document a lint rule: do not pass user-controlled paths into a PowerShell `-Command` string.

## M16 — Symlink swap on atomic rename (`s`)
- Report: §1.16
- File: `backend/lib/data-store.js:69`
- Action: before rename, `lstat(filePath)`; if it's a symlink, throw and log.

## M17 — Sensitive-file permissions (`xs`)
- Report: §1.17
- File: `backend/lib/config.js:102` (jwt-secret), `backend/lib/data-store.js:72` (json writes)
- Action: pass `{ mode: 0o600 }` to `writeFileSync` for `users.json`, `webhooks.json`, `audit.json`, `.jwt-secret`.

## M18 — Mod ingest size cap (`xs`)
- Report: §1.18
- File: `Scripts/CommandRelay.c:1582`
- Action: at the top of `ProcessCommands`, `if (data.Length() > 256_000) return;` and cap `cmdArray` parsing to N commands per tick.

## L19 — Tracked junk and ignored-but-tracked dirs (`xs`)
- Report: §1.19
- Action:
  ```
  git rm --cached -r data/ dayz-mod/ Scripts/examples/processed.json
  git rm '$null'
  rm -rf 'C:\DayZServer'
  git commit -m "chore: remove tracked files that .gitignore should have excluded"
  ```
- Add a CI check (one-liner in `.github/workflows`):
  ```
  test -z "$(git ls-files | grep -E '^(data|dayz-mod)/')"
  ```

## L20 — Outdated bcryptjs (`s`)
- Report: §1.20
- File: `backend/package.json`
- Action: replace `bcryptjs ^2.4.3` with `bcrypt ^5.1.1` (or `@node-rs/bcrypt`). Compatible API: `import bcrypt from 'bcrypt'; await bcrypt.hash(...); await bcrypt.compare(...)`. Note: `bcrypt` requires native build; pin a Windows binary in the installer.

## L21 — uuid version drift (`xs`)
- Report: §1.21
- File: `sidecar/package.json`
- Action: align `uuid` to `^9.0.1` across backend + sidecar (or vice versa).

## L22 — `cookie-parser` after `csrfProtection` (`xs`)
- Report: §1.22
- File: `backend/server.js:123`
- Action: move `app.use(cookieParser())` above `app.use(csrfProtection)`.

## L23 — Big route files (`l` — refactor)
- Report: §1.23
- Files: `backend/routes/actions.routes.js`, `dangerzone.routes.js`, `expansion-trader.routes.js`, `expansion-quests.routes.js`
- Action: extract a `definePlayerActions(app, [{slug, actionType, providerMethod, label, perm}])` table; reduce `actions.routes.js` to ~100 lines.

## L24 — Logger redaction (`xs`)
- Report: §8.4
- File: `backend/lib/logger.js`
- Action: configure `pino({ redact: { paths: ['req.headers.authorization','req.body.password','req.body.apiKey','*.password','*.apiKey','*.token'], remove: true }})`.

## L25 — Unhandled-rejection asymmetry (`xs`)
- Report: §8.3
- File: `backend/server.js:421`
- Action: make unhandled rejections fatal, just like uncaught exceptions. Let NSSM's autorestart handle it.

## L26 — NSIS code signing (`m`)
- Report: §7
- File: `installer/build.js`, `installer/citadel.nsi`
- Action: integrate signtool with a code-signing cert. Use `electron-builder`'s win.signtoolOptions or call signtool directly post-NSIS-build.

## L27 — NSSM checksum (`xs`)
- Report: §7
- File: `installer/build.js:39`
- Action: add `NSSM_SHA256` constant, verify after download (similar to `verifyNodeChecksum`).

## L28 — Vite `javascript-obfuscator` plugin (`xs`)
- Report: §6
- File: `web/frontend/package.json`, `web/frontend/vite.config.js`
- Action: remove `vite-plugin-javascript-obfuscator` and `javascript-obfuscator`. Recovers build time and bundle clarity.

## L29 — Lazy-load Monaco (re-evaluated; mostly already done)
- Report: §6
- Status: **partial close-out 2026-05-07.** `web/frontend/src/router.jsx:29`
  already wraps `FilesPage` in `lazy(() => import(...))`, and Monaco is
  imported only inside `pages/FilesPage.jsx`. So Monaco does NOT ship in
  the main bundle — it's fetched on demand when a user navigates to the
  Files page. The audit overstated the problem.
- Remaining win (deferred): split `FilesPage.jsx` into a tree-view
  component + an editor-pane component, so the ~5MB Monaco bundle is only
  loaded when the user actually opens a file. Right now navigating to
  /files (just to browse) pulls Monaco. Worth a dedicated PR if cold-load
  on /files becomes a customer complaint; not blocking otherwise.

## L30 — Smoke-test suite for auth & wizard (`m`)
- Report: §8.5
- File: `backend/test_api.test.js`
- Action: add tests:
  - `POST /api/auth/login` with right/wrong creds, MFA on/off.
  - `POST /api/setup/admin` is rejected when setup is complete.
  - `POST /api/files/write` with `.ps1` extension by a non-admin role is 403.
  - `POST /api/discord/action` with valid+invalid keys.

---

## L31 — SPA fallback returns HTML for non-existent API paths (`xs`)
- Report: Appendix B
- File: `backend/server.js:300`
- Action: insert before the `app.get('*', ...)` line:
  ```
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
  ```

## L32 — `javascript-obfuscator` installed but unused (`xs`)
- Report: Appendix B
- File: `web/frontend/package.json`
- Action: `npm uninstall javascript-obfuscator vite-plugin-javascript-obfuscator` (recommended). Or, if obfuscation is truly desired, wire the plugin into `web/frontend/vite.config.js`.

---

## Suggested rollout

1. **PR 1 — security hotfixes** (1 day): C1, C2, C3, C4, L19, L22, L25, M14, M17 — small, mechanical changes, low blast radius.
2. **PR 2 — auth/setup hardening** (2–3 days): C5, H6, H7, H9, M11, M12, M13.
3. **PR 3 — file/IPC hardening** (2 days): H8, H10, M15, M16, M18.
4. **PR 4 — supply chain & hygiene** (2 days): L20, L21, L24, L26, L27, L28.
5. **PR 5 — refactor** (later): L23, L29, L30.

PR 1 alone takes the most exposed defects off the board; PR 2 closes the worst privilege boundaries.
