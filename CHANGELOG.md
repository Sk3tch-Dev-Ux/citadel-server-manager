# Changelog

All notable changes to Citadel are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## v2.16.0 — 2026-04-29

This release introduces **Citadel Cloud**, an optional **+$10/month**
subscription that adds on top of your Citadel subscription. The flagship
feature is the Global Ban Database — every Citadel Cloud customer
contributes their bans to a shared pool, and your server is automatically
protected against everyone else's known cheaters.

It also adds **CFTools banlist import** so existing CFTools customers
can bring their banlist with them when switching to Citadel.

**Important:** the dashboard talks to citadels.cc for license + cloud
endpoints. This release expects citadels.cc to be deployed with the
matching schema + Paddle product configured. If you self-host
citadels.cc, run `drizzle-kit migrate` before letting customers
upgrade. See `docs/admin/PRODUCTION-DEPLOYMENT.md`.

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

### Citadel Cloud licensing rollout

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

### CFTools banlist import (Phase 4)

Brings an existing CFTools-hosted banlist into Citadel's local ban
database in a single operation. Customer pastes their CFTools API
token from developer.cftools.cloud, picks a banlist ID or server ID,
and Citadel pulls every ban with a Steam64 in the record. No
credentials persisted; one-shot import. Documented in
`docs/admin/migrating-from-cftools.md`.

---

## v2.15.0 — Auto-update reliability + earlier

The auto-update relaunch fix (Phase 1) shipped in v2.15.0:
- Desktop stops `CitadelServer` gracefully before `quitAndInstall`,
  schedules `app.relaunch()` as a fallback when NSIS skips
  `LaunchDashboard` on silent installs, and bumps NSSM's
  `AppThrottle` from 5s to 15s for cold-disk starts.
- NSIS installer stops the running service explicitly before file
  overwrites and force-kills orphan `node.exe` processes.
- Persistent update log at `%APPDATA%/Citadel/update.log` (1 MB
  rotation) for diagnostics.
- New `npm run service:repair` resets NSSM's failure counter for
  customers stuck in back-off.

See git history (`git log v2.7.0..v2.15.0`) for the full set of
changes shipped between those versions.
