# Citadel — Go-Live Runbook

**Generated:** 2026-06-23 · **For:** Kurt (owner) · **Repos:** `DayzServerController` (agent) + `citadel-cloud` (SaaS) + `citadel-mods/CitadelAdmin` (in-game mod)

> **Status update (2026-07-01):** §1–§2 are DONE — both repos resynced, the broadcast
> RCON fallback merged as agent PR #24, and the §3F sidecar gating merged as cloud
> PR #68. Cloud + platform are deployed and serving (api.citadel-hub.com healthy).
> The §5 hardening items landed 2026-07-01: `ws` advisories cleared (agent),
> `PostOneResult` id sanitization + key-file `.gitignore` rules (citadel-mods).
> Remaining work is the §3A–E / §4 owner-ops checklist; the family-wide successor
> checklist lives in `docs/CITADEL_FAMILY.md`.

This is the single checklist that turns "three months of work" into "live." It is split into
**what's already done**, **what I (Claude) did tonight**, and **what only you can do** — in the order to do it.
Every owner step has the exact command or click. Time estimates are real.

---

## 0. Where you actually stand (verified against current source, 2026-06-23)

- **You do NOT need to rewrite anything.** The CitadelAdmin mod is **<10% borrowed** (and that 10% is
  *comments + one attribution credit*, not copied code). All 28 files are original, `Citadel*`-named,
  Enforce-correct, **v2.0** ("Sidemod Reloaded and Reworked"). The from-scratch relay you keep meaning to
  write **already exists as your own code.** Verdict: **keep-and-harden, ship.**
- **The one historical security hole is already fixed** — the cloud-id-as-filename path-traversal in
  `CitadelCommandRunner.c:590-605` is sanitized to `[A-Za-z0-9-_]` and rejects empties. **Do not "fix" it
  again** — it's done.
- **Everything compiles green right now:** cloud `type-check` 5/5 · agent backend **461 tests pass / 0 fail**
  · frontend Vite build OK. Both repos' `main` are current. **Nothing left to build.**
- **What's left is OPS + live verification**, not code. That's the good news and the hard news: the long pole
  is the **code-signing cert (multi-day issuance)** — order it FIRST.

### Two-track launch
| Track | When | What it is |
|---|---|---|
| 🟢 **SOFT (invite-only)** | **Tomorrow, realistic** | Cloud live · 1 agent paired to a real server · control + global ban network + telemetry working. Put it in front of trusted admins. |
| 🔵 **PUBLIC (paid, open)** | **A few days** | Adds: signed installer (past SmartScreen), proven Stripe money-path, off-box backups, mod-feature QA. Gated by the cert clock. |

---

## 1. What I (Claude) did tonight — already applied

- ✅ **Broadcast RCON fallback** — `backend/lib/cloud-bridge/commands.js`. A cloud `broadcast` now uses
  BattlEye RCON `say` when the mod isn't loaded, instead of timing out. **Applied to your working tree,
  backend suite re-run = 461 pass / 0 fail.** Not yet committed (see §2 — your repo needs a resync first).
- ✅ **Verified, did NOT touch:** `CitadelCommandRunner.c` sanitization (already correct);
  the cloud `/ws/plugin` server side (first-party, type-clean).
- ✅ **Stopped a bad cleanup:** the "delete dead stubs under `dayz-mod/@CitadelAdmin/`" step that an earlier
  pass suggested is **wrong** — on `origin/main` that directory is a *full, packable copy of the mod*
  (includes `$PBOPREFIX$`, required to pack the PBO). Your local deletions are against an outdated stub.
  **Resync instead of committing them** (§2).

---

## 2. FIRST: resync your two stale checkouts  ·  ~5 min  ·  owner runs, I prepared

Both local repos are sitting on already-merged branches, slightly behind `origin/main`, with stale
uncommitted deletions. Get clean before anything else. Copy-paste:

