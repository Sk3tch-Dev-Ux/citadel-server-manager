# Citadel Cloud — Phase 2 Smoke Test Checklist

Run through this once Phase 1 has shipped (the auto-update bug fix) and
the citadel-cloud changes from Phase 2 (telemetry route, schema migration)
are deployed. This proves the activate / verify / deactivate / telemetry
loop works end-to-end against live infrastructure.

**Time required:** ~30 minutes.
**Prerequisites:**
- A Citadel Agent build with the auto-update fix shipped.
- The license-activation + telemetry endpoints merged on the Agent side.
- citadel-cloud deployed with:
  - The new `telemetry_events` table (run `npx drizzle-kit generate` in
    `packages/api/`, commit, then `drizzle-kit migrate` in production).
  - The `telemetryRoutes` registered (already wired in `app.ts`).
- A Stripe test product configured (the Cloud add-on price created in
  test mode; base Citadel prices already exist).
- A test citadel-hub.com account NOT subscribed (for the
  `SUBSCRIPTION_INACTIVE` scenario).
- A second test account WITH an active Stripe test subscription.

---

## Pre-flight (do these first)

- [ ] citadel-hub.com is reachable from the test machine: `curl -v https://api.citadel-hub.com/health` returns `200`.
- [ ] The test Citadel install is on a Phase 1 build (v2.7.x or later).
- [ ] You can sign into the test Citadel dashboard with an admin user
      whose role has the `license.manage` permission.
- [ ] You have access to the citadel-hub.com Postgres database (or admin
      endpoints) to verify rows.

---

## Scenario 1 — Activation with no subscription (D2 happy-path-for-prospects)

Goal: verify the "I tried to sign in but I haven't paid yet" UX is friendly
and points at the right place.

1. [ ] Sign in to Citadel dashboard, navigate to `/citadel-license`.
2. [ ] Click "Sign in" and enter the credentials of a citadel-hub.com account
       with NO active subscription. Submit.
3. [ ] Confirm:
   - The form shows the friendly `no-subscription` error: bordered in the
     accent color (not red), text reads "No active Citadel Cloud
     subscription found on this account." with a link to
     citadel-hub.com/cloud.
   - The local `data/license.json` was NOT created or modified
     (`ls -la data/license.json` from the Citadel install dir).
4. [ ] Click the citadel-hub.com/cloud link — confirm it opens the marketing
       page in a new tab.

## Scenario 2 — Activation with an active subscription (the canonical path)

1. [ ] On the same `/citadel-license` page, sign in with the credentials
       of the OTHER test account (the one with a Stripe test subscription).
2. [ ] Confirm:
   - Toast appears: "Citadel Cloud activated on this machine."
   - Status flips to `active`. The subscription card shows the right
     status, renews-at, and signed-in email.
   - `data/license.json` exists and contains a token field.
   - On citadel-hub.com, a row appears in `devices` for the test user with
     this machine's `machine_id` and `revoked = false`.

## Scenario 3 — Background refresh

1. [ ] Wait ~6h (or temporarily set `CITADEL_LICENSE_VERIFY_INTERVAL_MS=60000`
       in `.env` and restart the backend).
2. [ ] Watch the server log — you should see a debug-level "license verify"
       call against citadel-hub.com.
3. [ ] On citadel-hub.com, the corresponding `devices` row's `last_seen_at` and
       `last_ip_address` should update.
4. [ ] `lastVerifiedAt` in `/api/citadel-license/status` advances.

## Scenario 4 — Lapse on subscription cancel

1. [ ] In the Stripe Dashboard (test mode), cancel the test subscription
       (fires `customer.subscription.deleted`).
2. [ ] Trigger a refresh manually: dashboard `/citadel-license` → click
       "Refresh", OR `POST /api/citadel-license/refresh`.
3. [ ] Confirm:
   - Status transitions to `lapsed`.
   - The dashboard banner shows the non-dismissable "Citadel Cloud
     subscription inactive. Cloud features are paused; the local app keeps
     working." with a "Manage subscription" button to app.citadel-hub.com/account.
   - `license.isUsable()` returns false (verify by hitting any future
     `requireLicense`-gated route — should 402; in Phase 2 nothing is
     gated yet, so this is a future-test).
4. [ ] Re-subscribe the test customer in Stripe (test mode). Click
       "Refresh". Status returns to `active`.

## Scenario 5 — Deactivate from the desktop

1. [ ] On `/citadel-license`, click "Deactivate this machine".
2. [ ] Confirm the prompt clarifies that this only revokes THIS machine's
       activation; the customer's Citadel and Cloud subscriptions are
       unaffected.
3. [ ] Confirm `data/license.json` is gone.
4. [ ] Confirm `data/cloud-bans-cache.json` is gone (Phase 3 — license
       deactivation triggers Cloud cache wipe via `onLicenseDeactivated`).
5. [ ] On citadel-hub.com, the device row's `revoked` is now `true`. The
       user's `subscriptionStatus` and `cloudSubscriptionStatus` columns
       are unchanged.
6. [ ] Status returns to `unactivated`. The marketing banner returns
       (since the dismissed-flag is per-session and the page didn't
       reload it).

## Scenario 6 — Deactivate from app.citadel-hub.com/account

