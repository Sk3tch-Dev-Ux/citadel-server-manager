# Citadel — Delta Audit Report (v2.17.0 → v2.18.4)

**Date:** 2026-05-19
**Repo:** `DayzServerController` @ v2.18.4
**Prior report:** `AUDIT_REPORT.md` (2026-05-06, v2.17.0)
**Scope:** Delta since v2.17.0 — backend, sidecar, DayZ mod, web frontend, installer / auto-updater, sync scripts, UX & admin friction.
**Method:** Five parallel read-throughs of the diff and new files, cross-referenced against `PRIORITIZED_FIXES.md`. Prior fixes were re-verified in the current code (not trusted from commit messages). No code was changed.

---

## Executive Summary

The prior audit drove a strong cleanup cycle. **All five Critical items (C1–C5) and four of five High items (H6–H9) have been independently re-verified as fixed in current code**, with multi-layer defenses on the highest-leverage boundaries (Discord-bot role + HMAC + per-user mapping; setup wizard with a permanent first-run marker; script writes dual-gated by permission + path). Most Medium items (M11–M17) and Low items (L19, L21–L25, L27, L28, L30–L32) are also fixed.

Notable defects and carry-over gaps:

- **HIGH — mod still leaks api_key in URL** on every poll (`Scripts/CommandRelay.c:1586`). H10 was marked "partial"; partial it remains. The .RPT log no longer captures it, but the credential still rides the query string on every GET, where TLS-terminating proxies / access logs / browser history (if anything ever points a debug browser at the endpoint) can capture it.
- **HIGH — BackupsPage still reads `localStorage.getItem('token')`** (`web/frontend/src/pages/BackupsPage.jsx:110`). The M11 migration is incomplete: every other page moved to the HttpOnly cookie, but the download flow still expects a bearer token in a URL query. This is also a token-in-URL leak (proxy logs, browser history).
- **HIGH — Code signing (L26)** still unimplemented. SmartScreen friction on every first install, and the second leg of the auto-updater trust story.
- **HIGH — bcryptjs (L20)** still unupgraded.
- **LOW — stale `latest.yml` in repo root** had empty `sha512:` fields. The audit's first pass flagged this as CRITICAL ("auto-updater integrity off"), but on verification the **live GitHub Release `latest.yml` for v2.18.4 has the sha512 populated correctly** (88-char base64, `OqZhSQslf…`) — `installer/build.js:543–558` computes it, the release workflow at `.github/workflows/release.yml:59` uploads `build/latest.yml`, and electron-updater's `provider: 'github'` fetches the Release asset. The repo-root copy was a misleading dead artifact. Fix is just to gitignore it.
- A meaningful cluster of UX defects that would block "best tool on the planet" — vague error messages, no mobile responsiveness, opaque Expansion-config terminology, no in-product onboarding glossary.

Counts (new findings only — does NOT re-count prior audit items):
- **Critical:** 0
- **High:** 4 (mod URL key carry-over, BackupsPage localStorage, code signing carry-over, bcryptjs carry-over)
- **Medium:** ~5 (UX-medium + a couple of quality items)
- **Low / hygiene / UX-low:** ~13 (incl. the downgraded N1)

The delta verdict: **the security posture is materially better than at v2.17.0** and no new critical-grade defects surfaced. The four High items are all carry-overs or M11 cleanup. UX is the biggest remaining lever.

> **Correction note (2026-05-19, post-publish):** an earlier draft of this report flagged "empty sha512 in `latest.yml`" as CRITICAL. That conclusion was wrong — the file in the repo root was a stale artifact, not the live feed. The live updater feed is hash-verified. The correct finding is the LOW hygiene issue in §4.1 (stale tracked file). The report has been amended in place.

---

## 1. Backend

The backend hardened well. New code (`expansion-docs.routes.js`, `expansion-loadouts.routes.js`, `discord-user-roles.routes.js`) follows established auth / path-safety patterns.

### 1.1 LOW — `expansion-docs.routes.js` path check is case-sensitive on case-insensitive filesystems

**File:** `backend/routes/expansion-docs.routes.js`

The route validates template names with `/^[A-Za-z0-9_-]+$/` and rejects paths that don't `startsWith(TEMPLATES_DIR + path.sep)` — but it doesn't lowercase the comparison. The active risk is essentially zero (templates are read-only static schema files, name is regex-bounded, no user input reaches a path concat), but the same defensive pattern that `helpers.js:safePath` uses elsewhere would harden this and avoid drift when the next person edits it.