```powershell
# --- AGENT repo: drop the stale-stub deletions, keep tonight's broadcast fix, land it on a clean branch ---
cd C:\Users\KurtE\Documents\GitHub\DayzServerController
git checkout -- "dayz-mod/@CitadelAdmin"        # discard the bad stub deletions (keeps commands.js edit)
git checkout main
git pull --ff-only                               # now current; full mod present under dayz-mod/
git checkout -b fix/cloud-broadcast-rcon-fallback
git add backend/lib/cloud-bridge/commands.js
git commit -m "fix(cloud-bridge): RCON say fallback for cloud broadcast on no-mod servers"
cd backend; npm test                             # confirm 461 pass on the clean branch
# when happy:  git push -u origin fix/cloud-broadcast-rcon-fallback   (then open a PR)

# --- CLOUD repo: it's just stale (0 ahead / 3 behind). Decide the doc deletions deliberately. ---
cd C:\Users\KurtE\Documents\GitHub\citadel-cloud
git checkout -- .                                # discard the 12 uncommitted doc deletions (KEEP DB_BACKUP_RUNBOOK.md)
git checkout main
git pull --ff-only                               # now matches what Coolify will deploy
```

> If you *do* want to cull those 12 cloud docs, do it as its own commit and also scrub the dangling
> references in `CLAUDE.md` and `docker/Dockerfile.migrate` — but **keep `DB_BACKUP_RUNBOOK.md`**, you need
> it for §4-C. Not launch-blocking either way; docs aren't in the build.

---

## 3. SOFT LAUNCH (tomorrow) — owner ops, in order

### A. Order the code-signing cert — DO THIS FIRST, before coffee  ·  long-pole
Multi-day issuance. It blocks the *public* launch, not the soft one, but every day you wait pushes public out.
- Buy an **OV or EV code-signing cert** (~$150-500/yr; Sectigo/DigiCert/SSL.com). EV needs a hardware token.
- Runbook for wiring is ready: **`installer/SIGNING.md`**. You'll set 2 GitHub secrets when it arrives:
  `CITADEL_SIGN_PFX_BASE64`, `CITADEL_SIGN_PASSWORD`. The release workflow already no-ops gracefully until
  they're set (`.github/workflows/release.yml:48-69`).

### B. Stripe LIVE keys in Coolify  ·  ~30-60 min  ·  HARD BLOCKER
The API **refuses to boot** in production if any of these are missing (`packages/api/src/config.ts:41-57`).
1. In Stripe (live mode): create the 4 Products/Prices — Citadel monthly/yearly, Cloud monthly/yearly.
2. In Coolify env, set: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_CITADEL_MONTHLY`, `STRIPE_PRICE_CITADEL_YEARLY`,
   `STRIPE_PRICE_CLOUD_MONTHLY` (+ `STRIPE_PRICE_CLOUD_YEARLY` if used).
3. Register the webhook + capture its signing secret:
   `npm run setup:stripe-webhook --workspace=@citadel/api` (against the live key).
> Cross-check against `citadel-cloud/.env.production.example` — every required name is listed there.

### C. Prod Postgres must be TimescaleDB  ·  ~10 min  ·  HARD BLOCKER
Migrations `0009/0023/0025` run `CREATE EXTENSION timescaledb` + `create_hypertable` on 11 telemetry tables.
A plain `postgres` image makes the auto-migrate **fail**.
- Confirm the Coolify-managed Postgres resource uses a **TimescaleDB image** with
  `shared_preload_libraries=timescaledb`. Then deploy `main` — the `migrate` service runs all 35 migrations
  automatically (idempotent).

### D. Deploy + DNS check  ·  ~10 min
- Push `main` → Coolify auto-deploys (`docker-compose.coolify.yml`: migrate → api → web).
- Verify Cloudflare orange-cloud records for `citadel-hub.com`, `app.citadel-hub.com`, `api.citadel-hub.com`
  point at the Coolify origin; confirm legacy hosts redirect. Quick check:
  `curl -I https://api.citadel-hub.com/health` (expect 200).

