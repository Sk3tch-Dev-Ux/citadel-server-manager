# Phase 3 Smoke Test — Global Ban Database

End-to-end checklist for the paying-customer scenario. Run this against a
deployed citadels.cc + Citadel desktop pair before declaring Phase 3 done.

**Prerequisites:**
- Phase 1 (auto-update fix) shipped.
- Phase 2 (license + telemetry) deployed and verified.
- Phase 3 backend code deployed:
  - Drizzle migration generated for `community_bans`, `ban_submissions`,
    `ban_appeals`, `ban_audit_log`, `customer_submission_stats`.
    Run: `cd packages/api && npx drizzle-kit generate && npx drizzle-kit migrate`.
  - `cloudBansRoutes`, `appealsRoutes`, `cloudBansAdminRoutes` registered.
  - `/cloud` marketing page deployed.
- Paddle production product configured at $10/mo with 7-day trial.
  `NEXT_PUBLIC_PADDLE_PRICE_CLOUD_MONTHLY` env set.
- Two test users:
  - **TEST_PAID** — has an active Paddle subscription (or fresh trial).
  - **TEST_TRIAL** — fresh signup, in 7-day trial window.
- Two Citadel installs (different machines, or VMs with different
  MachineGuids):
  - **MACHINE_A** — will activate as TEST_PAID.
  - **MACHINE_B** — will activate as TEST_TRIAL.
- Admin access to the citadels.cc moderation queue.

**Time required:** ~45 minutes.

---

## Pre-flight

- [ ] `https://citadels.cc/cloud` loads cleanly. Live stats fetch and
      display zeros (or whatever the test DB has).
