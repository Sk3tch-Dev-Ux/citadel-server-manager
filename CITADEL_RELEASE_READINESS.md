# Citadel — Unified Release Readiness Plan

**Date:** 2026-06-15
**Scope:** Citadel Server Manager (local agent, repo `DayzServerController` → rebrand) + Citadel Cloud (`citadel-cloud`)
**Decisions locked with owner:** Full rebrand to **Citadel Server Manager**; deliverable = this unified plan; scope = Agent + Cloud (Citadel Platform out of scope).
**Method:** Grounded in direct source verification (June 2026), reconciling the three pre-existing audit docs (`AUDIT_2026-06.md`, `PUBLIC_LAUNCH_AUDIT.md`, cloud `CLOUD_AUDIT_REPORT.md`) against current code. Findings carry `file:line` where they drive an action.

---

## ✅ Session progress — 2026-06-15 (overnight, autonomous)

All work below is committed on branch `claude/release-hardening-2026-06-15` in
**both** repos (nothing pushed). Gates run on the real Windows box.

**WS0 — Verify (DONE).** Ran every gate. Agent: **416 backend tests pass / 0
fail**, lint 0 errors, frontend builds. Cloud: **type-check 5/5 workspaces, lint
clean**. Fixed along the way:
- A stale security test that still asserted the old insecure discord-bot `['*']`
  default — rewritten to guard the least-privilege seed (was the 1 failing test).
- Cloud `@citadel/api` imported `@citadel/shared` as runtime values across 18
  files but never declared the dependency (worked only by hoisting) — declared
  it. Also diagnosed/repaired a broken Windows workspace symlink for `shared`.

**WS0b — Regression tests (DONE, agent side).** Added `tests/authz-regression.test.js`
(11 tests) locking in C1 (socket room scoping), C3 (any-of permission arrays),
C4 (server-scope resolver). C2/C5 are cloud-side where the repo has *no test
runner by policy* — covered by type-check + the audit's inspection.

**WS2 — Two-agent architecture (DONE, docs).** Named the `DayzServerController`
cloud-bridge as the authoritative `/ws/plugin` client; demoted `packages/plugin`
/`CitadelAgent.exe` to the standalone path with a status README + an
authoritative-client banner in `CITADEL_AGENT_ALIGNMENT.md` + a CLAUDE.md
correction. (Cross-repo protocol drift-check left as a noted follow-up.)

**WS3 — SaaS-hardening tail (DONE).** Shipped the two operator controls the
audit deferred, plus tests + a UI:
- **Remote-wipe gate** — cloud `wipe_ai`/`wipe_vehicles` denied unless the
  operator opts the server in (default off); restart/moderation unaffected.
- **PII opt-out** — player IP+GUID forwarding is now operator-toggleable
  (default on); both flags persist across a re-pair and are audited.
- New `PATCH /api/servers/:id/cloud-link/policy` + a Privacy & safety toggle
  section on the Cloud card. Tests: `cloud-link-policy.test.js`,
  `cloud-remote-wipe-gate.test.js`.
