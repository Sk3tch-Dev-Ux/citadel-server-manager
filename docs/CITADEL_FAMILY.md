# The Citadel Family

**Updated:** 2026-07-01 · The one map of every Citadel product, repo, domain, and the
boundaries between them — plus the consolidated owner ops checklist that stands between
"everything builds green" and "open for business."

---

## 1. Product map

| Product | Repo (local `~/Documents/GitHub/`) | What it is | Deploy path |
|---|---|---|---|
| **Citadel Server Manager** ("the agent") | `DayzServerController` (GitHub: `citadel-server-manager`) | Local Windows agent: Node/Express backend + React dashboard + per-server sidecar + NSIS installer (Windows Service) + Electron desktop. v2.27.0. | GitHub Release → installer + auto-update feed. **A pushed `v*` tag publishes to live auto-updaters.** |
| **Citadel Cloud** | `citadel-cloud` | SaaS control plane: Fastify API + Next.js web + TimescaleDB + Redis + Stripe. Live Ops Console, Trust Network (Cloud Bans), licensing (RS256 entitlements), marketplace. | Coolify **auto-deploys every push to `main`**. Work on branches; merging = deploying. |
| **Citadel Platform** | `citadel-platform` | Community-monetization SaaS: hosted sites, player storefronts, Stripe **Connect** payouts, CFTools + LB Core fulfillment rails, Discord perks. Backend API only; sites/dashboard/bots are sibling Coolify apps. | Coolify **auto-deploys every push to `main`**. Same rule: branches + PRs only. |
| **@CitadelAdmin mod** | `citadel-mods/CitadelAdmin` | In-game EnScript mod: executes cloud/agent commands via file IPC, reports players/events/vehicles. Changes take effect on **compile + repack + re-sign** (PBO.Tools pipeline), not on commit. | Manual PBO build + deploy to servers. |
| **Citadel Bot** | `citadel-bot` | Standalone Discord bot; calls the agent's `/api/discord/action` surface. | Separate; not part of this checklist. |
| DayZ gameplay mod suite | `citadel-mods` (Core, WanderingTrader, KOTH, Manhunt, …) | Kurt's paid gameplay mods. Separate business line; shares only the repo with @CitadelAdmin. | PBO builds. |

## 2. Domain map (`citadel-hub.com` family)

| Host | Serves | Owner repo |
|---|---|---|
| `citadel-hub.com` | Marketing site (pricing, download, trust, docs) | citadel-cloud (web, marketing host) |
| `app.citadel-hub.com` | Authenticated Cloud console (Live Ops, dashboard, account) | citadel-cloud (web, app host) |
| `api.citadel-hub.com` | Cloud API + `wss /ws/plugin` (agent pairing) | citadel-cloud (api) |
| `platform.citadel-hub.com` | Platform API | citadel-platform |
| `*.sites.citadel-hub.com` | Tenant community storefronts | citadel-sites (Coolify sibling) |
| `www.citadel-hub.com` | 301 → apex | infra |
| `citadels.cc` | **Email/legacy only** — transactional sender + license JWT issuer. Not a web product surface. Needs SPF/DKIM/DMARC verified before charging customers. | citadel-cloud config |

## 3. Family boundaries (decided, don't relitigate)

- **Cloud and Platform are two products that share a name and nothing else.** Separate
  auth (Cloud: own users table + JWT; Platform: better-auth orgs + separate Steam-OpenID
  player auth), separate Stripe accounts/flows, separate databases. An optional
  "connect your Citadel" bridge is documented in platform `docs/ecosystem-plan.md` as
  later-and-never-a-hard-dependency. Any SSO/billing unification is a deliberate
  architecture decision, not a cleanup task.
- **The authoritative agent↔cloud contract** is `citadel-cloud/packages/shared/src/types/plugin.ts`
  ↔ `DayzServerController/backend/lib/cloud-bridge/` (reconciled in the cloud repo's
  `CITADEL_AGENT_ALIGNMENT.md`). The cloud's `packages/plugin` prototype is retired.
