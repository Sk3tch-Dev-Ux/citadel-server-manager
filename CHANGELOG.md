# Changelog

All notable changes to Citadel are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The current released version on the public GitHub Releases feed is
v2.7.0. Versions below this line are queued for release — the dates
reflect when the work landed in the repo, not when the build went out.

---

## Unreleased — Citadel Cloud (Phase 3)

This release introduces **Citadel Cloud**, an optional **+$10/month**
subscription that adds on top of your Citadel subscription. The flagship
feature is the Global Ban Database — every Citadel Cloud customer
contributes their bans to a shared pool, and your server is automatically
protected against everyone else's known cheaters.

### Added
- **Global Ban Database** — a network-wide cheater pool with a 3-vouch
  threshold before any submission propagates. Surgical `ban.txt` updates
  on each managed server; never stomps on your local bans.
- **Trust & safety system** — per-customer reputation with vouch_weight,
  automatic 0.7× penalty per overturn, auto-lock at 30%+ overturn rate,
  configurable rate limits (default 50/24h, 1000/30d).
- **Public appeals flow** — banned players file appeals at
  `citadels.cc/appeal/<steamid>`. Moderator decisions cascade to the
  network within an hour.
- **Admin moderation queue** at `citadels.cc/admin/cloud-bans/queue`.
- **`/global-bans` dashboard page** — sync status, manual sync, filterable
  list of community bans currently protecting your server.
- **Loss-aversion banner** on subscription lapse showing how much
  community protection is about to disappear.
- **Two-product entitlement model** — license JWT carries
  `entitlements: ['citadel'] | ['citadel', 'cloud']`. Server middleware
  `requireLicense({ feature: 'cloud' })` and frontend `<LicenseGate
  feature="cloud">` gate paid features at both layers.
- **Account page Cloud subscription card** at `citadels.cc/account` for
  self-serve management.

### Changed
- `paddle-webhook.routes.ts` now routes subscription events to either
  the `subscription_*` (Citadel) or `cloud_subscription_*` (Cloud)
  column group based on `price_id`. Unknown price IDs are refused.
- License `/activate` and `/verify` responses now include an
  `entitlements` array and `cloudSubscription` block.
- `/api/v1/auth/me` exposes Cloud subscription state alongside the
  base Citadel state.

### Deployment notes
- New env vars: `NEXT_PUBLIC_PADDLE_PRICE_CLOUD_MONTHLY` (browser),
  `PADDLE_PRICE_CLOUD_MONTHLY` (server), plus optional Cloud Bans
  tuning vars (`CLOUD_BANS_VOUCH_THRESHOLD`, `CLOUD_BANS_RATE_LIMIT_*`,
  etc — see `packages/api/src/config.ts`).
- New tables: `community_bans`, `ban_submissions`, `ban_appeals`,
  `ban_audit_log`, `customer_submission_stats`, `telemetry_events`.
- New columns on `users`: `paddle_cloud_subscription_id`,
  `cloud_subscription_status`, `cloud_subscription_renews_at`,
  `cloud_subscription_cancel_at`, `cloud_trial_ends_at`.
- See `docs/admin/PRODUCTION-DEPLOYMENT.md` for the full ordered
  deployment runbook.

---

## Unreleased — Citadel Cloud licensing rollout (Phase 2)

Wired the previously-built license/auth layer into the desktop app and
shipped the diagnostic telemetry pipeline that catches future issues
in production.

### Added
- **Activation flow on the dashboard** at `/citadel-license` — sign in
  to your Citadels.cc account, persistent token cache, 7-day offline
  grace window, hourly background re-verification.
- **License banner** with five distinct states (unactivated, grace,
  past_due, lapsed, expired). Marketing variant for unactivated users
  is dismissable per session.
- **Diagnostic telemetry** — events buffered to
  `data/telemetry-queue.json`, flushed every 30s to citadels.cc.
  Opt-out toggle on the Citadel Cloud page; clearly disclosed.
  Allowlisted event names; private notes never leave your machine.
- **Help → Show Update Log** menu item that opens
  `%APPDATA%/Citadel/update.log` for support diagnostics.
- **`<LicenseGate>` and `useLicenseStatus` scaffolding** for future
  paid features.

### Removed
- `desktop/src/license-client.js` — Phase 1 stub. The dashboard talks
  directly to the backend's `/api/citadel-license/*` REST endpoints; no
  separate desktop client needed.

---

## v2.7.x — Auto-update reliability (Phase 1)

Fixes the auto-update relaunch failure observed on 2026-04-27, where
clicking "Restart to install" left users with a stopped Electron app
that needed manual relaunch.

### Fixed
- **Auto-update relaunch** — the desktop now stops `CitadelServer`
  gracefully before `quitAndInstall`, schedules `app.relaunch()` as a
  fallback in case NSIS skips `LaunchDashboard` on silent installs, and
  bumps NSSM's `AppThrottle` from 5s to 15s to accommodate cold-disk
  starts on slower machines.
- **NSIS installer** stops the running service explicitly before file
  overwrites, force-killing any orphan `node.exe` processes still
  rooted in the install dir.

### Added
- **Persistent update log** at `%APPDATA%/Citadel/update.log` (1 MB
  rotation). Records every event in the auto-update flow so the next
  bug isn't a black box.
- **`npm run service:repair`** — resets NSSM's failure counter and
  attempts a clean restart for customers stuck in NSSM's back-off
  state. Use after a confirmed-failed update.

### Notes
- The v2.7.0 → v2.7.x update itself goes through the broken code path
  one last time. If your app doesn't relaunch after the update, open
  Citadel from the Start Menu — that's the bug we just fixed and you
  only see it once.

---

## v2.7.0 and earlier

See git history for changes prior to this CHANGELOG.