- **CC3** — fixed the last plaintext reset-token writer (a recovery-script bug
  where created users' set-password links never resolved). Column DROP migration
  remains a follow-up (not run blind without a test DB).

**WS1a — Safe visible rebrand (DONE).** Every operator-visible "Citadel Agent"
→ "Citadel Server Manager": dashboard (setup wizard, server hub, tab title),
desktop app (window/tray/menu/About/notifications), and the Windows service
*display* name. Machine anchors (service control name `CitadelServer`,
`C:\Citadel`, registry, `productName`/exe name, `CitadelSetup-*.exe`, GitHub
repo + auto-update feed, `FIXED_SALT`) deliberately left stable.

### Session 3 (2026-06-15, cont.) — roadmap items completed
- **FilesPage perf split — DONE.** Monaco lazy-loaded; initial chunk 3.78 MB → 15.9 KB.
- **WS1b installer rebrand — SCAFFOLDED.** All visible installer/packaging labels
  renamed; anchors kept stable; `WS1B_REBRAND_RUNBOOK.md` covers build-test + the
  repo-rename procedure. (Repo rename itself = your action.)
- **CC3 — DONE.** Plaintext `password_reset_token` column dropped (migration 0032);
  redaction destructure cleaned; type-check green.
- **WS4 — DONE (prep).** Audited the licensing path (clean — no CC1-style leak) and
  shipped `npm run preflight:billing` to validate live Stripe + license config.
- **WS5 — DONE (prep).** Fixed a code-signing **password leak** into CI logs;
  confirmed signing infra + `SIGNING.md` are ready (cert + 2 secrets to go).
  Reworked `backup-db.sh`/`restore-db.sh` for Coolify (they were broken — pointed
  at a removed container) + `DB_BACKUP_RUNBOOK.md` with a monthly restore drill.

### Still open (need YOUR action / a real environment)
- **GitHub repo rename + auto-update feed re-point** — the one irreversible step;
  exact procedure in `WS1B_REBRAND_RUNBOOK.md` (do not apply the ref edits before
  renaming, or live auto-updaters break).
- **Installer build-test** (`node installer/build.js`) — fresh install + in-place
  upgrade per the runbook. **FilesPage editor smoke-test** (open/edit/Ctrl+S).
- **WS4 live test** — run `preflight:billing` with live keys, then one real
  checkout → webhook → license activation on a clean machine.
- **WS5** — acquire an OV/EV code-signing cert + set the 2 GitHub secrets; enable
  Coolify scheduled backups to R2/B2 + run the first restore drill.
- Cross-repo protocol drift-check (tracked above).

---

## 0. Verdict

Citadel is **not a build-from-scratch effort — it is a verify-harden-rebrand-and-ship effort.** Both products are architecturally mature:

- **Agent (`DayzServerController` v2.25.0):** Node/Express + Socket.IO backend (~49 route modules), React/Vite dashboard, per-server Node sidecar, `@CitadelAdmin` EnScript mod, Electron desktop wrapper, NSIS installer registering a Windows Service (NSSM), HTTPS enforcement, RBAC with live token revocation, atomic symlink-safe JSON persistence, encrypted-at-rest credentials, BattlEye RCON auto-provisioning, firewall + backup management.
- **Cloud (`citadel-cloud`):** Fastify 5 + Next.js 15 + Postgres/TimescaleDB (Drizzle) + Redis, Stripe (sole processor — Paddle removed in PR #58), 2FA, fail2ban, the `/ws/plugin` telemetry protocol, Cloud Bans reputation system, marketplace. Deployed via Coolify.

The previously-documented critical security findings across both repos are **largely resolved in code**. What stands between today and a confident commercial launch is: **(1) runtime-verify the fixes that were never run, (2) execute the rebrand safely, (3) resolve one architecture ambiguity, (4) close a short tail of SaaS-hardening items, (5) productization polish (code signing, onboarding, observability, docs).**

**Realistic timeline to a paid public launch: ~3–4 focused weeks**, gated mostly by verification and the rebrand migration, not by missing features.

---

## 1. Current Security State (verified June 2026)

### Cloud — `CLOUD_AUDIT_REPORT.md` findings, re-verified against current source

| Finding | Severity | Status | Evidence |
|---|---|---|---|
| CC1 — Cloud Bans gated on wrong subscription column (revenue leak) | Critical | **FIXED** | `cloud-bans.routes.ts:79-81` now gates `cloudSubscriptionStatus`, 402 `CLOUD_SUBSCRIPTION_INACTIVE` |
| CC2 — Login/activate timing user-enumeration | Critical | **FIXED** | `auth.routes.ts:105-110`, `license.routes.ts:78-83` — constant-time `DUMMY_PASSWORD_HASH` |
| CC3 — Password-reset token stored unhashed | Critical | **FIXED** | Live flow uses `passwordResetTokenHash` (`auth.routes.ts:434-440`); plaintext col dropped via migration 0032; `scripts/recover-missing-user.ts` deleted (PR #58). No live path reads or writes the plaintext col. |
| CC4 — No rate-limit on `/license/activate` | Critical | **FIXED** | `license.routes.ts:70` `assertNotLocked` before lookup; Redis fail2ban |
| CC5 — Admin role trusted from JWT | High | **FIXED** | `admin.routes.ts:83,92` — role re-fetched from DB every request |
| CC6 — CORS wildcard allowed in prod | Low | **FIXED** | `config.ts:70-75` — boot guard refuses `CORS_ORIGINS=*` in production |

> **Net: 6/6 fixed.** CC3 fully resolved — plaintext column dropped (migration 0032) and `recover-missing-user.ts` deleted (PR #58).

### Agent + Cloud — `AUDIT_2026-06.md` findings C1–C6

All six are **fixed in code** but **NOT runtime-verified** (the audit was performed in a Linux sandbox over OneDrive-synced files that truncated on write; gates could not run). The fixes:

| # | Severity | Area | Fix applied | Verified? |
|---|---|---|---|---|
| C1 | High | Agent | Per-server Socket.IO rooms (`context.js` `emitServer` → `server:<id>`) — closes cross-tenant live-data leak | code only |
| C2 | High | Cloud | `serverId` binding on command-result settlement (`plugin-command-dispatch.ts`) — closes cross-tenant result spoof | code only |
| C3 | High | Agent | `auth()`/`authForServer()` accept any-of arrays (`middleware/auth.js` `roleHasPermission`) | code only |
| C4 | High | Agent | `/api/servers/:id` mutations use `authForServer`; list filtered by scope | code only |
| C5 | Medium | Cloud | Crypto secrets required when `NODE_ENV !== development` (`config.ts`) | code only |
| C6 | Medium | Agent | Cloud-issued commands written to audit trail (`cloud-bridge/commands.js`) | code only |

**Action: this is Workstream 0 — run the gates locally and confirm before anything else ships.**

---

## 2. Launch-Gating Decisions (resolved)

### 2.1 Architecture: the "two agents" — RESOLVED

There are two clients of the same cloud `/ws/plugin` protocol:

- **A — Authoritative / production:** `DayzServerController/backend/lib/cloud-bridge/` (in-process, runs inside the management app, started at `server.js:589`). Its own header (`ws-client.js:6`) states it was *"Ported from citadel-cloud/packages/plugin/src/ws-client.ts … mirrors that file 1:1."* It emits a **superset** of telemetry (agent_health, rcon_players, ban_list, kill, chat, death, player_stats_update) sourced from the `@CitadelAdmin` mod file-IPC.
- **B — Superseded prototype:** `citadel-cloud/packages/plugin` → `CitadelAgent.exe` (standalone, log-file-scraping). Still buildable, but functionally behind A and ambiguous in status.

**Decision:** A is authoritative. B should be **explicitly demoted** ("standalone telemetry-only agent for users without the management app") or **retired**. Do **not** merge codebases (different repos, ESM vs CJS, intentional). Reduce drift by treating `packages/shared/src/types/plugin.ts` as the single enforced contract and adding a CI drift-check against A's hand-port. Re-head `CITADEL_AGENT_ALIGNMENT.md` to name A as the live contract. → **Workstream 2.**

### 2.2 Brand & rename: "full rename" — with a mandatory safe-migration carve-out

Owner chose a **full rename to Citadel Server Manager**. Critical engineering nuance the rebrand must honor: the codebase **deliberately decouples user-visible branding from machine identifiers** (`installer/citadel.nsi:8-9` documents this). Renaming the machine anchors **orphans every existing install**. Therefore:

- **Rename freely (user-visible):** product name, window titles, installer labels, Start-Menu display text, UI copy, docs, marketing, About dialogs, the GitHub repo (with redirect + re-pointed URLs).
- **Keep stable (machine anchors) UNLESS you ship an explicit migration:**
  - Windows service name `CitadelServer` (`service-installer.js:27`, `install.ps1:22`, `desktop/src/auto-updater.js:61`, `citadel.nsi:147/221/349/358`)
  - Install dir `C:\Citadel` + registry `HKLM\Software\Citadel` (`citadel.nsi:36,37,85,197,400`) — the upgrade-detection anchors
  - `CitadelSetup-*.exe` filename (hardcoded in the agent self-update allowlist `agent-updater.js:31` + tests)
- **NEVER change:** `FIXED_SALT = 'CitadelDayzController-v1-credential-salt'` (`credential-encryption.js:23`) — a crypto domain-separation constant; changing it makes every user's stored encrypted credentials undecryptable. Likewise the `@CitadelAdmin` EnScript class names (`CitadelServerConfig` etc.) are unrelated to branding.

→ **Workstream 1.**

---

## 3. Prioritized Workstreams

Severity/effort legend — Effort: S (≤1 day), M (2–4 days), L (1–2 weeks).

### WS0 — Verify the unverified fixes  ·  **BLOCKER · Effort S**

Nothing ships on top of unverified security fixes. On the Windows target machine:

```bash
# Agent
cd DayzServerController/backend && npm test && npm run lint
cd ../web/frontend && npm run lint && npm run build
# Cloud
cd citadel-cloud && npm run build --workspace=@citadel/shared && npm run type-check && npm run lint
```

Then live-smoke the C1/C4 socket-scope fix (a `serverScope:[A]` user must receive **no** `server:B` events) and the C2 cloud command-result `serverId` rejection. Add the 5 regression tests named in `AUDIT_2026-06.md §9`. **Exit criteria:** green suites on Windows + the scoped-socket smoke test passes.

### WS1 — Rebrand to Citadel Server Manager  ·  **HIGH · Effort M**

Two tracks, run in order:

**1a — User-visible strings (safe, do first):**
- `desktop/package.json:29` `productName` → drives `CitadelServerManager.exe` *(decide: changing the exe name ripples into NSIS shortcut targets — see migration note below)*
- Window/tray/menu/About strings: `desktop/src/{main.js:44,tray.js,menu.js,ipc.js}`
- Installer labels: `installer/citadel.nsi:34,44-47,64,123,127,237,246,250`
- Frontend copy: `web/frontend/index.html:6`, `SetupWizardPage.jsx`, `ServerHubPage.jsx`
- Service **display** name (cosmetic, safe): `service-installer.js:28`, `install.ps1:23`
- README, docs, AUDIT/DEPLOY docs, marketing.

**1b — Identity & coupling (needs a migration plan):**
- **GitHub repo rename** `Sk3tch-Dev-Ux/DayzServerController` → new name. Re-point every hardcoded ref in one release *before* relying on the new name: `agent-updater.js:31`, `desktop/src/auto-updater.js:48-49`, `desktop/package.json:56-57`, `installer/build.js:553-554`, and **cloud** `config.ts:405` + `.env*.example` + the live Coolify `GITHUB_REPO`. Update the URL tests (`agent-updater.test.js`, `update-checker-url.test.js`). Rely on GitHub's rename redirect only as a transition cushion.
- **Service / install-dir / registry:** default recommendation — **keep `CitadelServer`, `C:\Citadel`, `HKLM\Software\Citadel` stable** (they're invisible to users; "full rename" is satisfied by every label the user actually sees). If you insist on renaming them, ship a one-time installer migration: stop+remove old service, register new; detect old install path and migrate `data/` + `.env`; this is **Effort L** and adds upgrade risk — not recommended for v1 of the rebrand.

**Exit criteria:** fresh install + an in-place upgrade from a current `C:\Citadel` install both succeed; auto-update (agent + desktop) pulls from the renamed repo; no orphaned service.

### WS2 — Resolve agent architecture ambiguity  ·  **MEDIUM · Effort S–M**

- Demote or retire `citadel-cloud/packages/plugin` (decision §2.1). Add a `README` stating its status; if retiring, remove from default build.
- Re-head `CITADEL_AGENT_ALIGNMENT.md` to name the `DayzServerController` cloud-bridge as the authoritative live contract.
- Add a CI contract-drift check: snapshot `packages/shared/src/types/plugin.ts` message shapes and fail if the agent's CJS port (`cloud-bridge/ws-client.js`) diverges. Removes the silent hand-port drift risk.

### WS3 — Finish the SaaS-hardening tail  ·  **MEDIUM · Effort M**

From `AUDIT_2026-06.md §8 "not yet done"` + CC3:
- **Destructive remote-action allow-list (Agent):** operator opt-in gate before cloud-issued `wipe`/`restart` execute (`cloud-bridge/commands.js`). Defense-in-depth if a cloud key is replayed.
- **Cloud-telemetry PII opt-out (Agent):** player IPs/GUIDs are forwarded every 30s (`forwarders.js:176`) with no local toggle. Add an opt-out surface — important for the privacy policy and EU customers.
- **CC3 (Cloud):** DONE — plaintext `passwordResetToken` column dropped (migration 0032); `scripts/recover-missing-user.ts` deleted (PR #58).
- **Least-privilege follow-through:** confirm the `discord-bot` seed ships least-privilege (done for fresh installs; legacy back-fill still `['*']` with a warning — schedule the back-fill tightening).
- **Production TLS scheme enforcement:** done on the WS client (rejects non-loopback `ws://`); confirm the agent panel fails loud (not silent HTTP downgrade) when prod TLS certs are unreadable (`server.js:108`).

### WS4 — Monetization & licensing readiness  ·  **HIGH · Effort M**

The plumbing exists (Stripe live — sole processor, Paddle removed in PR #58 — RS256 license JWTs, device cap, entitlements). Before charging money, verify end-to-end:
- Stripe **live** keys + webhook secret set on the live deploy; `STRIPE_PRICE_*` (Citadel monthly/yearly, Cloud monthly/yearly) populated; `STRIPE_TAX_ENABLED` decision once registrations are filed.
- License activation → desktop verification round-trip on a clean machine (24h license JWT, 4h for Cloud entitlement, 7-day offline grace, 2-device cap).
- Cloud entitlement gate confirmed (CC1 fixed) so Cloud Bans / Cloud console actually require the paid add-on.
- Trial flow (`STRIPE_CLOUD_TRIAL_DAYS`, single-use trial gate) tested for reuse abuse.
- Plugin API-key **rotation/revoke** path (flagged CH4 in cloud audit) — add a revoke endpoint so a leaked key doesn't require a password reset.

### WS5 — Productization polish  ·  **MEDIUM · Effort M–L (parallelizable)**

- **Code signing (Windows):** an unsigned installer triggers SmartScreen and reads as malware to server owners — a real conversion killer. Acquire an EV/OV code-signing cert; wire into `release.yml` (the optional signing hook already exists). High trust ROI.
- **Onboarding UX:** the setup wizard exists; do one end-to-end pass as a non-technical server owner (SteamCMD detect → install → first server → cloud pairing). Add empty/loading/error states where missing (frontend audit flagged a few).
- **Observability:** agent self-health metrics (already emits `agent_health` to cloud) surfaced in an admin view; cloud-side alerting on crash-restart loops / breaker trips.
- **Backup/DR (Cloud):** document and verify Coolify Postgres backup cadence + restore drill (flagged as a gap — no DR plan in docs today). TimescaleDB retention already configured.
- **Scale headroom (Agent, post-launch):** the named-pipe IPC + async-FS work from `PUBLIC_LAUNCH_AUDIT.md` is largely done (fs.watch bridge shipped); the remaining per-server-room socket flip is a clear, isolated follow-up. Not launch-blocking to ~20–50 servers/agent.
- **Docs:** consolidate user-facing docs (install, pairing, "what data leaves the box" / privacy, troubleshooting, SmartScreen). ToS/Privacy pages already exist on the cloud marketing site.

---

## 4. Suggested Sequencing

```
Week 1   WS0 (verify) ──┬─> WS2 (architecture cleanup)
                        └─> WS1a (user-visible rebrand strings)
Week 2   WS1b (repo rename + auto-update re-point, migration test)
         WS3 (SaaS-hardening tail)
Week 3   WS4 (monetization/licensing end-to-end on a clean machine)
         WS5 code signing + onboarding pass
Week 4   Release-candidate: full clean-install + in-place-upgrade test matrix,
         live Stripe smoke, go/no-go gate, soft launch.
```

WS5 docs/observability/DR run in parallel throughout.

---

## 5. Go-Live Gate (release checklist)

- [ ] WS0 gates green on Windows; scoped-socket + command-result smoke tests pass
- [ ] Fresh install **and** in-place upgrade from `C:\Citadel` both succeed; no orphaned service
- [ ] Agent + desktop auto-update pull from the renamed repo (old repo redirect verified)
- [ ] `packages/plugin` status decided (demoted/retired); alignment doc re-headed
- [x] CC3 plaintext column dropped (migration 0032) + `recover-missing-user.ts` deleted (PR #58); destructive-action allow-list + PII opt-out shipped
- [ ] Stripe live + webhooks verified; license activation round-trip on a clean machine; Cloud entitlement gate confirmed
- [ ] Installer code-signed; SmartScreen clean
- [ ] Non-technical onboarding pass completed; privacy/"data leaving the box" doc published
- [ ] Cloud Postgres backup + restore drill completed
- [ ] `npm audit` clean across all four agent trees + cloud (recurring release gate)

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Unverified C1–C6 fixes have a runtime regression | Med | High | WS0 first; add the 5 named regression tests |
| Rebrand orphans existing installs (service/dir/registry rename) | High if done naively | High | Keep machine anchors stable (§2.2) or ship migration + test in-place upgrade |
| Auto-update breaks on GitHub repo rename | High | High | Re-point all hardcoded refs in one release *before* renaming; rely on redirect only as cushion |
| Protocol drift between cloud `shared` types and agent CJS port | Med | Med | WS2 CI drift-check |
| Unsigned installer → SmartScreen → low conversion / "is this a virus" support load | High | Med | WS5 code signing |
| Cloud DB loss with no tested restore | Low | Critical | WS5 backup + restore drill |
| Plugin API key leak (no revoke path) | Low | Med | WS4 add key rotation/revoke endpoint |

---

*This plan reconciles `AUDIT_2026-06.md`, `PUBLIC_LAUNCH_AUDIT.md`, and `citadel-cloud/CLOUD_AUDIT_REPORT.md` against verified current source. Line references current as of 2026-06-15; re-check after intervening edits.*
