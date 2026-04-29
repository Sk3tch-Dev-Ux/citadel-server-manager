# Citadel Roadmap — Phases 1 & 2

**Owner:** Kurt
**Last updated:** 2026-04-28
**Scope:** Auto-update reliability (Phase 1) and Citadel-Cloud license rollout (Phase 2). Phase 3+ (paid features, starting with the global ban database) is deferred to a separate plan once Phase 2 is in customers' hands.

---

## Product model (read this first)

*(Revised 2026-04-29: Citadel and Citadel Cloud are separately billed products, not a free-vs-paid split.)*

Citadel ships as two **separately billed products** that customers can subscribe to independently:

- **Citadel** (the desktop app + local backend in this repo) — **$14.99/month** (or $149.99/yr). Required to use the app at all; activation against citadels.cc validates an active Citadel subscription. This is the existing product and the existing Paddle product.
- **Citadel Cloud** — **+$10/month** add-on on top of Citadel. Optional second subscription that unlocks cloud-only features (Phase 3+: Global Ban Database, plus future cloud-only tooling). Includes a 7-day free trial. Customers must hold a Citadel sub to activate; Cloud-only is impossible by design.

The license JWT carries an `entitlements: ['citadel'] | ['citadel', 'cloud']` claim. Server-side gating (`requireLicense({ feature: 'cloud' })`) and frontend gating (`<LicenseGate feature="cloud">`) read this claim and 402 / show the upgrade card respectively. Subscription state is tracked on the `users` table in two parallel column groups: `subscription_*` (Citadel) and `cloud_subscription_*` (Cloud). The Paddle webhook handler routes incoming events to the correct columns based on `price_id`.

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

**D2. Citadel Cloud → separate paid product, +$10/mo on top of Citadel.** *(Revised 2026-04-29: this clarifies an earlier framing that implied Citadel was free. It isn't — Citadel is the existing $14.99/mo product. Cloud is a SECOND subscription.)* The existing `/api/v1/license/activate` endpoint already requires an active Citadel subscription (returns 402 otherwise). Phase 3+ adds an entitlement model so Cloud features can be gated independently — see the Product model section above for the entitlement claim shape and the Phase 3 implementation milestones for schema/JWT/webhook changes.

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

Phase 1, Phase 2, and Phase 3 product decisions are all resolved. See "Phase 3" below for the resolved Phase 3 product shape. Remaining open questions are policy-level decisions that surface during Phase 3 implementation.

1. **Multi-tier pricing?** — Single "Citadel Cloud" tier at $10/mo vs Pro/Team/Enterprise. Single tier matches the small-community customer base. Multi-tier only makes sense if a future feature justifies a 5–10× higher price point for larger communities. Defer.
2. **Trust & safety appeals reviewer** — Phase 3 ships an appeals queue. Who reviews? You alone (manageable at low volume), Kurt + 1–2 trusted community admins, or hold appeals for batched review? Defer until customer volume tells us the appeal rate.
3. **Ban category granularity** — Phase 3 ships with `cheating | griefing | exploiting | other` as the four categories. May need to split (DayZ has its own taxonomy: combat-logging, bambi-killing, base-griefing, dupe-exploits, hacking…). Watch what categories get used and split if needed.

---

## Out of scope for Phases 1 & 2 (handled separately)

- Phase 3: Global Ban Database (full plan below).
- Phase 4+: any further paid features (off-site backups, cross-machine config sync, etc.).
- Citadel Agent + cloud panel architectural rewrite (the "Pterodactyl model" discussed in chat). Not on the roadmap. Revisit only if customer demand for cloud-hosted shifts that calculus.
- Linux support for Citadel itself.
- Code signing of the NSIS installer.
- 2FA for Citadels.cc accounts.

---

# Phase 3 — Global Ban Database (first paid feature)

**Goal:** Ship a feature people actually pay for. Citadel Cloud customers contribute their local server bans to a shared community pool; their servers are then automatically protected against everyone else's known cheaters. The classic network-effect feature — every new subscriber makes the product better for every existing subscriber.

**Target ship:** 4–6 weeks after Phase 2 lands. Larger and riskier than Phase 1 or 2 because of the trust & safety surface.

## Decisions (resolved 2026-04-29)

**Pricing → $10 USD / month.** Single tier. Per-account, not per-server (a customer with 5 servers pays once and gets protection on all of them). Paddle product needs to be configured to match; the existing test product (D4) suffices for development.

**Trial → 7 days, time-only, full access.** Standard SaaS trial pattern. New signups get unrestricted ban DB access (read + submit) for 7 days, then the feature locks unless they convert. No payment-method-required gate for signup — keep friction low; convert via product value, not commitment psychology.

**Vouching threshold → 3 independent submissions.** A SteamID is added to the community ban list only after 3 different customer accounts have banned that player on their own server. This filters most bad-faith bans because coordinating 3 servers is real effort. Trial users' submissions count toward the threshold (they're real DayZ admins, just unpaid for now), but only paying customers can pull the full community list.