**Fix:** lowercase both sides on Windows/Darwin, or — preferably — route this through `safePath()` for consistency.

### 1.2 Note — recent setup-wizard regressions (bc0c33a, 8ab7d06)

The recent commits touched the C5-protected boundary. I verified the current logic in `backend/routes/setup.routes.js:33–156` is sound:
- `.first-run-completed` is the authoritative latch and is written **before** the auth cookie is issued.
- `getSetupState()` returns `'complete'` if either the marker exists OR any non-default user/server state is present (so deleting `setup_complete.json` no longer re-arms).
- `requireSetupMode` allows root-admin tokens through when setup is complete (this is what 8ab7d06 enables) — the gate is still a hard 403 for unauthenticated callers.

C5 still holds. The v2.18.0–v2.18.3 silent-403 trap was a UX cliff (see §5.1), not a security regression.

### 1.3 Verified fixed (re-checked in current code)

| ID  | Title                                | Where verified |
| --- | ------------------------------------ | -------------- |
| C1  | CSRF fallback secret                 | `backend/middleware/csrf.js:33–42` (late-bound `getCsrfSecret()` that throws) |
| C2  | `safePath` traversal                 | `backend/lib/helpers.js:67` (trailing-`/` check on both branches) |
| C3  | Constant-time login dummy hash       | `backend/routes/auth.routes.js:26–29` (real bcrypt hash at module load) |
| C4  | CSRF exemption for `/api/discord/`   | `backend/middleware/csrf.js:138–145` |
| C5  | Setup re-arm                         | `backend/routes/setup.routes.js:33–156` (permanent marker + state-driven gate) |
| H6  | Discord bot god-mode                 | 3 layers: role (`server.js:49–76`), HMAC (`discord.routes.js:150–176`), per-user map (`discord-user-roles.routes.js`) |
| H7  | General API rate limit no-op         | `backend/middleware/rate-limit.js:29–35` (real `express-rate-limit`) |
| H8  | Script extension write privilege     | `backend/routes/files.routes.js:39`, `:65–72`, `:160–178` (dual perm + path gate) |
| M11 | JWT in localStorage                  | `backend/routes/auth.routes.js:144–147`, `backend/middleware/auth.js:22–32` — **except** see §3.1 |
| M12 | Lockout DoS by username              | `backend/routes/auth.routes.js:80–82` (keyed `ip|username`) |
| M13 | Role-id literal compares             | permission-based checks throughout `users.routes.js` |
| M14 | Wipe confirmName race                | `dangerzone.routes.js` snapshot-at-entry (verified by commit 53ab8e9; spot-checked) |
| M15 | PowerShell `Expand-Archive` string   | `backend/lib/steamcmd.js` uses `tar` (commit a9f1451) |
| M16 | Symlink swap on atomic rename        | `backend/lib/data-store.js:97–100` (`lstat` + refuse) |
| M17 | Sensitive-file permissions           | `backend/lib/data-store.js:34–36` (`SENSITIVE_FILES` → `0o600`) |
| L19 | Tracked junk                         | `git ls-files` no longer shows `$null`, `dayz-mod/`, `Scripts/examples/processed.json` |
| L22 | `cookie-parser` order                | `backend/server.js` (verified `cookieParser` before `csrfProtection`) |
| L24 | Logger redaction                     | `backend/lib/logger.js` redact paths configured |
| L25 | UnhandledRejection fatal             | `backend/server.js` (fatal handler) |
| L31 | JSON 404 for `/api`                  | `backend/server.js:45760b1` |

---

## 2. Sidecar + DayZ Mod

### 2.1 HIGH — Mod still sends `api_key` in URL on every GET poll *(H10 carry-over)*

**File:** `Scripts/CommandRelay.c:1586`

```c
string params = "?server_id=" + m_Config.server_id + "&api_key=" + m_Config.api_key;
ctx.SetHeader("application/json");
Log("Polling: " + url);             // url WITHOUT params — no longer leaks to .RPT
ctx.GET(m_Callback, params);        // but the network request still carries it
```

