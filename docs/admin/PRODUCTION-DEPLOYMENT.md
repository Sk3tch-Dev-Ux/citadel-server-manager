# Production Deployment Runbook — Phases 1, 2, 3

This is the ordered runbook for going live with everything that has
landed in the repo. Follow it top to bottom; each section has a
**Verify** step you should not skip.

**Estimated time:** 3-4 hours of focused work, mostly manual testing
between deploy steps. Spread across 2-3 days if you want overnight
soak time at each gate.

**Touched repos:**
- `DayzServerController` (this repo) — desktop + local backend
- `citadel-cloud` — Citadels.cc Next.js + Fastify API + Postgres

---

## 0. Pre-flight

- [ ] Both repos clean: `git status` shows nothing uncommitted (commit
      everything in this branch first).
- [ ] Citadels.cc staging Postgres reachable from your dev machine.
      Production credentials available but **don't apply migrations to
      prod yet** — staging first.
- [ ] You have admin access to:
  - Paddle merchant dashboard (production)
  - The citadels.cc deployment surface (Vercel, Fly, whichever)
  - The citadels.cc database (psql or equivalent)
  - GitHub Releases for Sk3tch-Dev-Ux/DayzServerController
  - Discord (for the v2.7.0 → v2.7.x heads-up post)

---

## 1. Phase 1 — Ship the auto-update fix (v2.7.x)

This is the carryover from session 1. Ship it before anything else —
a Cloud release that goes through the v2.7.0 broken updater would
double-frustrate customers.

### 1.1 Bump version
- [ ] `package.json` → bump from `2.7.0` to `2.7.1`.
- [ ] `desktop/package.json` → same.
- [ ] Commit: `chore: bump to v2.7.1 for auto-update fix`.

### 1.2 Manual Windows test
- [ ] On a Windows 10 box: `git checkout v2.7.0`, `npm install`, build
      and install via the NSIS installer. Confirm Citadel runs.
- [ ] Now check out the v2.7.1 branch, build a fresh installer locally
      via `npm run build:installer`, place it where `electron-updater`
      will find it (or temporarily publish a pre-release on GitHub).
- [ ] On the v2.7.0 install: trigger update check, confirm the prompt
      appears, click Restart. **Watch:** does the new version come up
      automatically? Check `%APPDATA%/Citadel/update.log` for the full
      sequence.
- [ ] Run all six manual scenarios in `ROADMAP.md` Phase 1 → Testing.
- [ ] If anything fails, fix it before continuing. Don't ship a broken
      patch on top of a broken patch.

### 1.3 Tag and release
- [ ] `git tag v2.7.1 && git push origin v2.7.1`.
- [ ] GitHub Actions builds the NSIS installer and publishes the release
      with `latest.yml`.
- [ ] In the Release notes, paste the v2.7.1 section from `CHANGELOG.md`
      including the "one-time rough update" line.

### 1.4 Communications
- [ ] Pin a single Discord message in #announcements:
      > Citadel v2.7.1 is out — fixes the update relaunch issue some of
      > you hit. If your app doesn't restart automatically after this
      > update, open Citadel from the Start Menu. That's the last time
      > you'll need to do that.
- [ ] No customer email needed; Discord coverage is enough at this scale.

### Verify
- [ ] At least one customer reports a clean v2.7.0 → v2.7.1 update.
- [ ] No new "update broke my install" reports for 48h post-release.

---

## 2. Phase 2/3 — Citadels.cc backend prep (staging)

We deploy citadels.cc *before* the desktop side because the desktop
needs the new endpoints to talk to.

### 2.1 Environment variables (staging)
On the staging Citadels.cc deployment, add the following env vars. None
of these existed before Phase 2/3.

| Name | Value | Purpose |
|---|---|---|
| `CLOUD_BANS_VOUCH_THRESHOLD` | `3.0` (default) | Vouch_weight needed to propagate. Lower for early testing. |
| `CLOUD_BANS_RATE_LIMIT_24H` | `50` (default) | Per-customer 24h submission cap. |
| `CLOUD_BANS_RATE_LIMIT_30D` | `1000` (default) | Per-customer 30-day submission cap. |
| `CLOUD_BANS_OVERTURN_PENALTY` | `0.7` (default) | vouch_weight multiplier per overturn. |
| `CLOUD_BANS_OVERTURN_RATE_LOCK` | `0.30` (default) | Auto-lock at this overturn rate. |
| `CLOUD_BANS_OVERTURN_WINDOW` | `20` (default) | Window size for overturn rate calc. |
| `CLOUD_BANS_HIGH_IMPACT_THRESHOLD` | `50` (default) | Auto-flag for manual review at this many vouches. |
| `CLOUD_BANS_EXPIRY_MONTHS` | `12` (default) | Auto-expire stale bans after this many months. |

These all have sensible defaults in `config.ts`; only override if you
want different policy.

### 2.2 Generate migrations
- [ ] `cd citadel-cloud/packages/api`
- [ ] `npx drizzle-kit generate`

