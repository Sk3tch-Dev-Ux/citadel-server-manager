## Citadel v2.18.5 — Delta-audit cleanup pass

A focused cleanup release after a terminal-driven full audit of the
codebase since v2.17.0. Fourteen audit items closed across security,
quality, performance, and UX. No breaking changes; the upgrade is
drop-in.

The single most consequential fix is **N2 / BackupsPage**: the backup
download flow had been broken since v2.18.0 (the M11 cookie migration
left a `localStorage.getItem('token')` orphan in `BackupsPage.jsx`), and
in the process was also leaking the JWT into proxy access logs and
browser history via a `?token=` query parameter. Fix rewires downloads
to use `fetch(..., { credentials: 'include' })` + a blob anchor click,
matching the rest of the panel. Two parallel dead `?token=` URL-auth
shims (in `backup.routes.js` and `setup.routes.js`) were also removed so
the pattern can't silently come back.

Full audit report committed to the repo at
[`AUDIT_REPORT_2026-05-19.md`](./AUDIT_REPORT_2026-05-19.md); per-item
status lives in [`PRIORITIZED_FIXES.md`](./PRIORITIZED_FIXES.md).

---

### Fixed (security)

- **BackupsPage was reading the JWT from `localStorage` and appending it
  to download URLs as `?token=...`** — broken since the M11 cookie
  migration and also a credential-in-URL leak (proxy logs, browser
  history). Rewrote to use `fetch` + cookie auth + `Blob` +
  `URL.createObjectURL` anchor click. Removed the matching backend
  `?token=` → `Authorization` shim in `/api/servers/:id/backups/:file/download`
  and a parallel dead shim in `setup.routes.js`. (audit N2)
- **Backend log channel was redactable but not redacting the mod's
  URL-query api_key.** `backend/lib/logger.js` now lists `api_key`
  (snake-case) and `req.query.*` in its pino redact paths and exports a
  new `sanitizeUrl()` helper that strips `api_key` / `token` / `jwt` /
  `password` / `secret` query params from any URL before logging. Three
  known `req.url` callsites (`server.js:398`, `csrf.js:154/159/166`) now
  route through it. Closes the backend half of audit H10 / N3. The
  mod-side change (CommandRelay.c → switch to header auth or POST body)
  still requires a DayZ runtime test and is deferred.
- **`backend/routes/expansion-docs.routes.js` template path build
  routes through `safePath()`** instead of an ad-hoc `startsWith()`
  check, so it shares the same case-insensitive guard as the rest of
  the file routes. No active vulnerability — basename was already
  regex-bounded — just consistency hardening. (audit N10)

### Fixed (setup wizard reliability)

- **Two silent-catch blocks in the setup wizard surfaced errors instead
  of swallowing them.** `completeSetup()` previously navigated forward
  on failure, which produced a "done!" screen for a setup that never
  actually completed — exactly the v2.18.0–v2.18.3 trap. It now stays
  on the current step on error so the user can retry. The
  `/api/setup/network/detect` catch also now surfaces a non-fatal
  "you can still type the IP manually" message instead of looking like
  a frozen Auto-Detect button. (audit N7)
- **Setup wizard now has a "Download diagnostics (for support)" link
  under any error message.** Backed by a 50-event ring buffer in
  `api.js` that captures every request (timestamp, method, sanitized
  URL, status, duration, error — no bodies, sensitive query params
  stripped). Click → downloads `citadel-diagnostics-<ts>.txt` the user
  can attach to a support thread. (audit N7)
- **Setup wizard's admin password step now shows live per-rule
  checkmarks** (8+ chars, uppercase, lowercase, number, symbol) as the
  user types. Placeholder corrected from the wrong "At least 6
  characters" to "8+ chars, mixed case, number, symbol". Confirm-
  password field shows inline "Passwords don't match" with a red
  border. Mirrors the actual backend policy in `helpers.js`. (audit
  N15)
- **Pre-release flag manual reminder:** v2.18.0–v2.18.2 are still
  marked as "Latest" / regular releases on GitHub. Each one now has a
  ⚠️ DO NOT INSTALL banner at the top of its `RELEASE_NOTES_v*.md`,
  but the GitHub Releases UI flag should also be set:
  `gh release edit v2.18.0 --prerelease`, same for v2.18.1 and
  v2.18.2. (audit N14)

### Added

- **`/help` Discord slash command** that DMs the user a categorized
  reference of every Citadel command, with examples for the
  non-obvious ones — notably `/rcon` (raw BattlEye RCON, not in-game
  chat; points users to `/broadcast` and `/kill` for the common
  cases). Auto-discovered by the existing commands/ loader; no new
  dependencies. Falls back to an ephemeral reply if Discord DMs are
  blocked. (audit N13)