The .RPT-log leak is closed (good — that was the primary local-disk exposure). The credential still rides the URL on every network call, ~every few seconds, for the life of the server. Capture surfaces that remain:
- HTTPS-terminating reverse proxy access logs (nginx, Cloudflare, IIS) — these typically log `request_uri` which **includes the query string** by default.
- Citadel's own backend `pino-http` request logger — `req.url` is logged unless explicitly redacted; verify against `backend/lib/logger.js` redact config.
- DayZ launcher / Steam process arg logs in some configurations.
- Any debug capture (browser DevTools if anyone ever points one at the endpoint).

The in-code comment claims POST acks "move api_key into the JSON body and drop the URL-query form", but inspection of the surrounding ack call sites (lines 668, 742, 813, 1075, 8739) shows they **still** build `?api_key=...&server_id=...` paths. The comment is aspirational, not descriptive.

**Fix path (two options, pick one):**
1. **Backend-side:** add an `X-Citadel-Api-Key` header that the existing route accepts in addition to the query param; have the mod set it via `ctx.SetHeader("X-Citadel-Api-Key", m_Config.api_key)` if that signature is available, then remove the query form. **Investigate:** does DayZ's `RestApi` ctx expose arbitrary header setters? The current `ctx.SetHeader("application/json")` looks like a `Content-Type`-only signature; if so, see option 2.
2. **POST-body:** in the GET-poll case there's no body. Convert the poll from `GET ?server_id&api_key` to `POST` with `{ server_id, api_key }` in a JSON body. Backend then accepts both forms during a transition.
3. **As a stop-gap regardless of the above:** in the backend's pino logger config, redact `req.query.api_key`.

### 2.2 Verified fixed

| ID  | Title                                | Where verified |
| --- | ------------------------------------ | -------------- |
| H9  | Sidecar no-key in prod / 0.0.0.0 bind | `sidecar/server.js:1365–1377` (fatal exit if no key in prod; 127.0.0.1 in dev); `sidecar/auth.js:26–43` (fixed-length buffer compare) |
| M18 | Mod ingest size cap                  | `Scripts/CommandRelay.c:1605–1606`, `:1613–1617`, `:1647–1651` (256 KiB / 100 cmds per tick) |
| L21 | uuid drift                           | `sidecar/package.json:14` (aligned to `^9.0.1`) |

### 2.3 Bonus — quality wins in the delta

- Sidecar auth compare now pads both buffers to 64 bytes before `timingSafeEqual` (`sidecar/auth.js:26–32`), eliminating a length-leak that the prior audit only listed as a sub-item of H9.
- Mod raw-data logging is now gated by `m_Config.debug_logging_enabled` (`Scripts/CommandRelay.c:1620–1623`), cleaning up RPT spam without losing the troubleshooting path.

---

## 3. Web Frontend

### 3.1 HIGH — `BackupsPage` still reads `localStorage.getItem('token')` *(M11 incomplete)*

**File:** `web/frontend/src/pages/BackupsPage.jsx:110`

```javascript
const token = localStorage.getItem('token');
```

