# Citadel Roadmap — Phases 1 & 2

**Owner:** Kurt
**Last updated:** 2026-04-28
**Scope:** Auto-update reliability (Phase 1) and Citadel-Cloud license rollout (Phase 2). Phase 3+ (paid features, starting with the global ban database) is deferred to a separate plan once Phase 2 is in customers' hands.

---

## Product model (read this first)

Citadel ships as two distinct products that share a codebase and integration surface:

- **Citadel** (the desktop app + local backend in this repo) is **free**. Anyone can download, install, and manage their DayZ servers. No account required. No nag screens that block functionality. Works exactly as today.
- **Citadel Cloud** is a **paid service** sold on Citadels.cc. Sign-in from the Citadel desktop unlocks cloud-only features (Phase 3+: global ban DB, off-site backups, etc.). No sign-in = no cloud features. The local app keeps working with everything it does today.

This means: the activation banner, the license token, the device limit — none of that gates anything in the free product. Those mechanisms exist solely to turn cloud features on for paying customers. Customers who never sign up never notice any difference from today.

## Executive summary

Two-phase plan. Phase 1 ships in days, not weeks: it fixes the auto-update relaunch bug that bit on 2026-04-27 and adds the basic update telemetry we needed yesterday but didn't have. Phase 2 finishes wiring the *already-mostly-built* Citadel Cloud paid-service layer into the desktop — sign-in UX, end-to-end smoke test, telemetry, and the gating scaffolding — so Phase 3 can ship the first paid feature in a single PR.

**The most important thing to understand up front:** most of the licensing infrastructure already exists in this repo. `backend/lib/license/` has a complete activation/verify/deactivate flow against `https://citadels.cc/api/v1/license/*`, RS256 verification with an embedded public key, a 7-day offline grace window, and a 6-hour background refresh. The dashboard has `CitadelLicensePage.jsx` and `CitadelLicenseBanner.jsx`. Routes are registered in `backend/server.js:144`. The Citadel-Cloud side has the matching endpoints (`packages/api/src/routes/license.routes.ts`) plus user accounts, Paddle billing, and device management. Phase 2 is **finishing and rolling out**, not building from scratch.

This is also why we're keeping "dual-mode with grace period" simple: the existing system *is* dual-mode by default. Nothing is currently gated on `license.isUsable()`, so unactivated installs keep working exactly as they do today. Activation only matters when paid features start landing in Phase 3.

---

## Current state assessment

### What's already wired

| Component | Location | Status |
|---|---|---|
| License client (HTTP) | `backend/lib/license/client.js` | Done — calls `https://citadels.cc/api/v1/license/{activate,verify,deactivate}` |
| License service (state machine) | `backend/lib/license/index.js` | Done — activate/refresh/deactivate, 7d grace, background refresh |
| RS256 token verifier | `backend/lib/license/verifier.js` | Done — embedded public key, validates issuer + product |
| On-disk cache | `backend/lib/license/storage.js` | Done — `data/license.json` |
| Machine-ID | `backend/lib/license/machine-id.js` | Done — Windows MachineGuid w/ hostname-hash fallback |
| Dashboard REST routes | `backend/routes/citadel-license.routes.js` | Done — registered at `server.js:144` |
| Dashboard UI | `web/frontend/src/pages/CitadelLicensePage.jsx`, `web/frontend/src/components/CitadelLicenseBanner.jsx` | Done — needs end-to-end smoke test |
| Citadel-Cloud API | `packages/api/src/routes/license.routes.ts` (in citadel-cloud repo) | Done — activate/verify/deactivate + device management |
| Paddle billing webhook | citadel-cloud repo | Done — subscription lifecycle handled |
| `isUsable()` gating helper | `backend/lib/license/index.js:180` | Defined but **referenced nowhere** |
| Auto-updater | `desktop/src/auto-updater.js` | Works, but `installNow()` has the bug from 2026-04-27 |
| NSIS installer | `installer/citadel.nsi` | Works for fresh installs, contributes to update bug |
| Desktop `license-client.js` | `desktop/src/license-client.js` | **Stub.** Should be deleted — the backend handles licensing; the desktop just renders the UI |

### What's not wired