- [ ] `https://citadels.cc/cloud` "Start free trial" button opens Paddle
      checkout (it'll show the $10/mo product with the trial badge).
- [ ] The Citadel dashboard sidebar (admin role) shows both
      "Citadel Cloud" and "Global Ban DB" entries.

---

## Scenario 1 — Trial user activates and sees the gate

1. [ ] On MACHINE_B, sign in to Citadel Cloud as TEST_TRIAL via
       `/citadel-license`. Status should flip to `active` (Paddle
       returns `trialing`).
2. [ ] Navigate to `/global-bans`. The page renders the actual content
       (NOT the LicenseGate upgrade card).
3. [ ] On a fresh DB, the Active community bans count is 0. Sync stats
       show "never" (hourly sync hasn't run yet).
4. [ ] Click "Sync now". A toast appears: "Sync complete: +0 bans, -0 removed."
5. [ ] On MACHINE_A, sign in as TEST_PAID. Same expected state.

## Scenario 2 — Two independent submissions, ban stays pending

1. [ ] On MACHINE_A, navigate to `/bans`. Click "Add Ban". The form now
       shows the "Submit to Citadel Cloud community ban DB" toggle (because
       the customer is active). Toggle should be ON by default. Category
       dropdown defaults to "cheating".
2. [ ] Submit a ban for SteamID `76561198000000001` (use a test ID, not a real
       player). Reason category: "cheating".
3. [ ] On citadels.cc DB, verify:
       ```sql
       SELECT * FROM community_bans WHERE steam_id = '76561198000000001';
       SELECT * FROM ban_submissions WHERE steam_id = '76561198000000001';
       ```
       Expect: 1 community_bans row with status='pending' (vouch_weight_total=1.000).
       1 ban_submissions row, vouchWeightAtSubmit=1.000.
4. [ ] On MACHINE_B, ban the same SteamID. Same flow.
5. [ ] DB now shows: vouch_weight_total=2.000, vouch_count_total=2,
       status STILL 'pending'. Threshold is 3.0.
6. [ ] On citadels.cc/cloud, the live stats endpoint should still report
       activeBans=0 (pending bans don't count).

## Scenario 3 — Third submission crosses threshold, ban activates

1. [ ] Create a third test customer (TEST_PAID_2) with an active subscription.
       Activate them on a third test machine MACHINE_C.
2. [ ] From MACHINE_C, ban `76561198000000001`.
3. [ ] DB:
       ```sql
       SELECT status, vouch_count_total, vouch_weight_total, activated_at
       FROM community_bans WHERE steam_id = '76561198000000001';
       ```
       Expect: status='active', count=3, weight=3.000, activated_at set to now.
4. [ ] Wait up to 1 hour (or trigger manual sync from MACHINE_A and
       MACHINE_B). The new community ban should appear in their cached
       sync responses.
5. [ ] On MACHINE_A, run `/api/cloud-bans/sync` manually. Status response
       shows total=1.
6. [ ] Open the actual `ban.txt` file at `<server-install-dir>/ban.txt`
       on MACHINE_A. The SteamID `76561198000000001` should be there.
7. [ ] On `https://citadels.cc/cloud`, the live stats should now show
       activeBans=1, bansActivatedThisWeek=1.

## Scenario 4 — Customer unenroll

1. [ ] On MACHINE_C, navigate to `/bans` and remove the ban for
       `76561198000000001` (click "Unban").
2. [ ] On citadels.cc DB:
       - The customer's `ban_submissions` row has `unenrolled_at` set.
       - `community_bans` recomputed: weight_total now 2.000.
       - status flipped from 'active' back to 'pending'.
3. [ ] On MACHINE_A's next sync, the community_bans response includes the
       SteamID with status='overturned' (or the ban gets dropped from the
       active list — confirm via `cloud-bans-cache.json`).
4. [ ] The SteamID should be removed from MACHINE_A's `ban.txt` automatically
       by the enforcer.

## Scenario 5 — Appeal flow (overturn)

1. [ ] Submit the ban from MACHINE_C again to bring vouch_weight_total back to 3.
       Confirm status='active'.
2. [ ] As a public user (incognito browser), visit
       `https://citadels.cc/appeal/76561198000000001`. Page loads.
3. [ ] Submit an appeal: reason "I was using a banned mod accidentally,
       won't happen again", evidence "video link", email "appellant@test.com".
4. [ ] Check email — should receive `sendAppealReceivedEmail` with the
       appeal status URL.
5. [ ] DB:
       ```sql
       SELECT id, status, appellant_email FROM ban_appeals
       WHERE appellant_steam_id = '76561198000000001';
       ```
       Expect: 1 row, status='open'.
6. [ ] As admin (signed into citadels.cc with admin_role='admin'), go
       to `/admin/cloud-bans/appeals?status=open`. Appeal appears.
7. [ ] Click the appeal ID. Detail page shows: appellant info, ban context,
       all 3 submissions (with submitter emails since you're admin).
8. [ ] POST to `/admin/cloud-bans/appeals/<id>/decide` with
       `{ "decision": "overturned", "notes": "Insufficient evidence to maintain." }`.
9. [ ] Verify cascade:
       - Appeal status → 'overturned'.
       - All 3 submissions on this ban have `overturned_at` set.
       - Each customer's `customer_submission_stats.vouch_weight` is
         now 0.700 (was 1.000, × 0.7 from overturn penalty).
       - Each customer's `total_overturns` is now 1.
       - community_bans row: status='overturned'.
       - Audit log shows `appeal:overturned` and 3× `reputation-adjusted`.
10. [ ] Appellant receives the overturn email.
11. [ ] On MACHINE_A, after next sync, the SteamID is removed from `ban.txt`.

## Scenario 6 — Auto-lock from repeat overturns

This requires multiple bans + overturns; takes patience.

1. [ ] Pick TEST_PAID. Have them submit 20 community bans across 20 different
       SteamIDs (use random test IDs `76561198000000010` through
       `76561198000000029`).
2. [ ] Have OTHER customers vouch each ban to threshold so they activate.
3. [ ] As admin, file appeals on 7 of the 20 (the appellants don't need to
       be real). Decide all 7 as 'overturned'.
4. [ ] Customer's overturn rate: 7/20 = 35% — exceeds 30% threshold.
5. [ ] Verify on the 7th overturn:
       - Customer's `vouch_weight` clamped to 0.000.
       - `weightLocked` is true.
       - Audit log entry `reputation-locked-auto`.
6. [ ] Try to submit another ban from this customer's MACHINE. Should
       receive 403 REPUTATION_LOCKED with the explanatory message.

## Scenario 7 — Rate limit (24h)

1. [ ] On a fresh test customer, write a script that submits 51 bans in
       sequence over a few minutes. Use unique SteamIDs.
2. [ ] Submission #51 returns 429 RATE_LIMIT with retry-after.
3. [ ] After 24 hours pass (or temporarily reduce `CLOUD_BANS_RATE_LIMIT_24H=2`
       in the citadels.cc env for testing), submissions resume.

## Scenario 8 — Lapsed-subscriber loss-aversion banner

1. [ ] On MACHINE_A (TEST_PAID, active), `/api/cloud-bans/status` shows
       a non-zero count from previous scenarios.
2. [ ] In Paddle test admin, cancel TEST_PAID's subscription.
3. [ ] On the Citadel dashboard, force a license refresh
       (`POST /api/citadel-license/refresh`). Status flips to `lapsed`.
4. [ ] The banner across the top now shows the loss-aversion copy:
       "Citadel Cloud subscription inactive. **N** community-banned
       cheaters were on your protection list. Re-subscribe to restore protection."
5. [ ] If you re-subscribe in Paddle and refresh, status returns to `active`
       and the banner disappears.

## Scenario 9 — Telemetry events flow

1. [ ] Throughout the above scenarios, verify in the citadels.cc DB:
       ```sql
       SELECT event, count(*) FROM telemetry_events
       WHERE received_at > NOW() - INTERVAL '1 hour'
       GROUP BY event ORDER BY count DESC;
       ```
       Expected events:
       - `cloud-bans.submit` (one per submission)
       - `cloud-bans.unenroll` (one per unenroll)
       - `cloud-bans.sync.success` (one per successful sync)
       - `license.activate.success` (per activation)
2. [ ] At least one of those events should have `user_id` set (from a
       paid customer's bearer-authed flush) and others have `user_id=NULL`
       (anonymous installs flushing while not signed in).

## Scenario 10 — Marketing page conversion

1. [ ] Open `https://citadels.cc/cloud` in incognito.
2. [ ] Live stats render with the populated values from the test runs.
3. [ ] Click "Start free trial". Paddle checkout overlay opens with the
       $10/mo product. (Don't complete unless you're testing the full
       Paddle flow.)
4. [ ] Click "How it works" anchor — page scrolls smoothly to the section.

---

## Cleanup

- [ ] Delete test customers + their devices on citadels.cc.
- [ ] Truncate test bans:
      ```sql
      DELETE FROM community_bans WHERE steam_id LIKE '76561198000%';
      DELETE FROM ban_submissions WHERE steam_id LIKE '76561198000%';
      DELETE FROM ban_appeals WHERE appellant_steam_id LIKE '76561198000%';
      ```
- [ ] Reset Paddle test state.
- [ ] Note any bugs in `ROADMAP.md` Phase 3 risks section.

---

## Code-level gaps caught during smoke testing (placeholder)

Fill in as you go:

- _Nothing yet — fill in once smoke testing happens._