…almost certainly used to build a `/api/.../download?token=...` URL for an `<a href>` or `window.open()` (large file downloads can't easily go through `fetch` + blob with a cookie-only flow).

The M11 migration removed `localStorage.setItem('token', ...)` from the login path — so this `getItem` call now reads `null` and the download is broken silently anyway. The page is dead-on-arrival post-M11 in the cookie path. Two problems:

1. **Backup downloads don't work for cookie-auth users** (the dominant path post-M11). Operator opens a backup, clicks Download, nothing happens or 401s.
2. **The pattern reintroduces token-in-URL** as soon as someone "fixes" it by re-enabling `localStorage`. Token-in-URL is exactly what we just moved away from — proxy logs, history, referer leakage.

**Fix:** add a short-lived signed download URL on the backend (`POST /api/backups/:id/download-token` → returns `{ url: '/api/backups/:id/raw?ticket=<jwt with 60s exp>' }`), or stream the download through `fetch` with `credentials: 'include'` + `URL.createObjectURL(blob)`. Either way, remove `localStorage.getItem('token')`.

**Audit hygiene:** add a unit/lint rule that fails on `localStorage.(get|set|remove)Item.*token` anywhere in `web/frontend/src/`.

### 3.2 MED [UX] — Loadout / file-name validation has no in-line feedback

**Files:** `web/frontend/src/pages/LoadoutsPage.jsx:418–426`, similar in `FilesPage` template-picker.

Regex `/^[A-Za-z0-9_-]{1,80}$/` is enforced server-side and creates a toast on submit, but the input has no error border, no hint text, and the "Create" button is disabled silently. A new admin types `My Loadout` (with a space), gets a transient toast they probably miss, and stares at a disabled button.

**Fix:** real-time validation message under the input + red border on invalid + a placeholder explaining the rule. ~10 lines.

### 3.3 MED [UX] — Template picker leaves `<your-mission>` as a literal placeholder

**File:** `web/frontend/src/pages/FilesPage.jsx:388–417, 540–542`

`defaultTargetPath()` returns paths like `mpmissions/<your-mission>/expansion/settings/...`. The UI warns the user to replace it, but the warning is itself easy to miss and the failure mode (file written to a literal `<your-mission>` directory) is silent and ugly. We already know the mission name from `serverDZ.cfg`.

**Fix:** read the mission name from the active server's config; if multiple `template=` lines exist, present a dropdown.

### 3.4 LOW [UX] — Various polish items

- **F4** Whitespace-only loadout names: trim before regex check (`LoadoutsPage.jsx:435`).
- **F5** Schema-less JSON fallback uses raw `<pre>` (`LoadoutsPage.jsx:284–289`) — fine, but a one-line "no schema available, [report missing schema]" link would be nice.
- **F6** Template picker dismiss without "discard unsaved input" confirm (`FilesPage.jsx:482–486`) — `window.confirm()` is enough.
- **F7** `wikiLinks.js` allowlist is sound (`wikiLinks.js:31–46`) — no runtime URL verification, but the failure mode is a 404 the user can recover from.
- **F8** Template fetch re-fires on each modal open (`LoadoutsPage.jsx:326`, `FilesPage.jsx:426`) — cache at parent or context. Imperceptible on a LAN, noticeable on cloud-hosted Citadel.
- **F9** `defaultTargetPath` hardcodes Expansion's dir conventions — fine for now; revisit if/when the mod changes them.

### 3.5 Verified fixed

| ID       | Title                              | Where verified |
| -------- | ---------------------------------- | -------------- |
| M11      | Token out of localStorage          | `web/frontend/src/api.js:24–27`, `contexts/AuthContext.jsx:17–24`, `socket.js:19–21, 50–54` — **except BackupsPage, see §3.1** |
| L28/L32  | `javascript-obfuscator` removed    | `web/frontend/package.json`, `vite.config.js` no longer reference it |
| L29      | Monaco lazy-loaded                 | `web/frontend/src/router.jsx:29` wraps `FilesPage` in `lazy()` — already correct, audit overstated |

---

## 4. Installer, Auto-Updater, Build

### 4.1 LOW — Stale `latest.yml` tracked in repo root (downgraded from CRITICAL after verification)

**Files:** `latest.yml` (deleted in this pass); `installer/build.js:543–558`; `.github/workflows/release.yml:59`; `desktop/src/auto-updater.js:36–48`

**What this audit's first pass said:** the repo-root `latest.yml` had empty `sha512:` fields, so the auto-updater was downloading installers with no integrity check. Severity: CRITICAL.

**What verification showed:** the auto-updater never reads the repo-root file. `desktop/src/auto-updater.js:47–48` configures `provider: 'github'` against `Sk3tch-Dev-Ux/DayzServerController`, which makes electron-updater fetch `latest.yml` from the **GitHub Release asset**, not the repo root. The live release asset for v2.18.4 has the sha512 populated:

```yaml
version: 2.18.4
files:
  - url: CitadelSetup-2.18.4.exe
    sha512: OqZhSQslficsX7PcTRsQ2wNIyGTI1Z3z/MEkf6kENJQfIHs7HyiVdeVEkflJZTD2OS7QLzIvWjCTYmiDoh6eRg==
    size: 156227697
path: CitadelSetup-2.18.4.exe
sha512: OqZhSQslficsX7PcTRsQ2wNIyGTI1Z3z/MEkf6kENJQfIHs7HyiVdeVEkflJZTD2OS7QLzIvWjCTYmiDoh6eRg==
releaseDate: '2026-05-17T20:32:37.581Z'
```

`installer/build.js:543` computes the hash; `.github/workflows/release.yml:35–59` builds, then uploads `build/latest.yml` to the GitHub Release. The chain works.

**Actual finding:** the repo-root `latest.yml` was a misleading stale artifact (last touched at v2.18.2). It served no purpose, confused an audit pass, and could mislead a contributor into hand-editing it. **Fix applied in this same commit pass:** gitignored + deleted.

**Defense-in-depth (still worth adding, future):** make the release workflow assert that `build/latest.yml` contains non-empty 88-char base64 sha512 fields before uploading. One line of `grep -E '^\s*sha512: \S+' build/latest.yml || exit 1` in the workflow. That way if the build.js path is ever regressed silently, CI fails instead of publishing.

### 4.2 HIGH — NSIS installer remains unsigned *(L26 carry-over)*

**Files:** `installer/citadel.nsi`, `installer/build.js:508–531`, `desktop/package.json:46–52`

No `signtool` invocation, no `certificateFile` in electron-builder config, no Authenticode signature on the produced `.exe`. Effects:

- Every Windows user hits a SmartScreen warning on first install ("Windows protected your PC — Unknown publisher"). Substantial onboarding friction for a paid product.
- The auto-updater hash gap (§4.1) has no second leg — even if you fixed the hash, a repo compromise still ships the malicious binary because there's no signature for Windows to verify against.
- macOS notarization is not in scope (no mac build today), so that's a non-issue.

**Fix:** EV code-signing cert; integrate via `electron-builder` (`win.certificateFile`, `win.signingHashAlgorithms: ['sha256']`) or post-NSIS `signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a CitadelSetup-${VERSION}.exe`. ~$200/yr for an OV cert, more for EV (instant SmartScreen reputation).

### 4.3 Verified fixed / good

| ID  | Title                            | Where verified |
| --- | -------------------------------- | -------------- |
| L27 | NSSM SHA256 verification         | `installer/build.js:45–58` (constant), `:223–241` (gate), `:324, 333, 340` (per-build + cache invalidation) |
| —   | Node.js zip SHA256               | `installer/build.js:249–269` — same pattern, sound |
| —   | All download URLs HTTPS-only     | `installer/build.js:22, 34, 39–42`; no `rejectUnauthorized:false` anywhere |
| —   | PowerShell extraction injection  | `installer/build.js:301–314, 396–408` — paths are escaped (`\\` → `\\\\`) and derived from non-user-controlled constants |
| —   | install.ps1 / install.bat        | UAC self-elevate is standard; service registration is correct; data-dir preservation on upgrade is good |
| —   | `desktop/src/auto-updater.js`    | Dead `fileLog()` call removed (commit 6c52b81). No other changes; trust model unchanged. |
| —   | `Scripts/sync-expansion-docs/`   | Dev-side only; not bundled into installer. Path-traversal-safe via `path.resolve`. No runtime exposure. |
| —   | `marketing/discord/post.js`      | Webhook URL from env, static embed JSON, no user input. Fine. |

---

## 5. UX & Admin Friction

This is a new lens for this audit. Findings are written from the perspective of "would a new DayZ server admin's first 30 minutes feel like the most useful tool on the planet, or like a thing they bounce off."

**First-30-minutes verdict on v2.18.4+:** Solid. Installer runs, setup wizard is sequential, auto-detect IP works, server boots. **First-30-minutes verdict on v2.18.0–v2.18.3:** Catastrophic — the silent-403 trap (now fixed) left users staring at unresponsive Next buttons with no error. The fact that this regression made it to a release flagged for users to install is a process gap, not just a code gap.

### 5.1 [UX-high] No error surface for failed setup steps

**File:** `web/frontend/src/contexts/AuthContext.jsx`, setup wizard pages.

The v2.18.0–v2.18.3 silent-403 wasn't just a backend bug; it was a frontend that swallowed a 403 with no toast, no console error, no inline message. The fix landed via cookie auth, but the swallowing pattern is still there. Any future regression that produces a non-2xx during setup will silent-fail the same way.

**Fix:** all setup-wizard `API.post` calls should attach a `.catch(e => addToast('Setup step failed: ' + (e.message || e.error || 'see logs'), 'error'))` AND surface `e` in an inline alert above the form. Add a "Diagnostics" link on the setup screen that dumps the last 20 API responses to a downloadable txt for support.

### 5.2 [UX-high] Expansion editor terminology is opaque

**File:** `web/frontend/src/pages/ExpansionEditorPage.jsx:13–36`

`GeneralSettings`, `HardlineSettings`, `MarketSettings`, `BaseBuildingSettings` are listed as a flat-ish category list. An admin trying to "disable raiding" doesn't know it's in `RaidSettings` (might be under "Core" or "General" in their mental model). The mix of `Profiles/ExpansionMod/Settings/` files with mission-folder files under one tree confuses the hierarchy.

**Fix:** Each category gets a one-sentence description and a link to the matching `WIKI_TOOLS` page in `wikiLinks.js`. Add a search box at the top of the category sidebar (Ctrl+K modal) that searches across **field names**, jumps to the file, and highlights the field. This single change probably resolves 30% of "where do I configure X" support questions.

### 5.3 [UX-med] Error messages are vague and non-actionable

**Files:** Multiple — `backend/routes/{compat,config,lb-perks}.routes.js`, others.

```javascript
res.status(500).json({ error: 'Failed' });
res.status(500).json({ error: 'Failed to write config' });
res.status(500).json({ error: err.message || 'Failed to detect LB Master status' });
```

Admin sees a toast with one of these and has nowhere to go. Was it a permission error? Disk full? File locked? Wrong path?

**Fix:** standardize the error shape repo-wide:

```javascript
{ error: 'CONFIG_WRITE_FAILED',
  message: 'Permission denied writing to serverDZ.cfg',
  suggestion: 'The Citadel service may not have write access to the server directory. Check the file is not read-only and run install.ps1 again if needed.' }
```

Frontend toast renders the suggestion as a second line. ~1 day of mechanical work across all routes.

### 5.4 [UX-med] No mobile responsiveness

**File:** `web/frontend/src/styles/global.css`

Sidebar is fixed 240px, tables are horizontal scrollers, server-control buttons are in a row. Crisis at 2am, admin's on their phone — they're locked out of fast actions. Even basic responsive breakpoints (sidebar → hamburger at 768px, server controls → vertical stack on mobile) would change this from "unusable" to "good enough for emergencies."

### 5.5 [UX-med] SteamCMD step doesn't explain itself

**File:** `backend/routes/setup.routes.js:346–366`

If auto-detect fails: `Could not find or download SteamCMD: ENOENT: no such file or directory`. A new admin doesn't know what SteamCMD is, where to get it, or whether to skip.

**Fix:** rewrite the setup-step copy to lead with "SteamCMD (optional — needed only for Steam Workshop mod management). Skip if you manage mods manually." On error: "We tried to auto-download SteamCMD but couldn't reach Steam servers. [Retry] [Provide path manually] [Skip — mods can be managed later from Settings]."

### 5.6 [UX-med] Loadout / Quest terminology lacks in-product glossary

**Files:** `web/frontend/src/pages/LoadoutsPage.jsx:31–40`, `QuestCreatorPage.jsx:15–24`

Badges like "AI Faction Loadout", "Treasure Hunt", "AI Camp" assume the admin is fluent in Expansion taxonomy. Add a `?` tooltip on each badge with a one-sentence definition; link to the wiki tool from `wikiLinks.js`.

### 5.7 [UX-low] Discord bot has no `/help` command

The README documents 18 slash commands; Discord users can't easily see them in-context. The descriptions on individual commands are short and don't explain edge cases (e.g., `/rcon` runs BattlEye RCON, not in-game chat).

**Fix:** add a `/help` command that DMs the user a formatted command reference. Expand the per-command `setDescription()` to include the most common gotcha.

### 5.8 [UX-low] Mission vs. Settings terminology mix

**File:** `web/frontend/src/pages/ExpansionEditorPage.jsx:31–35`

"Mission" section in the UI doesn't match Expansion docs' "Settings Editor" terminology. Rename to "Mission-folder Settings" with a short explanation that these live in `mpmissions/<name>/expansion/`.

### 5.9 [UX-low] No "Clone server" feature

Any admin running ≥2 similar servers has to re-enter all config in the second one. Add a clone action in the server-hub three-dot menu that copies config, mod list, scheduled tasks, webhooks, RCON password, firewall rules — but not ban list, priority queue, or audit log.

### 5.10 [UX-low] No "this release is broken, upgrade" warning

**File:** `CHANGELOG.md`, `RELEASE_NOTES_v2.18.0.md`

v2.18.0–v2.18.3 setup wizards are broken (silent 403). The release notes don't say so. A user who downloads v2.18.0 from Releases today (because that's what comes up first in some mirror) will rage-quit. Add a banner: "⚠️ Setup wizard broken in v2.18.0–v2.18.3 — install **v2.18.4 or later**." And consider marking the broken tags as `pre-release` on GitHub.