**Trust & Safety policy is a first-class concern, not a backlog item.** The full trust model lives in this plan, not in a "we'll figure it out" comment. See the dedicated section below.

## Product surfaces

**Customer-facing in the Citadel dashboard:**
- New page: `/global-bans` — protected by `<LicenseGate feature="Global Ban Database">`. Shows: total community bans currently protecting this server, recent additions, the customer's own contribution count, sync status. CTA to citadels.cc/cloud for non-subscribers.
- Existing per-server `/bans` page gets a "Submit to community ban DB" toggle on each ban (defaults on for paying customers). Each ban shows whether it's been propagated and how many vouches it has.
- Subscription card on `/citadel-license` adds "Global Ban Database — Active / In trial / Not subscribed" with days-remaining countdown during trial.
- Banner appears for `lapsed` subscribers showing how many community bans were keeping their server clean ("X cheaters auto-blocked this month") with a re-subscribe CTA. Loss-aversion is the strongest conversion lever for SaaS churn.

**Banned-player-facing on citadels.cc:**
- `/appeal/<token>` — public page where a banned player can submit an appeal. Token is the SteamID hash so they can find it without authentication. Auto-replies on submission. No exposed customer/admin identity in the appeal flow.

**Admin-facing on citadels.cc:**
- `/admin/cloud-bans/queue` — moderation queue showing bans that have been appealed, bans flagged by automation, and any ban with vouches > 50 (community-wide impact threshold). You decide upheld / overturned.
- `/admin/cloud-bans/customer/<id>` — submitter reputation page. Shows a customer's submission history, overturn rate, current vouch_weight. Key for catching bad-faith mass-banners before they poison the well.

## Trust & Safety policy (this is the spec, not a wishlist)

Every paid customer's submissions carry a `vouch_weight` decimal that starts at `1.0`. The vouching threshold is `3.0` cumulative vouch_weight, not 3 raw submissions. This lets us de-rank bad-faith submitters without binary-banning them.

**Vouch weight starts at 1.0 and adjusts as follows:**
- Submission successfully propagates and never gets appealed: no change (still 1.0).
- Submission gets appealed-and-overturned: that submission's vouch_weight drops to 0 retroactively (so the community ban may un-meet the threshold and auto-revert), and the customer's *future* submissions multiply by 0.7. Three overturns drops them to 0.343 (effectively requires 9+ co-signers per submission to reach threshold).
- Submission gets appealed-and-upheld: no change.
- Customer's overturn rate exceeds 30% over their last 20 submissions: vouch_weight clamped to 0 indefinitely, requires manual reinstatement.

**Per-customer rate limits:**
- 50 submissions per rolling 24h. Catches mass-ban abuse without inconveniencing legit busy admins.
- 1000 submissions per month. Backstop for slow-drip bad actors.
- Configurable per customer if a legit big-server community needs more — done via citadels.cc admin.

**Ban categories** (`reason_category`): `cheating`, `griefing`, `exploiting`, `other`. The category is shared, but the customer's free-text "notes" field is private to that customer — it never enters the community feed. Avoids accidental PII (customer notes often contain "this player keeps killing my friend Mark on Tuesdays" — that's not network-shareable).

**Auto-expiry:** community bans drop off after 12 months of no fresh submissions. Cheaters get banned by some new admin almost immediately if they're still active; bans that go stale are usually reformed players. Reduces the false-positive blast radius over time.

**Audit log:** every submission, every appeal, every moderator action goes into an immutable `ban_audit_log` table. Retention: forever. This is the ground truth if a customer ever disputes an action.

**Appeals process:**
1. Banned player visits `citadels.cc/appeal/<steamid_hash>`. Page shows: ban category, vouch count, how to appeal. No customer identities exposed.
2. They submit reason + evidence + reply email.
3. Appeal goes into `ban_appeals` table with status `open`. Auto-replies "we'll get back to you within 7 days."
4. Moderator (initially you) reviews. Can mark `upheld` or `overturned`.
5. If overturned: ban status flips to `overturned`, propagates back to all customer servers via the next sync, vouch_weights of contributing submissions get adjusted per the policy above.
6. Auto-reply to appellant with the decision.

