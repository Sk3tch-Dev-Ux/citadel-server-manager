## Citadel v2.18.6 — Search, security tail, mobile, actionable errors

A substantial follow-up to the v2.18.5 audit-cleanup pass. Six commits
closing the remaining items from the 2026-05-19 delta audit:

- **Cmd/Ctrl+K Config Search** — a global modal that fuzzy-searches
  across every Expansion settings field on every server (2,420 fields
  on the current schema set), with URL deep-linking and a blue
  highlight flash on the target row.
- **`/help` Discord command** — DMs you a categorized command reference.
- **Mod URL-key leak closed** (opt-in) — `auth_in_body` config flag in
  CommandRelay.c moves api_key out of every URL into the JSON body.
- **bcryptjs → @node-rs/bcrypt** — Rust-native, prebuilt binaries, no
  node-gyp, same hash format.
- **Code-signing wiring in place** — add a PFX secret to GitHub and
  installers auto-sign from the next release onward. SIGNING.md runbook
  ships with the source.
- **Actionable error messages** — every error admins hit during the
  first hour now has a "do this next" hint underneath.
- **Mobile-usable for crisis ops** — Players and Bans tables fit on a
  phone screen as stacked cards. Server-control buttons stack instead
  of overflowing.

Drop-in upgrade. No breaking changes, no migrations, no mod re-pack
required (the mod change ships defaulted off).

Full audit report at
[`AUDIT_REPORT_2026-05-19.md`](./AUDIT_REPORT_2026-05-19.md);
per-item status at
[`PRIORITIZED_FIXES.md`](./PRIORITIZED_FIXES.md).

---

### Added

- **Cmd/Ctrl+K Config Search.** Global modal mounted in `AppLayout`,
  opened by Ctrl+K (Windows/Linux) or Cmd+K (mac). Backed by a new
  `GET /api/expansion-docs/field-index` endpoint that walks
  `backend/schemas/expansion-templates/` and returns a flat
  `[{ field, file, parent }]` index (~2,420 entries, in-process cache).
  Fuzzy ranking with exact > prefix > contains. Keyboard nav (↑↓ ↵ Esc).
  Selecting a result navigates to
  `/servers/<id>/expansion?file=<File>&field=<Name>`,
  `ExpansionEditorPage` resolves the file → category, switches the
  active tab, scrolls the matching row into view, and applies a brief
  blue flash via a new `@keyframes fieldFlash` animation. Falls back to
  the first server when no server is currently selected. (audit N9)

- **`/help` Discord slash command.** Auto-discovered by the existing
  commands/ loader. Returns a categorized embed reference of all 18
  Citadel commands with examples for the non-obvious ones — notably
  `/rcon` (raw BattlEye RCON, not in-game chat) which now explicitly
  flags that it bypasses player-actions and points users to `/broadcast`
  and `/kill` for the common cases. DMs the user first (so the
  reference persists in their history); falls back to an ephemeral
  reply with a Discord-privacy-settings hint if DMs are blocked.
  (audit N13)

- **`GET /api/servers/:id/mission-folder`** — lightweight per-server
  endpoint exposing the `detectMissionFolder()` helper. Used by the
  FilesPage template picker to substitute the literal `<your-mission>`
  placeholder with the actual folder name from `serverDZ.cfg`. Admins
  who don't know their mission folder layout get a working path on
  first click. (audit N12)