- Nothing in the codebase calls `license.isUsable()`. There's no actual gate yet.
- No update telemetry — when yesterday's bug fired we had no remote signal.
- No `app.relaunch()` fallback in the updater. We rely entirely on NSIS's finish-page `LaunchDashboard()` which doesn't run on silent installs.
- The NSIS install section calls `service-installer.js uninstall` (which stops the service) but with a fragile 3-second wait. Doesn't wait for `node.exe` file handles to actually release.
- No "what counts as paid" decision yet. Until that exists, there's nothing to gate.

---

## Phase 1 — Auto-update reliability

**Goal:** Eliminate yesterday's failure mode. After clicking "Restart to install", the user ends up with the new version running and the dashboard reachable. If anything in that path fails, we have logs to diagnose it.

**Target ship:** v2.7.x patch this week.

### Diagnosis recap

When the user clicks "Restart to install":

1. `desktop/src/auto-updater.js:202` calls `autoUpdater.quitAndInstall(true, true)` — silent install, `isForceRunAfter=true`.
2. Electron quits. The `CitadelServer` Windows service is **still running** holding port 3001 and file handles on `backend/`.
3. NSIS executes `installer/citadel.nsi:122` (`service-installer.js uninstall`) which does call `nssm stop CitadelServer` (`backend/lib/service-installer.js:293`) followed by a 3s `timeout`. This *usually* releases handles but is timing-dependent.
4. NSIS overwrites files. New service registered. Service started (`citadel.nsi:140`).
5. NSSM's `AppThrottle 5000` (`service-installer.js:244`) gives Node 5 seconds to "successfully" start. On a slow disk after a fresh install, that's tight.
6. **Critical:** `quitAndInstall(true, true)` with `isSilent=true` skips the NSIS finish page, so `LaunchDashboard()` (`citadel.nsi:195`) **never runs**. There's no fallback. The user is left with a stopped Electron app and (sometimes) a half-started service.

**Three things go wrong, any of which is sufficient:**

- A. Service-stop timing: 3s wait isn't always enough; install over running service partially fails.
- B. Relaunch path: silent install never invokes `LaunchDashboard()`; no `app.relaunch()` in our code.
- C. Throttle: 5s `AppThrottle` is borderline on cold starts; failed throttle = service in stopped state, Electron polling :3001 forever.

We have no log of which one fired yesterday because we only `console.log` the updater state.

### Changes

#### P1.1 — Stop the service before `quitAndInstall` (most important)

**File:** `desktop/src/auto-updater.js`
**Function:** `installNow()` (line 195)

Before calling `quitAndInstall`, gracefully stop `CitadelServer` and wait for the process to actually exit. Fall back to terminating after a hard timeout so we never hang forever. Schedule `app.relaunch()` *before* `quitAndInstall` so we have a relaunch fallback regardless of what NSIS does.

Sketch:

```js
const { app } = require('electron');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function stopServiceGracefully(timeoutMs = 20000) {
  try {
    await execAsync('nssm stop CitadelServer', { timeout: timeoutMs, windowsHide: true });
  } catch (err) {
    log('nssm stop returned non-zero (likely already stopped):', err.message);
  }
  // Wait until no node.exe is holding our install dir
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count"',
        { windowsHide: true }
      );
      if (Number((stdout || '').trim()) === 0) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  log('warning: node processes still present after timeout — installing anyway');
}

async function installNow() {
  if (lastState.phase !== 'downloaded') {
    warn('installNow called but no update is downloaded');
    return { ok: false, reason: 'no-update-downloaded' };
  }
  log('installNow: stopping CitadelServer before install');
  await stopServiceGracefully();
  log('installNow: scheduling app.relaunch as fallback');
  app.relaunch();   // belt + suspenders — runs even if NSIS doesn't relaunch
  log('installNow: calling quitAndInstall');
  autoUpdater.quitAndInstall(true, true);
  return { ok: true };
}
```

#### P1.2 — Make NSIS install robust to a still-running service

**File:** `installer/citadel.nsi`
**Section:** `Section "Citadel" SecMain`, before line 105 (the `File /r` copy)

Add an explicit stop+wait at the top of the install section so we're not relying on the service-installer.js script's internal timing. Mirrors what the uninstall section already does (lines 226-233):