**Customer can unenroll their own submission** at any time without penalty. UI on `/global-bans` shows their submitted bans with an "Unsubmit" button. Use case: customer realizes they wrongly banned someone — they can fix it instantly without filing an appeal.

## Schema additions on citadels.cc

```ts
// packages/api/src/db/schema/community-bans.ts
community_bans (
  id uuid pk,
  steam_id varchar(20) not null unique,        // No PII; SteamIDs are public.
  reason_category varchar(32) not null,        // 'cheating' | 'griefing' | 'exploiting' | 'other'
  vouch_count_total int not null default 0,    // Denormalized count of accepted submissions
  vouch_weight_total decimal(8,3) not null default 0,  // Sum of submitter weights
  status varchar(32) not null default 'pending', // 'pending' | 'active' | 'overturned' | 'expired'
  first_submitted_at timestamptz not null,
  last_submitted_at timestamptz not null,
  activated_at timestamptz,                    // When threshold first reached
  expires_at timestamptz,                      // 12 months after last submission
  manual_review_required boolean default false, // Auto-set when vouch_count > 50
)

ban_submissions (
  id uuid pk,
  community_ban_id uuid fk -> community_bans.id,
  user_id uuid fk -> users.id,
  device_id uuid fk -> devices.id,
  steam_id varchar(20) not null,
  reason_category varchar(32) not null,
  notes_local text,                            // Customer's private note, NEVER shared
  vouch_weight_at_submit decimal(5,3) not null,
  submitted_at timestamptz not null,
  unenrolled_at timestamptz,                   // Set when customer revokes
)

ban_appeals (
  id uuid pk,
  community_ban_id uuid fk,
  appellant_steam_id varchar(20),
  appellant_email varchar(255),
  reason text,
  evidence text,
  status varchar(32) default 'open',           // 'open' | 'upheld' | 'overturned' | 'dismissed'
  reviewer_user_id uuid fk -> users.id,
  reviewed_at timestamptz,
  decision_notes text,
  created_at timestamptz default now(),
)

ban_audit_log (
  id uuid pk,
  actor_type varchar(32),                      // 'customer' | 'moderator' | 'system' | 'appeal'
  actor_id uuid,                               // user_id or null
  action varchar(64),                          // 'submit' | 'unenroll' | 'overturn' | 'auto-expire' | etc.
  community_ban_id uuid,
  payload jsonb,                               // Full snapshot for forensics
  occurred_at timestamptz default now(),
)

customer_submission_stats (                    // Denormalized for fast lookup
  user_id uuid pk fk,
  vouch_weight decimal(5,3) not null default 1.0,
  total_submissions int default 0,
  total_overturns int default 0,
  submissions_last_24h int default 0,
  submissions_last_30d int default 0,
  weight_locked boolean default false,         // Manually set during moderation
  updated_at timestamptz default now(),
)
```

## API endpoints

