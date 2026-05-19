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

---

# Addendum — Delta audit 2026-05-19 (v2.18.4)

Companion: `AUDIT_REPORT_2026-05-19.md`. Items below are NEW since the original audit, or carry-overs whose status changed.

## Close-outs from prior list (verified in current code)

- **FIXED:** C1, C2, C3, C4, C5, H6, H7, H8, H9, M11 (with one exception below), M12, M13, M14, M15, M16, M17, M18, L19, L21, L22, L24, L25, L27, L28, L29, L30, L31, L32.
- **STILL PARTIAL:** H10 — mod still sends `api_key` in URL on every GET poll (`Scripts/CommandRelay.c:1586`). The .RPT-log leak is closed; the network-URL leak is not. See §2.1 of the new report. Fix: header or POST-body the key + redact `req.query.api_key` in the backend logger as defense-in-depth.
- **STILL OPEN:** L20 (bcryptjs upgrade), L26 (NSIS code signing).

## N1 — LOW — Stale `latest.yml` tracked in repo root (`xs`) — **DONE 2026-05-19**

- Report: §4.1 (downgraded from CRITICAL after verification)
- Original concern: the repo-root `latest.yml` had empty `sha512:` fields, suggesting the auto-updater was downloading unverified installers.
- Verification result: **not the live feed.** electron-updater uses `provider: 'github'` (`desktop/src/auto-updater.js:47–48`) which fetches the Release asset, not the repo root. The live v2.18.4 release `latest.yml` has the sha512 populated correctly (`OqZhSQslf…`, 88-char base64). The build/upload chain (`installer/build.js:543`, `.github/workflows/release.yml:59`) works.
- Action taken: added `latest.yml` to `.gitignore`, deleted the stale repo-root copy.
- Defense-in-depth (open, deferred): add a workflow assertion before upload — `grep -E '^\s*sha512: \S+' build/latest.yml || exit 1` — so a future regression in build.js fails CI instead of silently publishing an empty manifest.

## N2 — HIGH — `BackupsPage` still reads `localStorage.getItem('token')` (`s`) — **DONE 2026-05-19**

- Report: §3.1
- File: `web/frontend/src/pages/BackupsPage.jsx:109–125`.
- Action taken: rewrote `downloadBackup` to use `fetch(..., { credentials: 'include' })` + `URL.createObjectURL(blob)` + a synthetic `<a download>` click. No localStorage read, no token in URL. Also removed the matching backend `?token=` URL-auth shim in `backend/routes/backup.routes.js:142–148` so the pattern can't silently be reintroduced. Removed a parallel dead shim in `backend/routes/setup.routes.js:128`.
- Open follow-up: add an ESLint rule that fails on `localStorage\.(get|set|remove)Item.*token` anywhere in `web/frontend/src/`.

## N3 — HIGH — H10 carry-over: mod sends `api_key` in URL (`s`) — **STOP-GAP DONE 2026-05-19**

- Report: §2.1
- Files: `Scripts/CommandRelay.c:1586`, ack call sites at `:668, :742, :813, :1075, :8739`; backend route(s) that accept the key.
- **Stop-gap completed:** `backend/lib/logger.js` — added `api_key` (snake_case) to the SENSITIVE_FIELDS list, added `req.query.${field}` to REDACT_PATHS expansion, and added a new `sanitizeUrl()` helper that strips the api_key/token/jwt/password/secret query params from a raw URL string. Wired `sanitizeUrl(req.url)` into the three known `req.url` logger callsites (`backend/server.js:398`, `backend/middleware/csrf.js:154,159,166`). Backend logs no longer leak the mod's URL key.
- **Mod-side remains open** (needs DayZ runtime testing): investigate whether DayZ `RestApi` ctx exposes a generic `SetHeader(name, value)`. If yes, switch to `X-Citadel-Api-Key` header. If no, switch GET polls to POST with `{ server_id, api_key }` in the JSON body. Backend accepts both during a transition window, then drops the query form.
- Verify (mod-side): tcpdump on a poll cycle shows no `api_key=` in the HTTP request line; reverse-proxy `access.log` shows no api_key in `request_uri`.

## N4 — HIGH carry-over — NSIS code signing (`m`)

Already specified as L26. Re-raised because (a) it's the second leg of the auto-updater integrity story (N1 is the first leg), and (b) it remains the highest UX friction point on first install. Cost: ~$200/yr OV cert, more for EV.

## N5 — HIGH carry-over — bcryptjs → bcrypt (`s`)

