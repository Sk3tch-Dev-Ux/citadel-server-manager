# Citadel & Citadel Cloud — Admin Guide

This document covers Citadel's licensing architecture, the optional Citadel
Cloud add-on, and the operational details of activation, telemetry, and
appeals.

---

## Product model in one paragraph

Citadel ships as **two separately billed products** that customers
subscribe to independently:

- **Citadel** — $14.99/month (or $149.99/year). The local app license.
  Required to use the desktop + backend at all. Activation against
  citadels.cc validates an active Citadel subscription; without it, the
  app enters grace then read-only.
- **Citadel Cloud** — +$10/month add-on on top of Citadel. Optional
  second subscription that unlocks cloud-only features (Global Ban
  Database; future cloud tools). 7-day free trial. Customers must hold
  the base Citadel sub to activate; Cloud-only is impossible by design.

Server-side, the license JWT carries `entitlements: ['citadel'] | ['citadel', 'cloud']`.
The local backend's `requireLicense({ feature: 'cloud' })` middleware
gates Cloud-only routes; the React `<LicenseGate feature="cloud">`
component does the same on the dashboard. Subscription state lives on
the `users` table in two parallel column groups (`subscription_*` for
Citadel, `cloud_subscription_*` for Cloud) populated by the Paddle
webhook handler routing on `price_id`.

---

## The license module — what's actually running

When the backend boots, `backend/lib/license/index.js` does this:

1. Loads a cached license token from `data/license.json` if present.
2. Verifies the token signature locally using an embedded RS256 public key
   (`backend/lib/license/public-key.js`).
3. Schedules a background refresh every 6 hours that calls
   `GET https://citadels.cc/api/v1/license/verify` and updates the cache.

States the license module exposes:

| State          | Meaning                                                      | Cloud features?  |
|----------------|--------------------------------------------------------------|------------------|
| `unactivated`  | No token cached. User has never signed in (or signed out).   | No               |
| `active`       | Token valid, last verified < 6h ago, subscription active.    | Yes              |
| `grace`        | Token valid but verify hasn't succeeded recently.            | Yes (up to 7d)   |
| `past_due`     | Subscription has a payment overdue but isn't canceled yet.   | Yes (warn user)  |
| `lapsed`       | Subscription canceled or otherwise inactive server-side.     | No               |
| `expired`      | Grace window exceeded — re-verify required to use cloud.     | No               |

The grace window length is controlled by `CITADEL_LICENSE_GRACE_DAYS`
(default `7`).

---

## Activating Citadel Cloud on a machine

1. Open the dashboard, click **Citadel Cloud** in the sidebar (or browse to
   `/citadel-license`). Requires the `license.manage` permission.
2. Enter the email and password for an active citadels.cc account.
3. The local backend POSTs to `/api/v1/license/activate` and stores the
   returned token in `data/license.json`.
4. Status flips to `active`. The dashboard banner disappears.

Failure modes:

- **No active subscription** → `402 SUBSCRIPTION_INACTIVE`. The activation
  page surfaces a friendly message pointing at https://citadels.cc/cloud.
- **Device limit reached** → `409 CONFLICT` with details. User must
  deactivate one of their existing devices from
  https://citadels.cc/account.
- **Invalid credentials** → `401 UNAUTHORIZED`. Standard "wrong email or
  password" UX.

---

## Deactivating

From the dashboard: **Citadel Cloud** → **Deactivate this machine**. This:

1. Calls `DELETE /api/v1/license/deactivate` server-side, which marks the
   device as `revoked = true` in the citadels.cc database.
2. Clears the local `data/license.json` and wipes the cloud-bans cache.
3. Status returns to `unactivated`. The customer's Citadel subscription
   is unchanged on Paddle — they just need to re-activate this machine
   (or another) to use it again.