- **Machine anchors never change** (or every install orphans): service name
  `CitadelServer`, install dir `C:\Citadel`, registry `HKLM\Software\Citadel`,
  `FIXED_SALT` in `credential-encryption.js`, auto-update feed repo.
- **api.citadel-hub.com belongs to Cloud; platform.citadel-hub.com belongs to Platform.**
  Don't cross the streams in docs or customer-facing strings.

## 4. Consolidated owner ops checklist (the only remaining work)

Everything code-side is green across all three repos. These are the switch-flips and
live drills only Kurt can run, in order. Details for A–F live in `docs/CITADEL_GO_LIVE.md`.

### Soft launch (Cloud + Agent, invite-only)
- [ ] **A. Order the code-signing cert** (OV/EV, multi-day issuance — the long pole).
      Wiring is ready: `installer/SIGNING.md`; set `CITADEL_SIGN_PFX_BASE64` +
      `CITADEL_SIGN_PASSWORD` GitHub secrets when it arrives.
- [ ] **B. Confirm Stripe is in LIVE mode** in Coolify for citadel-cloud. The API boots
      (health is green), so keys are set — verify they're `sk_live_`, the 4 products/
      prices exist in live mode, and the webhook secret matches
      (`npm run setup:stripe-webhook` against the live key).
- [ ] **C. Confirm prod Postgres is a TimescaleDB image** (`shared_preload_libraries=timescaledb`).
- [ ] **D. Pair one real server**: install `CitadelSetup-*.exe` on a real box, pair to
      the live cloud, smoke-test restart / ban→unban / broadcast / telemetry (works
      mod-free thanks to the RCON fallback).
- [ ] **E. Invite trusted admins.**

### Public launch (paid, open)
- [ ] **F. Signed installer** through a clean-box SmartScreen check (blocked on A).
- [ ] **G. Live money-path test**: checkout → license activation → Cloud entitlement
      gate on a clean machine.
- [ ] **H. Off-box DB backups + one restore drill** — BOTH SaaS products:
      cloud per `DB_BACKUP_RUNBOOK.md` (Coolify S3 schedule + drill), platform needs
      R2/B2 credentials for offsite copies.
- [ ] **I. Set `OPS_ALERT_WEBHOOK_URL`** in platform's Coolify env (alerting is silent without it).
- [ ] **J. Verify `citadels.cc` SPF/DKIM/DMARC** (all transactional email rides it).
- [ ] **K. Mod-feature QA** with @CitadelAdmin loaded (kick/teleport/spawn/heal/time/
      weather/vehicle round-trips per cloud `CLOUD_OPS_VALIDATION.md`) — repack the mod
      first to pick up the 2026-07-01 sanitization fix.
- [ ] **L. Install drills**: fresh install + in-place upgrade over an existing `C:\Citadel`.
- [ ] **M. Cut agent v2.27.0**: merge the button-up PR, then push the `v2.27.0` tag
      (this publishes to live auto-updaters — do it deliberately).

### Platform (already live with customers — keep-the-lights-on items)
- [ ] **N. Merge the hygiene PR** (domain fix, `.env.example`, CLAUDE.md, CI) and
      consider branch protection on `main` so CI gates the auto-deploy.
- [ ] **O. Confirm one live LB Core test purchase** on a customer server (the named-field
      wire format landed 2026-06-25; one real purchase closes the loop).

## 5. Repo hygiene status (2026-07-01)

| Repo | Tests | Lint | CI | Notes |
|---|---|---|---|---|
| DayzServerController | 461 pass / 0 fail (Jest, coverage ratchet) | 0 errors | lint+test+build on PRs | `ws` advisories cleared; `uuid@14`/`fast-xml-parser@5` majors deliberately deferred |
| citadel-cloud | none **by policy** | none by policy | type-check + build | security-audit residuals tracked in `CLOUD_AUDIT_REPORT.md` |
| citadel-platform | none | none | added 2026-07-01 (typecheck + build) | `tsc` + boot-time `prisma migrate deploy` are the gates |
| citadel-mods | in-game compile is the gate | `enforce_lint` clean | — | key-file ignore rules + egress sanitization landed 2026-07-01 |
