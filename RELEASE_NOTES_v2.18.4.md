## Citadel v2.18.4 — Setup wizard cookie fix

Third hotfix in the v2.18 line for the first-time setup wizard. v2.18.3
allowed authenticated requests through `requireSetupMode` — but in
testing it turned out the wizard wasn't actually sending an
Authorization header, so the gate still 403'd in practice. The reason:
since audit M11, browser sessions authenticate via an HttpOnly
`auth-token` **cookie**, not a Bearer header. `/api/setup/admin` wasn't
setting that cookie, so the wizard had no usable credentials to send.

> **Upgrade required for v2.18.0 / v2.18.1 / v2.18.2 / v2.18.3 installs
> that can't finish first-time setup.** If you have a working login and
> a configured server, no action needed.

---

### Fixed

- **Auto-Detect IP (and every other post-admin wizard step) still
  silently failed in v2.18.3.** The middleware change in v2.18.3 was
  necessary but not sufficient — `requireSetupMode` was correctly
  trying to validate a JWT for subsequent steps, but no JWT was being
  sent. Audit M11 moved browser session auth from `localStorage` /
  Bearer headers to an HttpOnly `auth-token` cookie set by
  `/api/auth/login`. `/api/setup/admin` had never been updated to set
  the same cookie, so after admin creation the wizard had nothing for
  the browser to auto-attach.

  **Fix — two paired changes in `backend/routes/setup.routes.js`:**
  1. `/api/setup/admin` now sets the `auth-token` HttpOnly cookie
     alongside returning the token in the JSON response, matching
     `/api/auth/login` exactly. `path: '/'`, `maxAge: 24h` (matches
     the JWT lifetime).
  2. `extractSetupToken()` (the helper used by `requireSetupMode`)
     now reads from `req.cookies['auth-token']` first, falling back
     to the Bearer header and `?token` query for legacy / scripted
     clients.

  Result: after the admin step, every subsequent setup call (network
  detect, network save, Steam, complete) automatically carries the
  cookie and passes through `requireSetupMode` cleanly.

### Why the silent failure was so hard to spot

The frontend's `detectIps` swallows errors with
`catch { /* non-critical */ }`, so a 403 on Auto-Detect IP produces no
visible error — just an unresponsive button. Combined with the
HttpOnly cookie being invisible from JS, there was no obvious clue
that auth was the problem. The actual diagnostic was tracing
`API.headers()` and finding the `API.token` legacy fallback documented
as deprecated for browser sessions.

### Affected users — what to do

- **Mid-wizard stuck on Auto-Detect IP / Network / Steam:** install
  v2.18.4. The admin you created in the failed attempt is still in
  `data/users.json` — either log in with those credentials and re-run
  the wizard from the welcome screen, or wipe `data/users.json` +
  `data/.first-run-completed` to start completely fresh.
- **Working install:** no action.

### Repack required

- **Desktop app:** yes — install v2.18.4 to get the fix.
- **@CitadelAdmin mod (PBO):** no change.
- **Server configs:** no migration.

### Internals

- Modified: `backend/routes/setup.routes.js` —
  + `extractSetupToken()`: cookie check added (4 lines)
  + `POST /api/setup/admin`: `res.cookie('auth-token', ...)` added (5
    lines + comment)
- Test coverage: 5 end-to-end scenarios verified (anonymous admin
  POST, post-admin with cookie, post-admin POST with cookie,
  post-admin without cookie = correctly blocked, Bearer header
  fallback for legacy/desktop clients) — all pass.

### Combined v2.18.2 + v2.18.3 + v2.18.4 = fully working setup

- ✅ Wizard appears on cold start
- ✅ Wizard appears on fresh install over leftover servers (v2.18.2)
- ✅ Admin creation succeeds
- ✅ Auth cookie set after admin creation (v2.18.4)
- ✅ `requireSetupMode` accepts authenticated requests (v2.18.3)
- ✅ Cookie auth recognized by `requireSetupMode` (v2.18.4)
- ✅ Auto-Detect IP works
- ✅ Network save / Steam / Complete all work
- ✅ Login screen after setup