A user can also revoke a device from https://citadels.cc/account if they
no longer have access to that machine (lost laptop, sold a PC, etc.). The
next time the revoked machine tries to verify, it'll receive a `403
FORBIDDEN`, the local state will reset to `unactivated`, and the user
will be prompted to sign in again.

---

## Migration: existing customers

The licensing system has been live since before Citadel Cloud existed —
existing customers already hold a Citadel subscription on Paddle. The
Phase 3 changes are additive:

- A new column group (`cloud_subscription_*`) was added to the `users`
  table. Existing rows have NULLs there, which means no Cloud entitlement.
- The license JWT now carries `entitlements: ['citadel'] | ['citadel', 'cloud']`.
  Pre-Phase-3 tokens lacked this field; the `_hydrateEntitlementsForLegacy`
  helper in `lib/license.ts` infers it from the existing status fields, so
  cached tokens keep working until they naturally rotate.
- Customers who want Cloud subscribe to the second Paddle product. The
  webhook routes the event to `cloud_subscription_*` and the next
  `/verify` call signs a token with the new entitlements.

If you've ever taken payment for Citadel Cloud outside Paddle (e.g. a
manual comp), update the user's `cloud_subscription_status` directly in
SQL:

```sql
UPDATE users
SET cloud_subscription_status = 'active',
    cloud_subscription_renews_at = NOW() + INTERVAL '1 year',
    updated_at = NOW()
WHERE email = 'customer@example.com';
```

Their next license `/verify` call will return a token with
`entitlements: ['citadel', 'cloud']` and Cloud features will light up.

Edge case: if at some point you (Kurt) directly took payment for a Citadel
Pro license outside Paddle (e.g. a one-off Discord arrangement, an early
supporter grant, a comp), there is no token to migrate from. Process for
giving them cloud access:

1. Create a citadels.cc account on their behalf (or have them sign up).
2. In Paddle admin, manually mark the user as having an active
   subscription, OR run a one-off SQL update on the `users` table on
   citadels.cc to set `subscription_status = 'active'` and a far-future
   `subscription_renews_at`.
3. Send the user their credentials. They sign in from the Citadel
   dashboard normally.
4. Document the comp in your records — Paddle won't show it as revenue.

Future paid customers acquired via Paddle don't need any of this — the
Paddle webhook on citadels.cc creates the user and activates them
automatically.

---

## Telemetry

Citadel sends a small set of diagnostic events to citadels.cc so we can
catch bugs in update flows and license activation across the install base.

**Default: enabled.** Disclosure and toggle are at `/citadel-license` →
"Diagnostic telemetry". The decision to default to opt-out (rather than
opt-in) was made because the value of the data — catching regressions in
update + license flows across the live install base — is only realized
when most installs participate.

Event names that are accepted server-side (everything else is rejected):

```
update.prompt-shown
update.install-clicked
update.completed
update.failed
license.activate.success
license.activate.failure
license.refresh.failure
```

What goes in each event's payload is constrained to a fixed allowlist
(see `backend/lib/telemetry/index.js#EVENT_SCHEMA` and
`packages/api/src/routes/telemetry.routes.ts#EVENT_PAYLOAD_SCHEMAS` on
the citadel-cloud side). Concretely:

- **No** email, password, license token contents.
- **No** raw machine id (we hash it before transmission).
- **No** DayZ data: no server names, no mod lists, no player names, no
  ban lists, no chat logs, no IP addresses of game servers.
- **No** file paths.
- **No** IP address of the user's machine in the payload (the server sees
  the connecting IP and stores it in `client_ip` for abuse diagnosis only,
  not surfaced in any product UI).

Events buffer locally to `data/telemetry-queue.json` (capped at 200) and
flush every 30 seconds via a background loop started in `server.js`.
A 4xx response drops the events; a 5xx or network error keeps them
queued for the next tick.

To verify what's buffered on a machine right now:

```
cat data/telemetry-queue.json
```

To turn telemetry off entirely:

```
POST /api/citadel-license/telemetry-toggle  { enabled: false }
```