```nsis
DetailPrint "Stopping Citadel service before applying update..."
nsExec::ExecToLog '"$INSTDIR\runtime\nssm.exe" stop CitadelServer'
Pop $0
Sleep 3000
nsExec::ExecToLog 'powershell -NoProfile -WindowStyle Hidden -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like \"$INSTDIR\runtime\node.exe\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
Pop $0
```

#### P1.3 — Bump `AppThrottle` from 5s to 15s

**File:** `backend/lib/service-installer.js:244`

Change `AppThrottle 5000` → `AppThrottle 15000`. 5s is borderline for cold Node starts; 15s gives the dashboard time to come up after a fresh disk write without NSSM marking it failed.

Also add a `service:repair` npm script that runs `nssm reset CitadelServer Counter` to clear NSSM's failure count manually if a customer hits it. (Not strictly needed for the bug, useful for support.)

#### P1.4 — Persistent update log

**File:** `desktop/src/auto-updater.js`

Replace `log()` and `warn()` to also append to `%APPDATA%/Citadel/update.log` (rotated at 1 MB). This is the single most useful thing we can do for the *next* update bug — it gives us something to ask customers to send when something goes wrong.

```js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let _logPath = null;
function logPath() {
  if (_logPath) return _logPath;
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    _logPath = path.join(dir, 'update.log');
  } catch {}
  return _logPath;
}

function appendLog(level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(String).join(' ')}\n`;
  try { fs.appendFileSync(logPath(), line); } catch {}
}

