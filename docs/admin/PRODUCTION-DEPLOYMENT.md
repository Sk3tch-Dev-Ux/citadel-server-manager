# Production Deployment Runbook — Phases 1, 2, 3

This is the ordered runbook for going live with everything that has
landed in the repo. Follow it top to bottom; each section has a
**Verify** step you should not skip.

**Estimated time:** 3-4 hours of focused work, mostly manual testing
between deploy steps. Spread across 2-3 days if you want overnight
soak time at each gate.

**Touched repos:**
- `DayzServerController` (this repo) — desktop + local backend
- `citadel-cloud` — citadel-hub.com Next.js + Fastify API + Postgres

---

## 0. Pre-flight

- [ ] Both repos clean: `git status` shows nothing uncommitted (commit
      everything in this branch first).
- [ ] citadel-hub.com staging Postgres reachable from your dev machine.
      Production credentials available but **don't apply migrations to
      prod yet** — staging first.
- [ ] You have admin access to:
  - Stripe Dashboard (production / live mode)
  - The citadel-hub.com deployment surface (Vercel, Fly, whichever)
  - The citadel-hub.com database (psql or equivalent)
  - GitHub Releases for Sk3tch-Dev-Ux/citadel-server-manager
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
- [ ] Run the standard release smoke test (clean install, upgrade in
      place, silent update, rollback). Capture any regressions before
      tagging.
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

## 2. Phase 2/3 — citadel-hub.com backend prep (staging)

We deploy citadel-hub.com *before* the desktop side because the desktop
needs the new endpoints to talk to.

### 2.1 Environment variables (staging)
On the staging citadel-hub.com deployment, add the following env vars. None
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
- [ ] Confirm `https://staging.citadel-hub.com/api/v1/cloud-bans/stats`
      returns `{ activeBans: 0, ... }` (the public endpoint, no auth).

### Verify
- [ ] `curl -i https://staging.citadel-hub.com/api/v1/cloud-bans/stats` → 200.
- [ ] Postgres shows the new tables. `SELECT count(*) FROM community_bans` → 0.
- [ ] No error spam in the API logs.

---

## 3. Configure Stripe (test mode first)

The Cloud add-on product needs to exist in Stripe before any of the
checkout flows work end-to-end. Citadel billing runs entirely on Stripe.

### 3.1 Test mode first
- [ ] In the Stripe Dashboard (test mode): create a recurring "Citadel
      Cloud" product at $10/month. Save the price ID (`price_...`).
      The base Citadel products (monthly/yearly) should already exist
      from the initial Stripe setup — confirm their price IDs too.
- [ ] Confirm the price shows as **Active** under Products in the dashboard.

### 3.2 Wire env vars
On staging citadel-hub.com:

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Test secret key (`sk_test_...`) from dashboard.stripe.com/apikeys |
| `STRIPE_PRICE_CLOUD_MONTHLY` | The Cloud price ID from test mode |
| `NEXT_PUBLIC_STRIPE_PRICE_CLOUD_MONTHLY` | Same value (browser-side, for display) |
| `STRIPE_CLOUD_TRIAL_DAYS` | `7` (default; applied per checkout session) |
| `STRIPE_TAX_ENABLED` | `0` until tax registrations are filed and confirmed |

Then create the webhook endpoint and capture its signing secret:

```sh
npm run setup:stripe-webhook --workspace=@citadel/api -- \
  --url https://staging.citadel-hub.com/webhooks/stripe
```

Set the value it prints as `STRIPE_WEBHOOK_SECRET` (`whsec_...`; Stripe
only reveals it once at creation). Restart citadel-hub.com.

### 3.3 Test Stripe webhook routing
This is the single highest-risk integration. **Do not skip.** The handler
lives in `packages/api/src/routes/stripe-webhook.routes.ts` (mounted at
`POST /webhooks/stripe`) and routes subscription-lifecycle events to the
product-specific columns by matching the subscription's price against
`STRIPE_PRICE_CITADEL_*` vs `STRIPE_PRICE_CLOUD_*`.

- [ ] Create a test customer subscribed only to the Citadel base product
      (use the test card `4242 4242 4242 4242` through Checkout, or drive
      it with `stripe trigger` from the Stripe CLI). After
      `customer.subscription.created` lands, verify in Postgres:
      ```sql
      SELECT email, subscription_status, cloud_subscription_status
      FROM users WHERE email = 'test@example.com';
      ```
      Expected: `subscription_status = 'active'`, `cloud_subscription_status = NULL`.
