> ## ⚠️ DO NOT INSTALL — setup wizard is still broken in this release
>
> This release fixed one piece of the setup-wizard regression but another piece
> (silent 403 on Network / Steam / Complete steps after admin creation) was not
> caught until v2.18.4.
>
> **Upgrade to v2.18.4 or later.** See `RELEASE_NOTES_v2.18.4.md` for the fix.

---

## Citadel v2.18.2 — Critical setup wizard fix

A one-line-logic fix for a regression in v2.18.1 that locked new and
re-installed users out of first-time setup with a confusing `403 Forbidden`
on the admin-creation step.

> **Upgrade required for any v2.18.0 / v2.18.1 install that hits the
> setup wizard 403.** Anyone who already has a working admin login is
> unaffected.

---

### Fixed

- **First-time setup wizard returned 403 on `POST /api/setup/admin`**
  for installs where the `data/` directory had servers from a prior
  install but no real admin user yet.

  The flow that broke:
  1. Fresh install (or reinstall after manual cleanup) lands on a
     `data/` directory that has `servers.json` from a previous Citadel
     install but no `users.json` (or only the bare default admin).
  2. Frontend's `/api/setup/status` correctly reports `needsSetup: true`
     and the wizard appears.
  3. User fills in the admin form and submits.
  4. Backend's `requireSetupMode` calls `getSetupState()`, which used to
     return `'complete'` when `hasServers === true`, regardless of
     whether a real admin existed yet.
  5. Setup wizard latched itself out and the user couldn't proceed —
     and couldn't log in either, because no real admin was ever
     created.

  **Fix:** reorder the checks in `getSetupState()` so the
  *"only default admin exists"* branch runs **before** the
  *"any non-default state means setup ran"* branch. If the only user
  in the system is the bare auto-created `admin` account, the wizard
  must remain available regardless of leftover servers or other state
  — because the user has no usable login yet.

  The first-run security marker still works the same way: once it's
  written (which happens when a real admin is provisioned), setup is
  locked forever. The marker is unchanged, only the order of the
  pre-marker checks moved.

### Affected users — what to do

If your Citadel v2.18.1 install opens to the setup wizard and you get
"Setup already completed" (or a 403 in DevTools) when you try to
submit:

1. Install v2.18.2 (auto-update will handle it if your app opens; if
   it doesn't, download the new installer manually and run it).
2. The wizard should now accept your admin submission cleanly.

If your Citadel v2.18.1 install opens to the **login screen** with a
working admin account: no action needed. The bug only affected
installs that never finished first-time setup.

### Repack required

- **Desktop app:** yes — install v2.18.2 to get the fix.
- **@CitadelAdmin mod (PBO):** no change.
- **Server configs:** no migration.

### Internals

- Modified: `backend/routes/setup.routes.js` — `getSetupState()`
  reordered. ~10 lines of logic, no API change.
- Test coverage: the new ordering was verified against 6 scenarios
  (cold start, default admin only, default admin + leftover servers,
  real admin, real admin + servers, marker-present) — all pass.