This will inspect the schema files and produce two migrations:
- One adding the `cloud_subscription_*` columns to `users`.
- One adding `community_bans`, `ban_submissions`, `ban_appeals`,
  `ban_audit_log`, `customer_submission_stats`, and `telemetry_events`.

(There may be one combined migration if drizzle-kit batches them; that's fine.)

- [ ] Review the generated SQL in `packages/api/src/db/migrations/` —
      drizzle-kit's diffs are usually correct but worth a 30-second skim
      to catch anything weird.
- [ ] Commit the generated migrations + snapshot:
      `git add packages/api/src/db/migrations/ && git commit -m "feat: add cloud subscription, community bans, telemetry schema"`.

### 2.3 Apply migrations to staging
- [ ] `npx drizzle-kit migrate` against the staging DATABASE_URL.
- [ ] Verify with `\d users` and `\dt` in psql — new columns and tables
      should be present.

### 2.4 Deploy citadel-cloud to staging
- [ ] Standard deploy of the Fastify API + Next.js web.
- [ ] Confirm `https://staging.citadels.cc/api/v1/cloud-bans/stats`
      returns `{ activeBans: 0, ... }` (the public endpoint, no auth).

### Verify
- [ ] `curl -i https://staging.citadels.cc/api/v1/cloud-bans/stats` → 200.
- [ ] Postgres shows the new tables. `SELECT count(*) FROM community_bans` → 0.
- [ ] No error spam in the API logs.

---

## 3. Configure Paddle (sandbox first)

The Cloud add-on product needs to exist in Paddle before any of the
checkout flows work end-to-end.

### 3.1 Sandbox first
- [ ] In Paddle sandbox: create a new "Citadel Cloud" product at
      $10/month with a 7-day trial period. Save the price ID.
- [ ] Verify the product appears in `/v1/products` API response from
      Paddle.

### 3.2 Wire env vars
On staging Citadels.cc:

| Name | Value |
|---|---|
| `PADDLE_PRICE_CLOUD_MONTHLY` | The price ID from sandbox |
| `NEXT_PUBLIC_PADDLE_PRICE_CLOUD_MONTHLY` | Same value (browser-side) |

Restart citadels.cc.

### 3.3 Test Paddle webhook routing
This is the single highest-risk integration. **Do not skip.**

- [ ] Create a test Paddle customer that has only the Citadel sub.
      Trigger a `subscription.created` event in the sandbox dashboard.
      Verify in Postgres:
      ```sql
      SELECT email, subscription_status, cloud_subscription_status
      FROM users WHERE email = 'test@example.com';
      ```
      Expected: `subscription_status = 'active'`, `cloud_subscription_status = NULL`.
- [ ] Now subscribe the same customer to Cloud. Trigger another
      `subscription.created`. Verify:
      ```sql
      SELECT subscription_status, cloud_subscription_status FROM users WHERE ...;
      ```
      Expected: BOTH columns are `'active'` (or `'trialing'` for Cloud).
- [ ] Cancel the Cloud sub in the sandbox dashboard. Wait for the
      `subscription.canceled` webhook. Verify:
      Expected: `cloud_subscription_status = 'canceled'`,
      `subscription_status = 'active'` (untouched).
- [ ] Cancel the Citadel sub. Verify: `subscription_status = 'canceled'`,
      `cloud_subscription_status = 'canceled'` (from the previous step,
      unchanged by this event).

If any of these fail, the routing logic in `paddle-webhook.routes.ts`
is wrong and needs fixing before going further.

### Verify
- [ ] `webhook_events` table has all four events with `outcome='ok'`.
- [ ] No "subscription event for unknown priceId" warnings in the API logs.

---

## 4. End-to-end smoke test on staging

Run both smoke test docs against staging now. **Don't proceed to
production until both pass.**

- [ ] `docs/admin/smoke-test-citadel-cloud.md` (Phase 2 — license/account/telemetry)
- [ ] `docs/admin/smoke-test-global-bans.md` (Phase 3 — Cloud Bans loop)

Note bugs in the doc's "Code-level gaps caught" section, fix, redeploy
to staging, re-test the affected scenario, repeat.

---

## 5. Promote citadel-cloud to production

### 5.1 Production Paddle product
- [ ] Repeat step 3.1 in Paddle production (not sandbox). Get the
      production price ID.
- [ ] Production env vars on citadels.cc:
  - `PADDLE_PRICE_CLOUD_MONTHLY` → production price ID
  - `NEXT_PUBLIC_PADDLE_PRICE_CLOUD_MONTHLY` → same
  - All `CLOUD_BANS_*` vars (or accept defaults).

### 5.2 Production migration
- [ ] Take a Postgres backup of citadels.cc production. **Critical.**
- [ ] `npx drizzle-kit migrate` against production DATABASE_URL.
- [ ] Confirm migrations applied: `\dt` shows the new tables, `\d users`
      shows the new columns.

### 5.3 Production deploy
- [ ] Deploy the citadel-cloud branch to production.
- [ ] Smoke check: `https://citadels.cc/cloud` loads, `/api/v1/cloud-bans/stats` returns 200.
- [ ] Smoke check: `/account` for an existing customer renders without
      errors (the new Cloud section appears even though they don't have
      Cloud yet — should say "Not subscribed").

### 5.4 Watch the webhook events table
- [ ] First 24h, check periodically:
      ```sql
      SELECT event_type, outcome, count(*)
      FROM webhook_events
      WHERE received_at > NOW() - INTERVAL '24 hours'
      GROUP BY event_type, outcome;
      ```
      Expect zero `outcome='error'` rows from the new flows.

---

## 6. Phase 2/3 — Ship the desktop side

The desktop is live in production but doesn't yet talk to the new
cloud endpoints (its build still has Phase 1 code only). Now ship a
version that uses the new endpoints.

### 6.1 Bump version
- [ ] Decide a version. Probably `v2.8.0` since this is a meaningful
      feature release (Cloud + telemetry + scaffolding), not a patch.
- [ ] `package.json`, `desktop/package.json` → `2.8.0`.

### 6.2 Pre-release build
- [ ] Run all the syntax checks one more time:
      ```sh
      for f in $(find backend desktop -name '*.js' -not -path '*/node_modules/*'); do
        node -c "$f" || echo "FAIL $f"
      done
      ```
- [ ] Build via `npm run build:installer`. Sanity-check the resulting
      installer on a Windows VM.
- [ ] Run scenario 1 (happy-path activation) of the smoke test against
      production citadels.cc with a real test account.

### 6.3 Tag and release
- [ ] `git tag v2.8.0 && git push origin v2.8.0`.
- [ ] GitHub Actions builds. Verify `latest.yml` updates.

### 6.4 Communications
- [ ] CHANGELOG entry from this repo, posted on the GitHub Release.
- [ ] Discord post in #announcements:
      > Citadel v2.8.0 is out — adds Citadel Cloud sign-in, the new
      > Global Ban Database (community-wide cheater protection, $10/mo
      > add-on with a 7-day free trial), and a bunch of internal
      > diagnostics. The desktop app behaves the same if you don't
      > sign up — the new stuff is opt-in.

### Verify
- [ ] At least one customer reports a clean v2.7.1 → v2.8.0 update.
- [ ] Telemetry events start appearing on citadels.cc:
      ```sql
      SELECT event, count(*) FROM telemetry_events
      WHERE received_at > NOW() - INTERVAL '6 hours'
      GROUP BY event;
      ```

---

## 7. First paying customer

Ideally Kurt himself or a trusted community admin.

- [ ] Sign up for Citadel Cloud via `https://citadels.cc/cloud`.
- [ ] Activate on a test machine.
- [ ] Submit at least one community ban (use a real cheater SteamID
      from your existing local bans — they're public, no PII concern).
- [ ] Have one or two other test accounts vouch the same SteamID until
      it propagates.
- [ ] Confirm propagation: the SteamID appears in
      `/api/v1/cloud-bans/sync` results, and the local
      `data/cloud-bans-cache.json` picks it up within an hour.
- [ ] Confirm enforcement: the SteamID is in `<server>/ban.txt`.

### Verify
- [ ] One end-to-end paying customer flow completed.
- [ ] No errors in citadels.cc logs from this customer's traffic.
- [ ] Audit log has clean entries: `select`, `submit`, `threshold-met`.

---

## 8. Rollback plan (if anything goes wrong)

### Citadels.cc backend
- [ ] `git revert` the deploy commit.
- [ ] Redeploy the previous version. The new tables stay in the DB but
      the old code doesn't touch them; safe to leave.
- [ ] Migrations are forward-only — don't try to `drop table`. Just stop
      writing to them.

### Desktop
- [ ] In `latest.yml` on the GitHub Release, point back to v2.7.1.
- [ ] `electron-updater` will downgrade users on next check. (Note:
      downgrade UX is rough — only do this if v2.8 has a critical bug.)

### Paddle
- [ ] Cancel any test customers' Cloud subscriptions in Paddle if
      they need refunding.
- [ ] Manually update Postgres if subscriptions got into a bad state:
      ```sql
      UPDATE users SET cloud_subscription_status = NULL,
                       cloud_subscription_renews_at = NULL,
                       paddle_cloud_subscription_id = NULL
      WHERE email = 'test@...';
      ```

---

## 9. Post-launch monitoring (first 30 days)

Watch for:

- [ ] **Update-flow telemetry** — any spike in `update.failed` events.
- [ ] **License activation** — `license.activate.failure` count over
      `license.activate.success` count. If failure rate > 10%, something's
      wrong with the cloud endpoint or the desktop client.
- [ ] **Cloud Bans submission rate** — sanity-check via
      `SELECT count(*) FROM ban_submissions WHERE submitted_at > NOW() - INTERVAL '24 hours'`.
      Sudden spike = potential abuse, investigate via the reputation page.
- [ ] **Open appeals queue** — process within the 7-day SLA. See
      `docs/admin/global-bans-runbook.md`.
- [ ] **Customer churn** — anyone who lapses Cloud within a week?
      That's the loss-aversion banner test population. Did re-subscribe
      rate beat the no-banner baseline (which was 0% before).

Once the system has 30 days of clean operation under real load, consider
the Phase 3 launch complete and start Phase 4 planning.