**citadels.cc → desktop (paid customers):**

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/cloud-bans/submit` | Body: `{ steamId, reasonCategory, notesLocal? }`. Auth: license JWT. Rate-limited per the policy. Returns the resulting `community_ban` record. |
| `POST` | `/api/v1/cloud-bans/unenroll` | Body: `{ steamId }`. Auth: license JWT. Soft-deletes the customer's submission, recalculates threshold, propagates if necessary. |
| `GET`  | `/api/v1/cloud-bans/sync` | Returns all `status='active'` bans. Paginated (cursor-based). Auth: license JWT. Trial users get unrestricted access. |
| `GET`  | `/api/v1/cloud-bans/check?steamId=X` | Single-record lookup, used for on-demand checks during player connect. |
| `GET`  | `/api/v1/cloud-bans/stats` | Public-ish — total bans, contributing servers, bans-per-week trend. Used for marketing on citadels.cc/cloud. |

**citadels.cc → public (no auth):**

| `POST` | `/api/v1/appeals` | Banned player submits appeal. |
| `GET`  | `/api/v1/appeals/<token>` | Status check by token. |

**citadels.cc → admin (admin role required):**

| `GET`  | `/api/v1/admin/cloud-bans/queue` | Moderation queue. |
| `POST` | `/api/v1/admin/cloud-bans/<id>/review` | Body: `{ decision, notes }`. Triggers downstream propagation. |
| `GET`  | `/api/v1/admin/customers/<id>/reputation` | Per-customer reputation page. |

**Desktop (DayzServerController) → its dashboard:**

| `GET`  | `/api/cloud-bans/status` | Sync state + stats. |
| `POST` | `/api/cloud-bans/sync` | Force-trigger a sync from citadels.cc. |
| Existing `/api/bans/*` | Augmented to merge community bans into local enforcement. |

## Desktop integration

The local backend gets a new module `backend/lib/cloud-bans/`:

- `index.js` — public API, exposes `getCommunityBans()`, `submitBan(steamId, category, notes)`, `unenrollBan(steamId)`, `startBackgroundSync()`.
- `client.js` — HTTP client to citadels.cc cloud-bans endpoints (mirrors the pattern of `lib/license/client.js`).
- `cache.js` — persists pulled bans to `data/cloud-bans-cache.json`. Fetches the full list on first sync, then deltas hourly. Cache survives restarts.
- `enforcer.js` — hooks into the existing ban manager. When a player connects, check both local bans and community bans. Inject community bans into the BattlEye `bans.txt` at server start.

Sync cadence: every 1 hour by default, configurable per customer. Cached locally so a temporary network outage doesn't unprotect the server. Expired/overturned bans are removed from the cache on the next successful sync.

Submission is automatic for paying customers when they ban a player via the dashboard's `/bans` page (toggle defaults on; can be turned off per-ban for sensitive cases). Trial users get a prompt: "Submit this ban to the community DB? It'll help other servers protect themselves." opt-in during trial.

## Dashboard UI work

- New page at `/global-bans` (lazy-loaded, gated with `<LicenseGate feature="Global Ban Database">`).
- Augment `/bans/*` per-server pages with community-ban indicator + "submitted by you" / "submitted via community" / "overturned" badges.
- Banner additions for the customer-card on `/citadel-license`: trial countdown, "X bans currently active on your server."

## Pricing & Paddle setup

- Configure a $10/mo product on Paddle (production, not just test).
- Configure a 7-day trial on the subscription product.
- Citadels.cc Paddle webhook needs to handle `subscription.trialing` → mark user's `subscription_status='trialing'` (treated as `active` by `canUseLicense`).
- Webhook needs to handle `subscription.trial_ended_no_payment` → flip to `lapsed`.
- License JWT gains a claim `entitlements: ['cloud-bans']`. Phase 3 adds the entitlement check in `require-license` middleware: `requireLicense({ feature: 'cloud-bans' })`. Future paid features add to the entitlements list.

## Marketing surface (citadels.cc/cloud)

The CTA the Phase 2 banner already points at needs to actually exist:

- Hero: "Citadel Cloud — block known cheaters across the entire DayZ admin network."
- 3-bullet feature explanation.
- Live stats from `/api/v1/cloud-bans/stats` (X bans, Y servers, Z cheaters blocked this week).
- Pricing card: $10/mo, 7-day free trial, no credit card required to start.
- "How it works" section explaining the vouching model in plain English.
- Trust & safety section explaining the appeals process — important for legitimacy.
- Sign-up CTA → existing citadels.cc auth flow.

## Operational runbook (you'll need this on day 1)

- **A customer reports their player was wrongfully banned community-wide.** Tell them to direct the player to `citadels.cc/appeal/<steamid_hash>`. Don't intervene as the customer; appeals must come from the affected player or the policy stops working.
- **An appeal lands in the queue.** Default SLA: 7 days. Aim for 48h during early stages when appeal volume is low. Decision flows through `POST /admin/cloud-bans/<id>/review`.
- **A customer mass-bans 50 innocents in a day.** Rate limit catches them at submission 51. Their next 49 submissions get queued for manual review automatically. Investigate via `/admin/customers/<id>/reputation`. If confirmed bad-faith: lock their `vouch_weight` to 0 and consider ToS termination.
- **Citadel Cloud is unavailable for >1 hour.** Customer servers continue protecting against the cached community ban list. New bans don't propagate until the cloud is back. No customer impact for the unavailability window itself.

## Acceptance criteria

- [ ] $10/mo Paddle production product live + 7-day trial configured.
- [ ] All five new tables migrated on citadels.cc.
- [ ] Submit/unenroll/sync/check endpoints implemented + rate-limited.
- [ ] Appeals public submission flow + admin review queue functional.
- [ ] Audit log captures every submission, unenroll, appeal, moderator decision.
- [ ] Vouch_weight adjustment logic + per-customer rate limits implemented and tested.
- [ ] Customer reputation page renders correctly for at least 3 test users.
- [ ] Local `backend/lib/cloud-bans/` module syncs hourly + enforces against local + community list.
- [ ] `/global-bans` page exists, gated, shows real numbers.
- [ ] `citadels.cc/cloud` marketing page exists and converts.
- [ ] Telemetry events added for `cloud-bans.submit`, `cloud-bans.sync.*`, `cloud-bans.unenroll`. (And the desktop `update.*` events deferred from P2.3 finally land.)
- [ ] One paying customer end-to-end: signs up, takes 7-day trial, converts, submits a ban, sees it propagate, receives an appeal on it, decision flows through.

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bad-faith mass-banners poison the DB | Medium | High | 3-vouch threshold + per-customer rate limits + reputation system + manual review for high-vouch bans |
| First overturn-of-an-active-ban is operationally messy | High | Medium | Simulate the overturn flow in staging before launch; runbook above; auto-replies to appellants and submitters |
| Customers submit bans containing PII in notes | Medium | High | `notes_local` is never shared; only `reason_category` propagates. Schema enforces this at the DB level. |
| Appeal volume exceeds reviewer capacity | Low at launch, Medium later | Medium | Auto-batch appeals weekly initially; if volume grows, hire 1–2 trusted community admins as moderators; eventually consider reputation-weighted automated decisions for low-stakes categories |
| A subscriber cancels and loses ban DB → cheaters return | Expected | Conversion lever | Loss-aversion banner on `lapsed` (already in plan); telemetry on the cancel→return cycle |
| Steam IDs change format / Steam API changes | Low | Medium | Store SteamIDs as `varchar(20)` (handles both Steam2 and Steam64); convert at boundaries |
| EU GDPR concerns with shared ban data | Medium | Medium | SteamIDs are public-by-design (Steam itself publishes them). Privacy review during Phase 3 — may need a "right-to-be-forgotten" deletion path tied to the appeal flow. |

## Milestones

| Milestone | Target | Blocker |
|---|---|---|
| Schema + migrations on citadels.cc | Day 5 | None |
| Submit/sync/check endpoints + rate limits | Day 12 | Schema |
| Audit log + reputation system | Day 16 | Endpoints |
| Local `backend/lib/cloud-bans/` module + enforcement | Day 22 | Endpoints |
| `/global-bans` dashboard page + LicenseGate | Day 26 | Local module |
| Appeals public flow | Day 30 | Schema |
| Admin moderation queue | Day 34 | Appeals |
| Marketing page (`citadels.cc/cloud`) | Day 38 | None — can run in parallel |
| Paddle production product configured | Day 38 | None — small task |
| Desktop update telemetry wired (deferred from P2.3) | Day 40 | None |
| End-to-end paying-customer scenario | Day 42 | All above |
| Phase 3 acceptance criteria met | Day 42 | All above |

---

## Milestones

| Milestone | Target | Blocker |
|---|---|---|
| ~~Phase 1 patches merged~~ | ~~Day 2–3~~ | **Done 2026-04-28** (in workspace, awaiting Windows manual test) |
| Phase 1 v2.7.x released | Day 4–5 | Manual Windows testing on two versions |
| ~~D1–D4 answered~~ | ~~Day 5~~ | **Done 2026-04-28** |
| ~~P2.2 banner UX merged~~ | ~~Day 10–13~~ | **Done 2026-04-29** — paid-only copy, 5-state banner, dismissable |
| ~~P2.3a backend telemetry module~~ | ~~Day 13–16~~ | **Done 2026-04-29** |
| ~~P2.3b citadels.cc /telemetry/events~~ | ~~Day 13–16~~ | **Done 2026-04-29** — needs `drizzle-kit generate` |
| ~~P2.3c telemetry disclosure + toggle~~ | ~~Day 13–16~~ | **Done 2026-04-29** — on the license page |
| ~~P2.4 license docs~~ | — | **Done 2026-04-29** — `docs/admin/license.md` |
| ~~P2.5 require-license + LicenseGate scaffolding~~ | — | **Done 2026-04-29** |
| P2.1 smoke test (12 scenarios) | Day 7–9 | Manual run against live citadels.cc — checklist in `docs/admin/smoke-test-citadel-cloud.md` |
| Phase 2 acceptance criteria met | Day 17 | P2.1 smoke test + drizzle-kit generate + deploy |