The toggle is also surfaced in the dashboard's Citadel Cloud page.

---

## Files on disk

| Path                          | Owner       | Purpose                                  |
|-------------------------------|-------------|------------------------------------------|
| `data/license.json`           | License     | Cached activation token + sub status     |
| `data/telemetry.json`         | Telemetry   | Toggle state + hashed machine id         |
| `data/telemetry-queue.json`   | Telemetry   | Pending events not yet flushed           |
| `backend/lib/license/`        | License     | Activate/verify/deactivate logic         |
| `backend/lib/telemetry/`      | Telemetry   | Buffer + flush + EVENT_SCHEMA            |
| `backend/middleware/require-license.js` | Gating | Returns 402 on routes if not licensed |
| `web/frontend/src/hooks/useLicenseStatus.jsx` | UI gating | React hook for license state |
| `web/frontend/src/components/LicenseGate.jsx` | UI gating | Wrapper component for paid features |

---

## Endpoints (this Citadel install → citadels.cc)

| Method | URL                                      | Purpose                       |
|--------|------------------------------------------|-------------------------------|
| POST   | `/api/v1/license/activate`               | Sign in, get a license token  |
| GET    | `/api/v1/license/verify`                 | Refresh the token             |
| DELETE | `/api/v1/license/deactivate`             | Revoke this machine's slot    |
| POST   | `/api/v1/telemetry/events`               | Submit diagnostic events      |

The base URL is overridable via `CITADEL_LICENSE_API` /
`CITADEL_TELEMETRY_API` for local development against a dev citadels.cc.

---

## Endpoints (dashboard → this Citadel install)

| Method | URL                                                | Purpose                        |
|--------|----------------------------------------------------|--------------------------------|
| GET    | `/api/citadel-license/status`                      | Current license state          |
| POST   | `/api/citadel-license/activate`                    | Sign in (proxies to citadels.cc) |
| POST   | `/api/citadel-license/refresh`                     | Force a verify call            |
| DELETE | `/api/citadel-license/deactivate`                  | Revoke this machine's slot     |
| GET    | `/api/citadel-license/telemetry-state`             | Current telemetry config       |
| POST   | `/api/citadel-license/telemetry-toggle`            | Enable/disable telemetry       |

All require `license.manage` permission.

---

## Operational runbook

**"A customer says cloud features stopped working."**
1. Have them open `/citadel-license`. Check the status banner.
2. If `grace` or `past_due` — they're on a network or billing issue, not
   a Citadel bug. Direct them to https://citadels.cc/account.
3. If `lapsed` or `expired` — same.
4. If `active` and they still report breakage, the issue is downstream of
   licensing. Ask for the dashboard's `/api/citadel-license/status` JSON
   and check the `claims.exp` (token expiry) and `lastVerifiedAt`.

**"A customer's license refresh keeps failing."**
1. Have them check internet connectivity to citadels.cc.
2. If they're in `grace` indefinitely (more than 6h offline despite being
   online), check the `lastError` field in the status response.
3. Common causes: expired token (need to re-activate), revoked device
   (admin revoked from citadels.cc/account — re-activate), Paddle
   subscription canceled.

**"I want to see who has activated."**
- citadels.cc admin → `/api/v1/admin/users` (see citadel-cloud
  `admin.routes.ts`). Filter by `subscription_status = 'active'`.
- For per-device: query `devices` table directly.

**"I want to see telemetry data."**
- citadels.cc DB:
  ```sql
  SELECT event, count(*), max(received_at)
  FROM telemetry_events
  WHERE received_at > now() - interval '24 hours'
  GROUP BY event
  ORDER BY count desc;
  ```
- For a specific install:
  ```sql
  SELECT event, payload, occurred_at
  FROM telemetry_events
  WHERE machine_id_hash = '<hash>'
  ORDER BY occurred_at DESC LIMIT 50;
  ```