- **`GET /api/servers/:id/mission-folder`** — a lightweight per-server
  endpoint that returns the detected mission folder name via the
  existing `detectMissionFolder` helper. Used by the FilesPage
  template picker to substitute the real folder name into the
  `mpmissions/<...>/expansion/settings/...` path so admins don't have
  to know their own folder layout. (audit N12)

### Changed (UX polish)

- **FilesPage template picker now validates the target path in real
  time** — checks for `..` traversal and absolute-path prefixes,
  shows a red border + red error message for actual invalid paths,
  keeps the existing orange `<placeholder>` hint, disables the Create
  button until everything passes. (audit N11, FilesPage half)
- **LoadoutsPage new-loadout modal now validates the name in real
  time** with a red border + helper text on invalid input. Trims
  before regex and PUT URL. (audit N11, LoadoutsPage half)
- **Expansion editor sidebar:** "Mission Folder" divider renamed to
  "Mission-folder Settings" with a subtitle `Live in mpmissions/<mission>/expansion/`
  to disambiguate from DayZ's separate "Mission" concept. (audit N17)
- **Loadout / Quest / Objective type badges now carry hover
  definitions.** Every badge in `LoadoutsPage`, `QuestCreatorPage`
  has a `title=` tooltip with a one-sentence definition (Hero, Bandit,
  AI VIP, Treasure Hunt, etc.) and a `cursor: help`. Admins
  unfamiliar with Expansion taxonomy can hover to learn without
  leaving the page. (audit N18)

### Performance

- **Expansion-docs template list is now shared-cached across modal
  opens.** New `utils/expansionDocsCache.js` exports a `getTemplates()`
  helper with a 5-minute TTL + in-flight promise dedup. Both the
  FilesPage and LoadoutsPage template pickers use it, so re-opening
  a picker hits memory instead of refetching. Cache clears on error so
  a network blip doesn't poison subsequent calls. (audit N16)

### Hygiene

- **Stale `latest.yml` removed from the repo root and added to
  `.gitignore`.** The committed copy was a misleading dead artifact —
  the live auto-updater feed is the GitHub Release asset (generated
  fresh by `installer/build.js:543` and uploaded by the release
  workflow), and that feed has correct sha512s. The stale root copy
  caused an audit pass to incorrectly flag a CRITICAL severity until
  verification against the live feed via `gh release view` showed the
  updater was fine. (audit N1)

### Internals — what was looked at and verified holding

From the prior audit (2026-05-06), independently re-verified in current
code:

- **C1–C5** (CSRF fallback secret, safePath traversal, constant-time
  login dummy hash, CSRF exemption for `/api/discord/`, setup re-arm
  takeover) — all fixed and verified in `csrf.js`, `helpers.js`,
  `auth.routes.js`, `setup.routes.js`.
- **H6** (Discord bot god-mode) — three-layer defense in place: role
  `discord-bot` in `server.js:49–76`, per-call HMAC in
  `discord.routes.js:150–176`, per-user role mapping in
  `discord-user-roles.routes.js`.
- **H7** (rate-limit no-op) — real `express-rate-limit` instance in
  `middleware/rate-limit.js:29–35`.
- **H8** (file-write escalation) — dual-gated perm + path in
  `files.routes.js:39, 65–72, 160–178`.
- **H9** (sidecar bind / no-key) — fatal exit in prod without key,
  loopback-only in dev, fixed-length buffer compare.
- **M11–M18** all verified except the BackupsPage cleanup (closed
  this release as N2).

### Open follow-ups

- **N3 mod-side** — `Scripts/CommandRelay.c:1586` still sends
  `?api_key=...&server_id=...` on every GET poll. Backend log leak is
  closed (this release); the network-URL leak needs a mod change
  (header or POST body) + DayZ runtime testing.
- **N4 code signing** — installer still unsigned. Needs an EV/OV cert.
- **N5** — bcryptjs → native bcrypt. Needs install-pipeline validation.
- **N6** — error shape rollout across all routes. Worth a dedicated PR.
- **N8** — mobile responsive admin panel. Multi-day visual work.
- **N9** — Ctrl+K config search + glossary modal.

See `AUDIT_REPORT_2026-05-19.md` for the full report and
`PRIORITIZED_FIXES.md` for the per-item ledger.

### Repack required

- **Desktop app:** yes — install v2.18.5 for the BackupsPage fix and
  setup wizard improvements.
- **@CitadelAdmin mod (PBO):** no change.
- **Server configs:** no migration.
