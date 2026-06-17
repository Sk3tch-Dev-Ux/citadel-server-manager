# Global Ban Database — Operator Runbook

This is the day-2 ops guide for running Citadel Cloud's Global Ban Database
(Phase 3). It covers moderation workflows, appeal handling, reputation
adjustments, and the incidents you'll actually face. Pair with
`docs/admin/license.md` for general Citadel Cloud operations.

---

## Mental model

There are three concentric trust layers:

```
                ┌─────────────────────────────────────────┐
                │ Customer (paying / on trial)            │
                │  - Submits bans from their dashboard    │
                │  - Has a vouch_weight (default 1.0)     │
                │  - Capped at 50 bans/24h, 1000/30d      │
                │                                         │
                │   ┌──────────────────────────────────┐  │
                │   │ Reputation system                │  │
                │   │  - Tracks overturn rate          │  │
                │   │  - Auto-penalizes on overturn    │  │
                │   │  - Auto-locks at 30%+ overturns  │  │
                │   └──────────────────────────────────┘  │
                │                                         │
                │       ┌───────────────────────────┐     │
                │       │ Moderator (you, initially)│     │
                │       │  - Reviews appeals        │     │
                │       │  - Reviews high-impact    │     │
                │       │    bans (50+ vouches)     │     │
                │       │  - Manual overrides       │     │
                │       └───────────────────────────┘     │
                └─────────────────────────────────────────┘
```

The system is designed to do most of the work automatically. Your job is
to handle the edge cases and the appeals.

---

## Daily ops checklist

Recommended cadence: 5 minutes/day during early growth, scale up if appeals
volume grows.

1. **Open the moderation queue:** `https://citadels.cc/admin/cloud-bans/queue`
   - Look at "pending review" bans. These are bans that hit threshold but
     also crossed the 50-vouch high-impact line. They DON'T auto-propagate
     until you approve.
   - Look at the open-appeals count. Process anything older than 5 days.
2. **Review any auto-locked customers:**
   `https://citadels.cc/admin/cloud-bans/customers?weightLocked=true`
   - These are customers whose overturn rate exceeded 30%. Investigate
     before reinstating.
3. **Optional weekly:** Sample 5 random recent community bans, spot-check
   their submitter histories. Most won't need anything. Catches bad-faith
   patterns early.

---

## Handling appeals

**SLA target:** 7 days. Aim for 48h during early stages so the appeal
flow feels responsive.

### Workflow

1. Appeal lands in `/admin/cloud-bans/appeals?status=open`.
2. Click into the appeal. You'll see:
   - The appellant's submitted reason and evidence.
   - The full list of customer submissions for that SteamID, including
     their private `notes_local` (visible to moderators only).
   - Each submitter's vouch_weight at time of submission.
3. Decision tree:

   - **Overturn** (appeal accepted, ban removed):
     - The community ban flips to `status='overturned'`.
     - Every active submission on that ban gets the overturn cascade —
       each submitter's `vouch_weight` × 0.7, overturn counter +1.
     - Within 1h, every Cloud-subscribed Citadel install removes the
       SteamID from their `ban.txt` on next sync.
     - The appellant gets an email notification.

   - **Uphold** (appeal denied, ban stays):
     - The ban stays `active`. No reputation changes.
     - Appellant can re-file a new appeal with additional evidence.

   - **Dismiss** (insufficient information):
     - Use when the appeal is empty/spam/clearly nonsense.
     - Same effect as uphold for the ban; appellant can re-file.

4. Add concise decision notes — they get emailed to the appellant.

### When to overturn

- Submitter notes suggest personal beef rather than rule violations.
- Clear pattern: "all three submissions came in within 60 seconds of each
  other from servers in the same Discord". Coordinated bad-faith.
- Strong appellant evidence: video of legit gameplay, statistical evidence
  of false-positive cheat detection.

### When to uphold

- Multiple independent submissions over time, different reason categories.
- Appellant's reason boils down to "I wasn't actually cheating" without
  evidence.
- Appellant is a repeat appellant on multiple SteamIDs (sus pattern).

---

## Bad-faith customer handling

The reputation system catches most bad actors automatically. Manual
intervention is needed when:

### A customer mass-bans 50 in a day

- The 24h rate limit blocks them at submission #51.
- Their next 49 submissions get queued for manual review automatically
  (well — actually they just get rate-limited; queueing is a future
  enhancement). For now: investigate them via reputation page.
- If confirmed bad-faith: `vouch_weight` → 0, `weightLocked` → true.
- Consider Terms-of-Service termination depending on severity.

### A customer's overturn rate auto-locks them

- They hit 30%+ overturn rate over their last 20 submissions.
- The system has already set `vouch_weight = 0` and `weightLocked = true`.
- Investigate: are these legitimate but unlucky bans, or systematic abuse?
- If legitimate (e.g. a server admin being aggressive but not malicious):
  reset their weight to 0.5 with `weightLocked = false` so they can
  rebuild reputation gradually.
- If clearly malicious: leave locked, consider account termination.

### A customer is gaming the vouching system

E.g. running multiple Citadel Cloud accounts to self-vouch their bans.

- Hard to detect automatically; usually surfaces via appeals where the
  appellant points it out.