Already specified as L20. Still open. The JS-pure implementation is slower and less battle-tested than the native `bcrypt` binding; the threat is not "bcryptjs is exploitable" but "we should reduce variance in the crypto path of production logins."

## N6 — MEDIUM [UX] — Standardize error response shape (`m`)

- Report: §5.3
- Files: all `backend/routes/*.routes.js` that emit `res.status(5xx).json({ error: 'Failed' })`.
- Action: define `{ error: 'MACHINE_CODE', message: 'human reason', suggestion: 'next step' }`. Frontend toast renders `message` as primary, `suggestion` as secondary line. Replace every bare `'Failed'`/`'Failed to X'` shape.
- Verify: grep the frontend for `addToast.*error` — each toast displays both lines when present. Pick three known failure paths (disk-full write, permission-denied write, wrong-path SteamCMD) and verify they produce actionable copy.

## N7 — MEDIUM [UX] — Setup wizard error surface (`s`) — **DONE 2026-05-19**

- Report: §5.1
- Files: `web/frontend/src/api.js`, `web/frontend/src/pages/SetupWizardPage.jsx`.
- Action taken (two parts):
  1. **Silent-catch fix**: removed the two silent `catch` blocks that hid `/api/setup/network/detect` and `/api/setup/complete` failures. The complete-setup handler now stays on the current step on error so the user can retry, instead of silently navigating to a "done" screen for a setup that never finished — exactly the v2.18.0–v2.18.3 trap. Auto-detect failure now surfaces a non-fatal error that says "you can still type the IP manually."
  2. **Download diagnostics**: `api.js` now keeps a 50-event ring buffer of recent requests (timestamp, method, sanitized URL, status, duration, error). A "Download diagnostics (for support)" link appears under any error message in the setup wizard; clicking it produces a `citadel-diagnostics-<ts>.txt` blob the user can attach to a support thread. URLs are scrubbed of `api_key`, `token`, `password`, etc. before recording; no request/response bodies are captured.

## N8 — MEDIUM [UX] — Mobile responsiveness for crisis mode (`m`)

- Report: §5.4
- Files: `web/frontend/src/styles/global.css`, `layouts/AppLayout.jsx`, `pages/{ServerControlPage,ConsolePage,PlayersPage}.jsx`.
- Action: breakpoint at 768px — sidebar → hamburger drawer; server-control buttons vertical stack; data tables → card layout; console page tested on iPhone.
- Verify: Chrome devtools mobile emulation at 375x812 — all primary actions (Start/Stop/Restart, kick player, see console output) reachable without horizontal scroll.

## N9 — MEDIUM [UX] — Expansion editor terminology + search (`m`)

- Report: §5.2
- Files: `web/frontend/src/pages/ExpansionEditorPage.jsx`, new `components/ConfigSearch.jsx`.
- Action: each category gets a one-sentence description + wiki deep-link; Ctrl+K modal searches across **field names** in all settings JSON, jumps to the file + highlights the field.
- Verify: typing "raid" finds `RaidSettings` and any `Raid*` field across other files.

## N10 — LOW — `expansion-docs.routes.js` path check should lowercase or use `safePath()` (`xs`) — **DONE 2026-05-19**

- Report: §1.1
- File: `backend/routes/expansion-docs.routes.js`.
- Action taken: route now imports `safePath` from `backend/lib/helpers.js` and uses it instead of an ad-hoc `startsWith()` check. Inherits the case-insensitive handling already battle-tested in the file-browser routes.

## N11 — LOW [UX] — Loadout/file name validation in-line feedback (`xs`) — **DONE 2026-05-19**

- Report: §3.2
- Files: `web/frontend/src/pages/LoadoutsPage.jsx:418–426`, `web/frontend/src/pages/FilesPage.jsx:455–475, 538–565`.
- Action taken (both halves):
  - LoadoutsPage: `trimmedName` + `isValidName` + `showNameError` derived state; red border on invalid; helper text switches to a red explanation when invalid; Create button disabled on invalid; trim before regex and before the PUT URL.
  - FilesPage TemplatePickerModal: same pattern adapted for a path field — checks for `..` traversal segments and absolute-path prefixes (defense-in-depth mirror of backend safePath), red border + red error text for actual invalid paths, keeps the existing orange `<placeholder>` warning for the lighter user-needs-to-fill-in-mission case, disables Create on `!isValidPath`.

## N12 — LOW [UX] — Template-picker `<your-mission>` placeholder (`s`) — **DONE 2026-05-19**