- **Opt-in mod body-auth flag** (`CommandRelayConfig.auth_in_body`,
  default `false`). When flipped to `true`, the DayZ mod stops sending
  `api_key` in URL query strings:
  - The GET poll switches to a POST with
    `{"api_key":"...","server_id":"..."}` in the body. (DayZ's
    `RestApi.SetHeader` is Content-Type-only across engine versions,
    so a custom `Authorization` header isn't an option.)
  - All six POST event/ack sites (player_login, player_logout × 2,
    player_death, SendQueryResponse, SendAck) move the api_key out of
    the URL query and inject it as the first property of the existing
    JSON payload.
  Default-false preserves backward compatibility for operators using
  CFTools or other URL-key-expecting receivers. Operators who control
  their receiver flip the flag once it accepts body-auth.
  **Runtime test pending** — the mechanism is code-complete; verifying
  that `ctx.POST(callback, "", payload)` is happy with an empty path
  string needs an in-game test. (audit N3 mod-side)

- **`/help` for code signing.** New `installer/SIGNING.md` runbook walks
  through OV vs EV cert tradeoffs ($150–300/yr vs $300–500/yr),
  GitHub Actions secret setup, local-dev signing, EV-on-USB-token
  caveats with cloud HSM options, signature verification, and cert
  renewal flow. (audit N4)

### Changed

- **Error responses now ship optional `code` + `suggestion`** alongside
  the existing `error` message string. `backend/lib/http-errors.js` has
  a new `clientError(res, status, message, opts)` helper for explicit
  4xx with user-facing copy, and the existing `safeError()` was
  extended to forward `code` / `suggestion`. ToastContainer renders
  `suggestion` as a smaller muted secondary line under the main
  message. The setup wizard and login screen render the same pattern
  inline. Rolled out across the routes admins actually hit during
  first-hour onboarding — `setup.routes.js` (admin / network /
  SteamCMD / complete), `auth.routes.js` (lockout / invalid creds /
  MFA), `files.routes.js` (extension / size / path-traversal / script
  permission / script-outside-hooks). Each error now ships a concrete
  next-step hint (e.g. "Check caps lock", "Make sure your authenticator
  app's clock is synced", "Place this file under lifecycle_hooks/"). 
  Backward compatible: legacy `result.error` consumers still get a
  string. (audit N6)

- **Mobile UI for crisis admin ops.** Two new CSS breakpoints on top
  of the existing 900px sidebar drawer:
  - **≤ 768px**: Start / Stop / Restart button group wraps to
    half-width buttons so they stack instead of overflowing. Server
    status-bar metrics wrap. Page title shrinks.
  - **≤ 600px**: new `.mobile-card-table` opt-in class switches
    tables to stacked-card display with `data-label`-driven cell
    labels. Sidebar drawer narrows to 80vw so the overlay scrim
    invites tap-to-close.
  Applied to `PlayersPage` and `BansPage` — the two tables admins need
  from a phone during a crisis. Player action menu (heal / freeze /
  kick / teleport / etc.) keeps working in card form. Other tables
  (audit log, mods, files) keep horizontal scroll; they migrate to the
  pattern opportunistically. (audit N8)

- **Auto-fill mission folder name in FilesPage template picker.**
  The template-picker modal now fetches `/api/servers/:id/mission-folder`
  in parallel with the template list and substitutes the real folder
  name into `mpmissions/<...>/expansion/settings/...` paths. The
  literal `<your-mission>` placeholder only appears when auto-detection
  fails. (audit N12)

- **Hover definitions on loadout / quest / objective badges.** Every
  type badge in `LoadoutsPage`, `QuestCreatorPage` (both `QuestTypeBadge`
  and `ObjTypeBadge`) carries a native `title=` tooltip with a
  one-sentence definition (Hero, Bandit, AI VIP, Treasure Hunt, AI
  Camp, etc.) and a `cursor: help`. Hover any badge to learn what the
  type actually means without leaving the page. Definitions live next
  to the existing type tables so adding a new type forces a definition.
  (audit N18)

- **Expansion-docs template index is shared-cached across modal
  re-opens** via the new `web/frontend/src/utils/expansionDocsCache.js`
  with a 5-minute TTL and in-flight promise dedup. FilesPage and
  LoadoutsPage both hit memory instead of refetching. (audit N16)

- **`expansion-docs.routes.js` template path build routes through
  `safePath()`** instead of an ad-hoc `startsWith()`, sharing the
  case-insensitive traversal guard from `helpers.js`. (audit N10)

- **`signtool sign` integration in `installer/build.js`.** New
  `signInstallerIfConfigured()` helper called between the NSIS build
  step and the sha512-hash step. Opt-in via `CITADEL_SIGN_PFX` +
  `CITADEL_SIGN_PASSWORD` env vars (populated from the
  `CITADEL_SIGN_PFX_BASE64` + `CITADEL_SIGN_PASSWORD` GitHub Actions
  secrets when present). Signs the installer with
  `/tr <timestamp> /td sha256 /fd sha256`, then re-verifies with
  `signtool verify /pa`. Hashing happens AFTER signing so the
  `latest.yml` sha512 matches what users actually download.
  Skipped silently with a heads-up log when unconfigured so dev
  builds and unsigned CI keep working — no behavior change until you
  add the secrets. (audit N4)

### Security

- **bcryptjs (^2.4.3) → @node-rs/bcrypt (^1.10.7).** Rust-native,
  prebuilt N-API binaries via platform-specific npm subpackages — no
  node-gyp, no postinstall, keeps the release workflow's
  `npm ci --ignore-scripts` posture clean (plain `bcrypt` needed a
  postinstall to fetch prebuilds, which `--ignore-scripts` blocks).
  API surface is signature-compatible: `hash`, `compare`, `hashSync`.
  Hash format cross-compat verified end-to-end — existing `$2a$10$...`
  user records on disk validate cleanly under the new library, and
  the new `$2y$10$...` hashes round-trip in either direction. No
  user migration required. (audit N5)

- **Mod URL-key leak closed (mechanism)** — see "Added" section above.
  Backend log-redaction half (sanitizeUrl in pino redact paths) already
  shipped in v2.18.5. (audit N3)

### Infrastructure / hygiene

- **Code-signing pipeline ready, waiting on a cert.** Once you procure
  an OV or EV cert and add the two GitHub Actions secrets, the next
  tagged release auto-signs without further code changes. See
  `installer/SIGNING.md` for the runbook. (audit N4)

### Open follow-ups

- **Mod runtime test** before flipping `auth_in_body: true` on a
  production receiver. Mechanism is in place; only an in-game DayZ
  test will confirm `ctx.POST(callback, "", payload)` is happy.
- **Code-signing cert procurement.** No code change needed; just buy
  the cert and add the two GitHub secrets.
- **Pre-release flag on v2.18.0–v2.18.2** —
  `gh release edit v2.18.0 --prerelease` (and v2.18.1, v2.18.2) so
  the known-broken setup-wizard releases stop surfacing as "Latest"
  candidates.
- **Long-tail error-shape migration**: ~600 remaining
  `res.status(...).json({ error: '...' })` callsites still use the
  old shape. No regression — they render as single-line toasts.
  Migrate opportunistically as routes get edited.
- **Long-tail table-card migration**: audit log, mods, files browser,
  etc. keep horizontal scroll on mobile. Add `.mobile-card-table` +
  `data-label` attributes when authors touch each page.

### Repack required

- **Desktop app:** yes — install v2.18.6 to get the new search,
  validation, error messages, and mobile improvements.
- **@CitadelAdmin mod (PBO):** **no change** for existing operators
  (default-false flag). If you want body-auth, repack the mod with
  the new `auth_in_body: true` config and update your receiver to
  match.
- **Server configs:** no migration.