function log(...args) { appendLog('INFO', args); console.log('[updater]', ...args); }
function warn(...args) { appendLog('WARN', args); console.warn('[updater]', ...args); }
```

Add a 1 MB size check at startup and rotate to `update.log.1` if exceeded.

#### P1.5 — Surface the update log from the menu

**File:** `desktop/src/menu.js` (existing)

Add a "Help → Show Update Log" item that opens `%APPDATA%/Citadel/update.log` in Notepad via `shell.openPath()`. Cheap, lets you tell a customer "send me this file" in one sentence.

#### P1.6 — Delete the stub `desktop/src/license-client.js`

It's labeled "STUB for Phase 1 — Phase 2 will flesh it out". Phase 2 doesn't need a desktop-side license client — the React dashboard talks to the backend at `/api/citadel-license/*`, which already does the full activation flow. The stub is unreferenced and creates a misleading "Phase 2 needs to build this" expectation. Delete it and any imports.

### Testing

Manual on Windows 10 + Windows Server 2019 (the two we know customers run):

1. **Happy path.** Install v2.7.0. Manually publish a fake v2.7.1 release. Confirm: prompt appears → click Restart → service stops cleanly → install completes → service restarts → Electron relaunches → dashboard loads.
2. **`update.log` populated.** After the above, confirm `%APPDATA%/Citadel/update.log` contains a full sequence: `installNow: stopping CitadelServer`, `nssm stop CitadelServer`, `quitAndInstall`, post-restart entries from the new version.
3. **Service-was-already-stopped path.** Stop the service manually (`nssm stop CitadelServer`), then click Restart-to-install. Should still work — the new code path tolerates "already stopped".
4. **Slow disk.** Run on a HDD or VM with throttled disk; confirm 15s `AppThrottle` accommodates the cold start.
5. **Relaunch fallback.** Force-skip the NSIS `LaunchDashboard()` (e.g. by editing the installer locally to comment it out) and confirm `app.relaunch()` brings the app back anyway.
6. **No regression on fresh install.** New customer flow (no prior install) still works with the NSIS service-stop block — the stop should no-op safely on first install.

### Release plan

- Patch release as v2.7.x. No breaking changes; users on v2.7.0 update normally — but importantly, **the v2.7.0 → v2.7.x update will still go through the broken path**, so there's a one-time rough update for anyone on v2.7.0. Document this clearly in the release notes ("if your update fails to relaunch, manually open Citadel from the Start Menu — this is the last update where that may happen").
- Tag, GitHub Actions builds NSIS, publishes Release. `latest.yml` updates automatically.
- Post in Discord with the "manually relaunch" caveat for any user currently on a broken update.

### Acceptance criteria

- [ ] `installNow()` stops the service and schedules `app.relaunch()` before `quitAndInstall`.
- [ ] `citadel.nsi` install section stops the service explicitly before file overwrites.
- [ ] `AppThrottle` is 15000 in `service-installer.js`.
- [ ] `%APPDATA%/Citadel/update.log` is created and populated during the update flow.
- [ ] Help menu has "Show Update Log".
- [ ] `desktop/src/license-client.js` is removed; no broken imports.
- [ ] All six manual test scenarios pass on Windows 10.
- [ ] Release notes for v2.7.x mention the one-time rough update for v2.7.0 users.

### Out of scope for Phase 1

- Code signing the installer (separate effort, not blocking the bug fix).
- Auto-updating the backend service independently of the desktop wrapper.
- Update telemetry to Citadel-Cloud — that's Phase 2.
- Retry UI in the renderer if `installNow()` returns `{ ok: false }`.

---

## Phase 2 — Citadel-Cloud licensing rollout

**Goal:** A customer can sign in with a Citadels.cc account from the Citadel dashboard, see their license status, and stay activated through restarts and offline periods. Nothing is gated yet — but the foundation is fully exercised by real users so Phase 3 can land paid features safely.

**Target ship:** 2–3 weeks after Phase 1.

### Why this is mostly a finishing job, not a build job

See the "Current state" table above. The activation pipeline already exists end-to-end. What we have not done is:

1. Smoke-tested the whole flow against a live Citadels.cc.
2. Made any decision about what unactivated users see.
3. Hooked `isUsable()` into anything (the helper exists; nothing calls it).
4. Added telemetry so we know when activations fail in the wild.
5. Made the migration story explicit for users who have run Citadel before this layer existed.

### Decisions (resolved 2026-04-28)

**D1. Unactivated user UX → persistent dismissable banner.** Banner on every dashboard page when state is `unactivated`. Two CTAs: "Sign in to Citadel Cloud" (opens activation modal) and "Learn more" (opens `https://citadels.cc/cloud` in browser — the marketing/pricing page). Dismissable per session, reappears on next launch. The banner is a *marketing surface* for the paid service, not a gate on local functionality. Drives P2.2.

**D2. Citadel Cloud → paid only, no free tier.** *(Revised 2026-04-28 from earlier "free signup, 1 device".)* Citadel (the local app) is free for everyone. Citadel Cloud is a paid subscription. The existing Citadels.cc `/activate` endpoint already enforces this — it returns `402 SUBSCRIPTION_INACTIVE` for users without an active Paddle subscription, which is exactly the desired behavior. **No entitlement model, no free-tier signup work, no per-tier device limits in Phase 2.** Pro device limit defaults to whatever `config.license.maxDevicesPerUser` is set to today (typically 2); revisit per-tier limits when we ship multiple paid tiers (not in scope for Phase 2).

**D3. Phase 3 gating model → deferred.** `isUsable()` plus the `<LicenseGate>` scaffolding from P2.5 is enough for the first paid feature. Revisit once we know what we're gating.

**D4. Paddle → working test product exists.** P2.1 smoke testing can start as soon as Phase 1 ships, no Paddle setup blocker. Verify the test product still subscribes cleanly through the webhook as part of P2.1.

### Remaining work

#### P2.1 — End-to-end smoke test

Stand up `citadels.cc` (staging or prod) and run the full activate/verify/deactivate cycle from a fresh Citadel install. Document any bugs found and fix them. Until this is done, we don't actually know the integration works.

Tasks:
- Create test user with active subscription in Paddle test mode.
- From a fresh Citadel install, navigate to `/citadel-license`, sign in.
- Confirm token is written to `data/license.json`.
- Confirm `GET /api/citadel-license/status` returns `active`.
- Restart the backend; confirm `loadFromDisk()` rehydrates state correctly.
- Wait > 6h (or shorten the interval); confirm background `refresh()` runs.
- Cancel the Paddle subscription; confirm next refresh transitions state to `lapsed`.
- `DELETE /api/citadel-license/deactivate`; confirm device slot is freed in `citadels.cc/account`.
- Disconnect network; confirm 7-day grace period kicks in (or shorten via `CITADEL_LICENSE_GRACE_DAYS=0.001`).

Any bug found here gets a P2.1.x sub-task.

#### P2.2 — Activation banner + UX polish

Based on D1 (persistent dismissable banner, paid-only per D2):

- `CitadelLicenseBanner.jsx` shows on every dashboard page when state is `unactivated`. Two CTAs: **"Sign in to Citadel Cloud"** (opens activation modal) and **"Learn more"** (opens `https://citadels.cc/cloud` in default browser via `shell.openExternal`).
- Banner copy is positioned as marketing for an optional paid upgrade, not a gate. Tone: "Unlock global ban DB, off-site backups, and more with Citadel Cloud" — short, dismissable, not pushy.
- Banner is dismissable per session but reappears on next launch.
- When state is `grace`, banner shows "Citadel Cloud — working offline, last verified X days ago" with a "Reconnect now" button that triggers `POST /api/citadel-license/refresh`.
- When state is `lapsed` (subscription canceled or past_due past grace), banner shows non-dismissable "Citadel Cloud subscription inactive" with link to `citadels.cc/account`. Cloud features deactivate; local features keep working.
- `CitadelLicensePage.jsx` (the dedicated page) gets a polished "device list" section showing the current activation, last-seen-at, and a "Deactivate this device" button.
- Activation modal handles the `402 SUBSCRIPTION_INACTIVE` response gracefully: shows "No active Citadel Cloud subscription found on this account — visit citadels.cc/cloud to subscribe."

#### P2.3 — Telemetry hooks

This is where Phase 1's logging investment compounds. Add a thin telemetry sink:

- New file: `backend/lib/telemetry/index.js`
- Single function: `report(event, payload)` POSTs to `https://citadels.cc/api/v1/telemetry` (new endpoint to add to citadel-cloud).
- Auth: include the device's license JWT if activated; otherwise send anonymous with the machine-ID hash.
- Events to report:
  - `update.prompt-shown` — user saw a "restart to install" prompt
  - `update.install-clicked` — user clicked the button
  - `update.completed` — new version started successfully (reported on first boot of new version)
  - `update.failed` — new version did not start within 60s after restart (reported by old version on next launch via persisted state)
  - `license.activate.success` / `license.activate.failure`
  - `license.refresh.failure` (status=4xx/5xx, network)

This is what would have told us about yesterday's bug within an hour instead of via a customer ping.

**Privacy:** No PII. License email is not sent (we use the user UUID from the JWT). Machine-ID is sent hashed.

#### P2.4 — Migration UX for existing customers

Existing installs have **no** `data/license.json`. They start in `unactivated` state — fine, they keep working as today (D1.b banner). No data migration needed, no key reissue, no flag day.

The only non-trivial case is: "I already paid for Citadel before this existed." That's a support-only conversation today (we don't have any paid customers yet from Citadels.cc). When Phase 3 paid features ship, anyone with a pre-existing license gets a manual comp on the cloud account.

Action items:
- Add a "Migrate from local license" button on the dedicated page that's a no-op today but reserves the surface.
- Document the manual comp process in `docs/admin/license-comp.md` so it's not tribal.

#### P2.5 — Wire `isUsable()` (scaffolding only)

Don't gate anything in Phase 2. Just expose the helper to the rest of the codebase cleanly:

- Add `backend/middleware/require-license.js` that 402s on routes when `!license.isUsable()`. Don't apply it anywhere yet.
- Add a renderer-side hook `useLicenseStatus()` in `web/frontend/src/hooks/` that subscribes to `/api/citadel-license/status`.
- Add a `<LicenseGate>` React component that wraps a feature, shows an upgrade card if not usable. Don't wrap anything yet.

This means Phase 3 can introduce a paid feature in *one PR* by adding `requireLicense` to one route and `<LicenseGate>` around one component, instead of building the gate-system from scratch.

#### P2.6 — Delete the stub (also covered in P1.6 if we ship Phase 1 first)

If Phase 1 didn't already remove `desktop/src/license-client.js`, do it here.

### Acceptance criteria

- [ ] D1–D4 decisions documented in this file or a linked doc.
- [ ] Full activate/verify/deactivate cycle works against `citadels.cc` from a fresh Citadel install.
- [ ] Banner appears for unactivated users, dismissable per session.
- [ ] Banner correctly reflects `grace` and `lapsed` states.
- [ ] Telemetry endpoint live on Citadels.cc; events flowing for at least 7 days from at least 5 real installs.
- [ ] `useLicenseStatus()` hook and `<LicenseGate>` component exist, lint-clean, unused.
- [ ] `require-license` middleware exists, lint-clean, unused.
- [ ] Documentation: `docs/admin/license.md` describes activation, grace, deactivation, and the "I paid before this existed" comp process.

### Out of scope for Phase 2

- Any actual paid feature.
- Any feature-flag/entitlement system more complex than `isUsable()`.
- Any change to the Citadels.cc Paddle product structure beyond confirming a working test product (D4).
- 2FA on Citadels.cc accounts (the schema scaffolds it but full UX is its own project).
- Citadels.cc account UI changes beyond "device management already works".

---

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The v2.7.0 → v2.7.x update itself hits the bug for current users | High | Medium | Release notes with explicit "manually relaunch" instructions; Discord post |
| `nssm stop CitadelServer` hangs indefinitely on a corrupted service state | Low | High | Hard timeout in `stopServiceGracefully()`, force-kill PowerShell fallback in NSIS |
| Citadels.cc API has bugs we'll only find via P2.1 smoke testing | Medium | Medium | Allocate a buffer week in Phase 2 timeline; bugs found there block P2.2 onward |
| Customers reject account-based licensing on privacy grounds | Low | Medium | Phase 2 keeps it 100% optional (D1=b banner is dismissable); make the data we send obvious in `docs/admin/license.md` |
| Update telemetry endpoint goes down and we silently lose data | Medium | Low | Buffer events to a local file with 100-event cap; flush on next successful POST. Don't block UX on telemetry. |
| Paddle product not configured / billing webhook misfires | Medium | Medium | D4 decision before P2.1 starts. P2.1 smoke test catches anything that survives D4. |

---

## Open questions for Kurt

All Phase 1 / Phase 2 decisions are resolved. Remaining open questions are forward-looking only.

1. **Phase 3 first feature** — Global ban DB was the chosen direction during planning. Confirm that's still the call once Phase 2 lands, or revisit then based on what real customers ask for once they're activated and we have telemetry.
2. **Pricing** — Citadel Cloud is paid only (D2). What's the actual monthly price? $5? $10? $15? Per-server pricing or flat? Not blocking Phase 2 since the Paddle test product covers smoke testing, but needed before any public launch in Phase 3.
3. **Free trial?** — Optional 7- or 14-day free trial of Citadel Cloud. Not the same as a "free tier" — it's a time-limited paid-tier experience that converts to paid or expires. Common in SaaS; reduces sign-up friction. Decide during Phase 3 pricing work, doesn't block Phase 2.
4. **Multi-tier pricing?** — Single "Citadel Cloud" tier vs Pro/Team/Enterprise. Single tier is simpler and matches your customer base (small server communities). Multi-tier only makes sense if you find a feature large communities will pay 5–10x more for. Defer to Phase 3+.

---

## Out of scope (deferred to later plans)

- Phase 3: first paid feature (global ban database).
- Phase 4: any further paid features (off-site backups, cross-machine config sync, etc.).
- Citadel Agent + cloud panel architectural rewrite (the "Pterodactyl model" discussed in chat). Not on the roadmap. Revisit only if customer demand for cloud-hosted shifts that calculus.
- Linux support for Citadel itself.
- Code signing of the NSIS installer.
- 2FA for Citadels.cc accounts.

---

## Milestones

| Milestone | Target | Blocker |
|---|---|---|
| Phase 1 patches merged | Day 2–3 | None |
| Phase 1 v2.7.x released | Day 4–5 | Manual testing on two Windows versions |
| ~~D1–D4 answered~~ | ~~Day 5~~ | **Done 2026-04-28** |
| P2.1 smoke test passing | Day 7–9 | Phase 1 shipped; Paddle test product (already exists per D4) |
| P2.2 banner UX merged | Day 10–13 | P2.1 |
| P2.3 telemetry live | Day 13–16 | New `/api/v1/telemetry` endpoint on citadel-cloud |
| Phase 2 acceptance criteria met | Day 17 | All above |