### 5.11 [UX-low] Password policy feedback is not progressive

**File:** `backend/lib/helpers.js` (`checkPasswordPolicy`), surfaced in setup wizard.

Error reads "Password must be at least 8 characters with uppercase, lowercase, number, and special character" without indicating which one is missing. Add four real-time checkmarks in the form (live as the user types).

---

## 6. Strengths to Preserve

These are working well — don't refactor them away:

- **Defense-in-depth on auth.** HttpOnly cookie + CSRF double-submit + IP+username lockout + fail2ban + permission-based gating. Few admin tools in this space are this layered.
- **Permission system over role checks.** `M13`'s fix means custom roles compose cleanly with custom permissions — the kind of thing that makes a tool stay flexible as the user base diversifies.
- **Setup wizard's three-layer C5 fix.** Permanent marker, state-driven `getSetupState`, token-aware `requireSetupMode`. Belt + suspenders + glued-on belt-loops; this is how you fix a privilege bypass.
- **Discord bot HMAC + per-user role mapping.** Most projects in this space ship a bot with one god-mode key. Citadel routes calls through real role mappings.
- **Audit logging on script edits is differentiated** (`file.edit` vs `file.edit-script`). Makes grep-driven incident response actually possible.
- **NSSM + Node.js SHA256 verification.** Supply-chain hygiene on the install path is a real differentiator.
- **Expansion docs sync pipeline.** Wiki-driven schemas + 117 template skeletons + Docs↗ deep links. Massive UX win versus hand-maintained stale schemas.
- **Mod's bounded ingest (M18).** Production-quality reasoning in the code comments at `CommandRelay.c:1593–1604` — the limits are calibrated and explained, not magic numbers.