- [ ] Now subscribe the same customer to Cloud. After the second
      `customer.subscription.created`, verify:
      ```sql
      SELECT subscription_status, cloud_subscription_status FROM users WHERE ...;
      ```
      Expected: BOTH columns `'active'` (or `'trialing'` for Cloud while
      the 7-day trial runs).
- [ ] Cancel the Cloud sub in the dashboard. Wait for the
      `customer.subscription.deleted` webhook. Verify:
      Expected: `cloud_subscription_status = 'canceled'`,
      `subscription_status = 'active'` (untouched).
- [ ] Cancel the Citadel sub. Verify: `subscription_status = 'canceled'`,
      `cloud_subscription_status = 'canceled'` (from the previous step,
      unchanged by this event).

If any of these fail, the routing logic in `stripe-webhook.routes.ts`
is wrong and needs fixing before going further.

### Verify
- [ ] `webhook_events` table has all the events with `outcome='ok'`.
- [ ] No "subscription event for unknown price" warnings in the API logs.

---

## 4. End-to-end smoke test on staging

Run the smoke test doc against staging now. **Don't proceed to production
until it passes.**

- [ ] `docs/admin/smoke-test-citadel-cloud.md` — license/account/telemetry
  loop end-to-end.

Note bugs in the doc's "Code-level gaps caught" section, fix, redeploy
to staging, re-test the affected scenario, repeat.

(The standalone Global Bans smoke test was removed when the Cloud Bans
management UI moved to Citadel Cloud. Trust Network sync is now exercised
implicitly by the citadel-cloud smoke test.)

---

## 5. Promote citadel-cloud to production

### 5.1 Production Stripe product
- [ ] Repeat step 3.1 in Stripe **live mode** (not test). Get the live
      Cloud price ID.
- [ ] Production env vars on citadel-hub.com:
  - `STRIPE_SECRET_KEY` → live secret key (`sk_live_...`)
  - `STRIPE_PRICE_CLOUD_MONTHLY` → live Cloud price ID
  - `NEXT_PUBLIC_STRIPE_PRICE_CLOUD_MONTHLY` → same
  - `STRIPE_WEBHOOK_SECRET` → from a live-mode `setup:stripe-webhook` run
    pointed at `https://api.citadel-hub.com/webhooks/stripe`
  - `STRIPE_TAX_ENABLED=1` once tax registrations are filed (leave `0` otherwise)
  - All `CLOUD_BANS_*` vars (or accept defaults).

### 5.2 Production migration
- [ ] Take a Postgres backup of citadel-hub.com production. **Critical.**
- [ ] `npx drizzle-kit migrate` against production DATABASE_URL.
- [ ] Confirm migrations applied: `\dt` shows the new tables, `\d users`
      shows the new columns.

### 5.3 Production deploy
- [ ] Deploy the citadel-cloud branch to production.
- [ ] Smoke check: `https://citadel-hub.com/cloud` loads, `/api/v1/cloud-bans/stats` returns 200.
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
      production citadel-hub.com with a real test account.

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
- [ ] Telemetry events start appearing on citadel-hub.com:
      ```sql
      SELECT event, count(*) FROM telemetry_events
      WHERE received_at > NOW() - INTERVAL '6 hours'
      GROUP BY event;
      ```

---

## 7. First paying customer

Ideally Kurt himself or a trusted community admin.

- [ ] Sign up for Citadel Cloud via `https://citadel-hub.com/cloud`.
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
- [ ] No errors in citadel-hub.com logs from this customer's traffic.
- [ ] Audit log has clean entries: `select`, `submit`, `threshold-met`.

---

## 8. Rollback plan (if anything goes wrong)

### citadel-hub.com backend
- [ ] `git revert` the deploy commit.
- [ ] Redeploy the previous version. The new tables stay in the DB but
      the old code doesn't touch them; safe to leave.
- [ ] Migrations are forward-only — don't try to `drop table`. Just stop
      writing to them.

### Desktop
- [ ] In `latest.yml` on the GitHub Release, point back to v2.7.1.
- [ ] `electron-updater` will downgrade users on next check. (Note:
      downgrade UX is rough — only do this if v2.8 has a critical bug.)

### Stripe
- [ ] Cancel any test customers' Cloud subscriptions in the Stripe
      Dashboard if they need refunding.
- [ ] Manually update Postgres if subscriptions got into a bad state:
      ```sql
      UPDATE users SET cloud_subscription_status = NULL,
                       cloud_subscription_renews_at = NULL,
                       stripe_cloud_subscription_id = NULL
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