### E. Install the agent on a real box + pair it  ·  ~20 min  ·  the moment it comes alive
- Run the built `CitadelSetup-*.exe` on a clean/representative Windows machine (NSIS + NSSM service).
- Pair it to your live DayZ server. Confirm the agent connects to `wss://api.citadel-hub.com/ws/plugin`.
- **Mod-independent smoke (works with NO mod loaded):** from the cloud, trigger
  **restart**, **ban → unban**, **broadcast**, and confirm **server FPS + player list (IP/ping/GUID)**
  telemetry is flowing.

### F. Gray out mod-only buttons in the cloud Live Ops UI  ·  important polish
Player-targeted ops (kick/ban-from-live-list, teleport, spawn, heal, kill, set time/weather, vehicle actions)
need the mod's `steamId`+coordinates that RCON can't supply. The agent already reports
`sidecar_running` in its `agent_health` frame (`forwarders.js:163`). **Disable those buttons until
`sidecar_running === true`** so a no-mod operator never hits a dead button. (If this isn't wired yet in the
web UI, it's the one cloud-side change worth making before inviting people — say the word and I'll do it.)

### G. GO / NO-GO for soft launch
✅ Green-light **invite-only** once A–F pass. Position v1 as **"remote server control + global ban network +
live telemetry,"** with all the world/teleport/spawn/vehicle features as the **mod-loaded upsell** — which is
exactly how you sell the mod.

---

## 4. PUBLIC LAUNCH (a few days) — finish these before charging strangers

- **A — Signed installer:** cert arrives → set the 2 GitHub secrets → cut a signed release → confirm a fresh
  Windows box installs with **no SmartScreen "Unknown publisher."**
- **B — Real money-path test:** live Stripe **checkout → license activation → Cloud entitlement gate** round-trip
  on a clean machine. Confirm Cloud Bans/console actually require the paid add-on.
- **C — Off-box DB backups:** the script exists (`citadel-cloud/scripts/backup-db.sh`) but is **not scheduled**.
  Schedule it (or a managed snapshot) to **off-box** storage and run one restore drill per `DB_BACKUP_RUNBOOK.md`.
  *Do this before billing anyone — it's the single riskiest gap for a paid SaaS.*
- **D — Mod-feature QA:** with the mod loaded on a live server, round-trip kick-from-live-list, teleport,
  spawn, heal/kill, set time/weather, and a vehicle action end-to-end.
- **E — Install drills:** fresh install **and** in-place upgrade from an existing `C:\Citadel` (no orphaned
  service); confirm agent + desktop auto-update pull from the renamed repo.

---

## 5. Optional post-launch hardening (NOT blocking — do when you next rebuild the mod / cut a release)

- **`npm audit fix`** (non-force) in `backend/` clears 3 high-sev transitive `ws` advisories. Re-run the suite.
  Leave the `fast-xml-parser@5` / `uuid@14` breaking majors for a deliberate post-launch bump with regression sign-off.
- **Defensive 1-liner (mod):** in `CitadelCloudClient.c` `PostOneResult` (~line 309), wrap the `id` interpolated
  into the result URL `/commands/<id>/result` with the existing `SanitizeId()`. **Low severity, safe in the
  current closed loop** — only matters if the responses dir ever takes externally-authored files. Apply on your
  next mod compile+repack; don't burn a reboot cycle on it now.
- **`.gitignore` for the mod repo:** add `Keys/`, `*.bikey`, `*.biprivatekey` to `citadel-mods/CitadelAdmin/`
  so the private signing key (`Keys/AxionDevKey.bikey`) can never be staged.
- **Traefik WS idle timeout** (Coolify static config) — non-blocking today; the agent heartbeats ~15s.

---

## 6. The one-line truth
You didn't waste three months and you don't need to rewrite anything. All three layers compile clean, `main`
is current, the one real security hole was already closed by you. What stands between you and a real private
launch tomorrow is a handful of ops switches — **order the cert tonight, then Stripe + TimescaleDB + deploy +
pair one server** — and you'll watch it come alive.