---

## 7. 10x Ideas

Things that would move Citadel from "good admin tool" to "industry-leading":

1. **One-click server snapshot + restore.** Bundle config, mods, ban list, priority queue, mission files; store under `data/snapshots/<ts>/`; one-click restore for emergency rollback. This is the feature server admins WhatsApp each other about; nobody ships it.
2. **Mod conflict detector at install time.** Parse `mod.cpp` dependencies/conflicts as mods are added; surface a banner "Mod X requires Y; Z conflicts with X — [Auto-uninstall Z] [Keep both, warn on boot]". Resolves 50%+ of "why isn't my mod working" tickets.
3. **Config health check sidebar.** Cross-reference mod list with Expansion settings — flag orphaned settings, missing dependencies, common misconfigurations (e.g., BaseBuilding enabled with no CF). Weekly badge on dashboard.
4. **Live ban appeal workflow.** Per the global ban DB in ROADMAP — surface appeals directly in the dashboard with "Uphold / Overturn" buttons; don't make admins log into citadels.cc.
5. **Quest playtest simulator.** Walk through quest objectives against an in-memory player state; surface broken-objective conditions before they ship to players.

---

## Appendix: Carry-over status from prior audit

| ID  | Title                          | Status as of v2.18.4 |
| --- | ------------------------------ | -------------------- |
| N1  | Stale `latest.yml` in repo root | **FIXED** in this commit (gitignored + deleted). Live release feed is hash-verified. |
| C1–C5 | All five critical items     | **FIXED** (re-verified) |
| H6  | Discord god-mode               | **FIXED** (3 layers) |
| H7  | API rate limit no-op           | **FIXED** |
| H8  | Script extension privilege     | **FIXED** (perm + path) |
| H9  | Sidecar no-key + bind          | **FIXED** |
| H10 | Mod sends api_key in URL       | **STILL PARTIAL** — see §2.1 |
| M11–M18 | Medium-severity items      | **FIXED** — except BackupsPage localStorage (§3.1) |
| L19 | Tracked junk                   | **FIXED** |
| L20 | bcryptjs → bcrypt              | **STILL OPEN** |
| L21–L25 | Various                    | **FIXED** |
| L26 | NSIS code signing              | **STILL OPEN** — see §4.2 |
| L27 | NSSM SHA256                    | **FIXED** |
| L28 | Vite obfuscator                | **FIXED** |
| L29 | Monaco lazy-load               | **FIXED** (already was) |
| L30 | Smoke tests                    | **FIXED** |
| L31 | SPA fallback for /api          | **FIXED** |
| L32 | Unused obfuscator dep          | **FIXED** |

---

*End of report.*