1. [ ] Re-activate the device.
2. [ ] On app.citadel-hub.com/account (or via `DELETE /api/v1/license/devices/:id`),
       revoke the device.
3. [ ] On the Citadel install, force a refresh
       (`POST /api/citadel-license/refresh`).
4. [ ] Confirm:
   - The verify call returns 403 with the "device deactivated" message.
   - Local state resets to `unactivated`.
   - `data/license.json` is cleared.

## Scenario 7 — Offline grace period

1. [ ] Re-activate the device. Confirm status is `active`.
2. [ ] Cut network connectivity to citadel-hub.com on the test box (block via
       hosts file, firewall, or pull the cable).
3. [ ] Force a refresh. Confirm:
   - Status is now `grace`, not `unactivated`. The cached token is still
     valid; we just couldn't reach the server.
   - The dashboard banner shows the warning-tone "Citadel Cloud is
     working offline" with "last verified Xm ago" and a "Reconnect now"
     button.
4. [ ] Reconnect network. Click "Reconnect now". Status returns to
       `active`.
5. [ ] (Optional, slow) Set `CITADEL_LICENSE_GRACE_DAYS=0.001` (~90s).
       Stay offline past that window. Status should transition to
       `expired`. Reconnect → returns to `active` (or `lapsed` if the
       subscription has been canceled in the meantime).

## Scenario 8 — Telemetry ingest, paid path

1. [ ] On `/citadel-license`, expand the "Diagnostic telemetry" card and
       confirm the disclosure text matches what you'd be comfortable
       defending publicly.
2. [ ] Verify the toggle is enabled by default (per D-telemetry).
3. [ ] Trigger an event by deliberately failing an activation
       (Scenario 1) → produces `license.activate.failure`.
4. [ ] Within 30s (the flush interval), check
       `data/telemetry-queue.json` — it should empty out.
5. [ ] On citadel-hub.com, query the `telemetry_events` table:
       ```sql
       SELECT event, payload, occurred_at, machine_id_hash, user_id
       FROM telemetry_events
       ORDER BY received_at DESC
       LIMIT 5;
       ```
       Confirm the failure event landed with the right payload (just
       `statusCode` / `errorCode`, nothing else) and that `machine_id_hash`
       is a 64-char hex string.

## Scenario 9 — Telemetry ingest, anonymous (unactivated) path

1. [ ] Deactivate the test machine.
2. [ ] Try to activate again with no-subscription credentials → produces
       another `license.activate.failure`.
3. [ ] Confirm the resulting `telemetry_events` row has `user_id = NULL`
       and `device_id = NULL` (the desktop didn't have a license token to
       send as Bearer auth).
4. [ ] Confirm the `machine_id_hash` matches the previous events from
       this machine — it should, because the hash is derived from the
       Windows MachineGuid which doesn't change between activations.

## Scenario 10 — Telemetry opt-out

1. [ ] Toggle telemetry off via the dashboard card.
2. [ ] Trigger another failed activation.
3. [ ] Confirm `data/telemetry-queue.json` stays empty (event was dropped,
       not buffered).
4. [ ] Re-enable telemetry. New events resume flushing.

## Scenario 11 — Telemetry rejects unknown event names

This one's a manual curl since the desktop only sends approved events.

```
curl -X POST https://api.citadel-hub.com/api/v1/telemetry/events \
  -H 'Content-Type: application/json' \
  -d '{
    "machineIdHash": "0000000000000000000000000000000000000000000000000000000000000000",
    "product": "citadel",
    "productVersion": "test",
    "events": [
      { "event": "totally.fake.event", "payload": {}, "occurredAt": "2026-04-29T00:00:00Z" }
    ]
  }'
```

Expect: `400 VALIDATION_ERROR { message: "Unknown event name: totally.fake.event" }`.

## Scenario 12 — The banner behavior matrix

For each license state, navigate to a non-license page and confirm:

| State          | Banner shown? | Tone       | Primary CTA               | Dismissable?           |
|----------------|---------------|------------|---------------------------|------------------------|
| `active`       | No            | —          | —                         | —                      |
| `unactivated`  | Yes           | Accent     | "Sign in to Citadel Cloud"| Yes (per session)      |
| `grace`        | Yes           | Warning    | "Manage" (+ "Reconnect")  | No                     |
| `past_due`     | Yes           | Warning    | "Open account"            | No                     |
| `lapsed`       | Yes           | Danger     | "Manage subscription"     | No                     |
| `expired`      | Yes           | Danger     | "Reconnect"               | No                     |

For `unactivated`, click the X. Confirm the banner disappears. Refresh
the page — banner stays gone (sessionStorage). Close and reopen the app —
banner returns (sessionStorage cleared).

---

## Cleanup

- [ ] Restore Stripe test subscription state.
- [ ] Delete test telemetry events:
      ```sql
      DELETE FROM telemetry_events WHERE machine_id_hash = '<your test hash>';
      ```
- [ ] Reset any temporary `.env` overrides on the test box.
- [ ] File any bugs found as issues on the Agent repo so they're tracked.

---

## Code-level gaps caught during the walkthrough (none — placeholder)

If something fails the smoke test, capture it here as a P2.x sub-task
before continuing the roll-out:

- _Nothing yet — fill in once smoke testing happens._