- Investigation: look at submission timing patterns, IP address overlap
  in `last_ip_address` on `devices`, billing/Stripe customer similarity
  (e.g. shared `stripe_customer_id`, card fingerprint, or billing email).
- Action: lock all involved accounts, refund recent payments, notify
  affected appellants.

---

## Reputation overrides

From `/admin/cloud-bans/customers/<userId>/reputation` you can:

- **Adjust `vouchWeight`** — set to any value 0-2. Higher means submissions
  count more. 1.0 = default. 2.0 = a "trusted" admin whose ban single-handedly
  exceeds the threshold (use sparingly).
- **Toggle `weightLocked`** — locks the weight at its current value
  regardless of automatic adjustments. Use for confirmed bad actors and
  also for trusted admins (so a single overturn doesn't drop a 2.0 admin
  back to 1.4).
- **Override rate limits** — for legit big-server admins who need to
  submit more than 50/day during a wipe weekend. Ask first; don't grant
  unsolicited.

Every adjustment is logged to `ban_audit_log`. Add notes when adjusting
non-trivially.

---

## Recovering a poisoned ban

If a community ban somehow propagated despite the safeguards (e.g. you
discover it after activation):

1. Open the ban in `/admin/cloud-bans/queue` (search by SteamID if needed).
2. POST to `/admin/cloud-bans/<id>/decide` with `{ decision: 'overturn' }`.
3. Effect:
   - Ban `status` → `'overturned'`.
   - Within 1h, every Cloud-subscribed install removes the SteamID.
   - Each submitter's `vouch_weight` × 0.7.
   - If any of those submitters cross the auto-lock threshold as a result,
     they get clamped automatically.

---

## SQL queries for ad-hoc investigation

**Bans propagated in the last 24h:**
```sql
SELECT steam_id, reason_category, vouch_count_total, activated_at
FROM community_bans
WHERE status = 'active'
  AND activated_at > NOW() - INTERVAL '24 hours'
ORDER BY activated_at DESC;
```

**Customers with high overturn rates (potential bad faith):**
```sql
SELECT u.email, s.total_submissions, s.total_overturns,
       (s.total_overturns::float / NULLIF(s.total_submissions, 0)) AS overturn_rate,
       s.vouch_weight, s.weight_locked
FROM customer_submission_stats s
JOIN users u ON u.id = s.user_id
WHERE s.total_submissions >= 5
ORDER BY overturn_rate DESC NULLS LAST
LIMIT 20;
```

**Audit log for a specific ban (forensics):**
```sql
SELECT actor_type, action, payload, occurred_at
FROM ban_audit_log
WHERE community_ban_id = '<uuid>'
ORDER BY occurred_at;
```

**Open appeals older than 5 days (SLA breach risk):**
```sql
SELECT id, appellant_steam_id, appellant_email, created_at,
       NOW() - created_at AS age
FROM ban_appeals
WHERE status = 'open' AND created_at < NOW() - INTERVAL '5 days'
ORDER BY created_at;
```

---

## Communication templates

### Apology when a ban gets overturned

(Sent automatically by `sendAppealDecisionEmail`. The decision-notes you
write get included verbatim, so be professional. Suggested template for
notes:)

> Thanks for the appeal and the additional context. After reviewing the
> submissions, we don't see strong enough evidence to maintain the ban.
> The community ban has been removed and you should see normal access on
> participating servers within an hour. Apologies for the inconvenience.

### Pushing back on a frivolous appeal

> Thanks for the appeal. After reviewing the case, the community ban is
> being upheld — the submissions describe behavior consistent with what
> was reported, and your appeal doesn't address that. If you have new
> information (e.g. video of legitimate gameplay during the period in
> question), feel free to file a new appeal with that evidence attached.

### Locking a customer for cause

(There's no automatic email for this — send manually from your support
address):

> We've identified a pattern of submissions from your account that don't
> meet Citadel Cloud's contribution standards. As of [date] your
> contributions to the community ban DB are paused. Your local Citadel
> install continues working normally. If this is in error, reply to this
> email with context.

---

## Incident response

### "Citadels.cc API is down — customers can't sync"

- Customers' local cached community ban lists keep working. They lose
  the *new* protection until we're back, but their existing protection
  is fine.
- Investigate: standard Postgres / Fastify / Redis health.
- Communicate: Discord + a status banner on citadels.cc.
- After recovery: customers will pull all changes since `cursor` on next
  hourly sync. No customer action required.

### "A wave of false-positive bans has propagated"

This shouldn't happen given the 3-vouch threshold + reputation system,
but if it does:

1. Identify the affected SteamIDs (e.g. spike in appeals).
2. Bulk-overturn via SQL:
   ```sql
   UPDATE community_bans SET status = 'overturned', updated_at = NOW()
   WHERE id IN (...);
   ```
3. Investigate the source customer(s). Lock them.
4. Postmortem in Discord. Don't gloss over it; the trust model depends on
   transparency.

### "A customer reports a community ban breaking their server"

Probably a false positive.

1. Get the SteamID from the customer.
2. Look up via `/admin/cloud-bans/customers/<id>/reputation` page or
   `SELECT * FROM community_bans WHERE steam_id = ?`.
3. If it looks wrong, manually overturn the ban.
4. Direct the affected player to file a normal appeal at
   `/appeal/<steamid>` so they're in the system.