- Report: §3.3
- Files: `backend/routes/servers.routes.js` (new `GET /api/servers/:id/mission-folder`), `web/frontend/src/pages/FilesPage.jsx`.
- Action taken: backend exposes the already-existing `detectMissionFolder` helper via a lightweight per-server endpoint (auth: `server.view`). FilesPage TemplatePickerModal fetches it in parallel with the template list; `defaultTargetPath(templateName, missionFolder)` substitutes the real folder name when available, otherwise keeps the `<your-mission>` placeholder for the orange "fill this in" hint. Admin who doesn't know their mission folder layout gets a working path on first click.

## N13 — LOW [UX] — Discord bot `/help` command (`xs`) — **DONE 2026-05-19**

- Report: §5.7
- Files: `discord-bot/commands/help.js` (new).
- Action taken: new `/help` slash command, auto-registered by the existing loader. Returns a categorized embed reference (Server status, Player actions, Communication, Server control, Setup) — 18 commands grouped, with examples for the non-obvious ones (notably `/rcon` which explicitly calls out that it's raw BattlEye and points users to `/broadcast` / `/kill` for the common cases). DMs the user first so the reference persists in their history; falls back to ephemeral reply if DMs are blocked, with a hint about the privacy setting. No external dependencies; uses the existing EmbedBuilder / SlashCommandBuilder.
- Open follow-up: expand individual commands' `setDescription()` strings as part of a separate pass — the `/help` reference closes the discoverability gap regardless.

## N14 — LOW [UX] — Pre-release flag on v2.18.0–v2.18.2 + setup-broken banner (`xs`) — **DOCS DONE 2026-05-19; PRE-RELEASE FLAG OPEN**

- Report: §5.10
- Files: `RELEASE_NOTES_v2.18.0.md`, `v2.18.1.md`, `v2.18.2.md`; GitHub Releases UI (manual).
- Action taken: added a `> ## ⚠️ DO NOT INSTALL` banner at the top of each broken release's notes pointing to v2.18.4+.
- Open (needs manual action — agent permissions blocked it as an external-state change to existing public releases): `gh release edit v2.18.0 --prerelease`, same for v2.18.1 and v2.18.2. Once flagged Pre-release, they won't surface as "Latest" candidates.
- Note: there was no v2.18.3 release (the version bumped 2 → 4).

## N15 — LOW — Password policy progressive feedback (`xs`) — **DONE 2026-05-19**

- Report: §5.11
- Files: `web/frontend/src/pages/SetupWizardPage.jsx`.
- Action taken: mirrored the backend password rules (`backend/lib/helpers.js:128–143`) in the frontend admin-creation step. Live per-rule checkmarks appear under the password field as the user types: 8+ chars, uppercase, lowercase, number, symbol. Each rule shows a filled green CheckCircle when satisfied, a muted CircleDashed otherwise. The placeholder was corrected from "At least 6 characters" (wrong policy) to "8+ chars, mixed case, number, symbol". Confirm-password field shows an inline "Passwords don't match" message with a red border. Create Account button is disabled until everything passes. No backend change needed since the rules are static; if the policy ever becomes configurable, expose it via a GET endpoint and have the frontend fetch on mount.

## N16 — LOW [QUALITY] — Template fetch dedup across modal re-opens (`xs`) — **DONE 2026-05-19**

- Report: §3.4
- Files: `web/frontend/src/utils/expansionDocsCache.js` (new), `pages/LoadoutsPage.jsx`, `pages/FilesPage.jsx`.
- Action taken: module-level `getTemplates()` cache with 5-minute TTL + in-flight promise sharing + cache invalidation on error. Both pages call the helper instead of `API.get` directly. Re-opening the picker hits memory; navigating away clears it.

## N17 — LOW [UX] — "Mission" vs "Settings" terminology in Expansion editor (`xs`) — **DONE 2026-05-19**

- Report: §5.8
- File: `web/frontend/src/pages/ExpansionEditorPage.jsx:3575–3582`.
- Action taken: renamed sidebar divider from "Mission Folder" → "Mission-folder Settings", added a one-line subtitle: `Live in mpmissions/<mission>/expansion/`. Disambiguates from DayZ's separate "Mission" concept.

## N18 — LOW [UX] — Loadout / Quest in-product glossary (`s`) — **DONE 2026-05-19**

- Report: §5.6
- Files: `web/frontend/src/pages/LoadoutsPage.jsx`, `QuestCreatorPage.jsx`.
- Action taken: every type badge (`KindBadge` in LoadoutsPage; `QuestTypeBadge` + `ObjTypeBadge` in QuestCreatorPage) now carries a native `title=` tooltip with a one-sentence definition and a `cursor: help`. Definitions live next to the existing type tables (`KIND_DEFINITIONS`, `description` on `QUEST_TYPES` / `OBJECTIVE_TYPES`) so adding a new type forces the author to write a definition. Using native tooltips instead of a custom popover keeps the change zero-dependency and works on every page that imports these badges.

---

## Suggested rollout (delta items)

1. **PR A — gitignore stale `latest.yml`** (≤ 10 min) — **DONE 2026-05-19**. N1 downgraded after verification; live updater feed is hash-verified.
2. **PR B — auth tail** (1 day):
   - **DONE 2026-05-19:** N2 (BackupsPage rewrite + dead URL-token shims removed in backup + setup routes), N3 stop-gap (logger redact + sanitizeUrl helper applied at all `req.url` callsites).
   - **OPEN:** N3 mod-side (needs DayZ runtime testing), N5 (bcryptjs → bcrypt — native build chain change).
3. **PR C — installer trust** (depends on cert procurement): N4 (code signing).
4. **PR D — UX-medium cluster** (~3–4 days):
   - **DONE 2026-05-19:** N10 (safePath in expansion-docs), N11 partial (LoadoutsPage in-line validation), N17 (Mission-folder Settings rename + subtitle).
   - **OPEN:** N6 (error shape rollout), N7 (setup error surface), N8 (mobile responsive), N9 (config search + glossary), N11 FilesPage half.
5. **PR E — UX-low polish** (rolling): N12–N16, N18, opportunistic alongside other work.

## What was committed in this audit pass (2026-05-19)

| Item | Severity | Outcome | Files |
|------|----------|---------|-------|
| N1   | LOW (downgraded from CRITICAL) | Stale `latest.yml` deleted + gitignored | `.gitignore`, `latest.yml` (deleted) |
| N2   | HIGH | BackupsPage → fetch+blob; dead URL-token shims removed | `web/frontend/src/pages/BackupsPage.jsx`, `backend/routes/backup.routes.js`, `backend/routes/setup.routes.js` |
| N3   | HIGH | Logger redact + `sanitizeUrl()` helper applied to `req.url` logs (mod-side still open) | `backend/lib/logger.js`, `backend/middleware/csrf.js`, `backend/server.js` |
| N7   | MED [UX] | Setup wizard silent-catch fix + Download-diagnostics link backed by 50-event ring buffer | `web/frontend/src/pages/SetupWizardPage.jsx`, `web/frontend/src/api.js` |
| N10  | LOW  | `safePath()` for expansion-docs path build | `backend/routes/expansion-docs.routes.js` |
| N11  | LOW [UX] | Both halves: LoadoutsPage + FilesPage in-line name/path validation | `web/frontend/src/pages/LoadoutsPage.jsx`, `pages/FilesPage.jsx` |
| N12  | LOW [UX] | Auto-fill mission folder name in FilesPage template picker | `backend/routes/servers.routes.js`, `web/frontend/src/pages/FilesPage.jsx` |
| N13  | LOW [UX] | `/help` Discord slash command (DMs categorized command reference) | `discord-bot/commands/help.js` |
| N14  | LOW [UX] | DO-NOT-INSTALL banner on broken v2.18.0–v2.18.2 release notes | `RELEASE_NOTES_v2.18.0.md`, `v2.18.1.md`, `v2.18.2.md` |
| N15  | LOW [UX] | Progressive password-policy feedback in setup wizard | `web/frontend/src/pages/SetupWizardPage.jsx` |
| N16  | LOW | Shared 5-min TTL cache for `/api/expansion-docs/templates` | `web/frontend/src/utils/expansionDocsCache.js` (new), pages updated |
| N17  | LOW [UX] | "Mission-folder Settings" rename + path subtitle | `web/frontend/src/pages/ExpansionEditorPage.jsx` |
| N18  | LOW [UX] | Loadout/Quest type badges have hover definitions | `pages/LoadoutsPage.jsx`, `pages/QuestCreatorPage.jsx` |

What's left from the audit:
- **High, deferred for runtime testing / external dep:** N3 mod-side (DayZ test), N4 code signing (cert), N5 bcrypt (native build chain).
- **Medium-UX, scoped work:** N6 error shape rollout, N8 mobile responsive, N9 config search + glossary.
- **Recommended manual action:** `gh release edit v2.18.0/1/2 --prerelease` (agent permissions blocked from doing this — it's the user's call to mark public releases pre-release).
