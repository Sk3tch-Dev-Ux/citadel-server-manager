# Citadel v1.0 — Ship Plan

**Locked:** 2026-04-22
**Target ship window:** 2-3 weeks (~19 working days)
**Version target:** v1.0 (graduating from 2.x development, representing the first paid release)

---

## Product decisions

| Decision | Value |
|---|---|
| Pricing | **$14.99/mo**, **$149.99/yr** (save $29.89) |
| Tier structure | Single tier — unlimited servers, team members, data retention, all features |
| Monetization infra | **Paddle** (Merchant of Record, ~5.5% per tx, handles VAT/tax) |
| Device activation limit | **2 per account** |
| Offline grace period | 7 days when license server unreachable |
| Lapsed subscription behavior | Read-only mode + upgrade banner |
| Code signing | **EV code-signing cert** (SSL.com ~$319/yr) — zero SmartScreen warnings |

---

## Architecture

**Flavor B: Service + Desktop App** (one installer, two surfaces)

- **Windows service** (existing, NSSM-managed) — Node backend runs 24/7, survives RDP logoff. Critical for Discord bot, scheduled restarts, RCON keep-alives.
- **Electron desktop app** (new) — primary user-facing surface. Reuses existing React frontend as-is. Native window, system tray, auto-update. Paddle license activation happens here.
- **Web UI at `localhost:3001`** — stays available for power users who want LAN access from another machine.
- **Account site on citadels.cc** — Node + Fastify + SQLite + Nginx. Paddle checkout, user accounts, license API, download gating.

---

## Phase plan

### Phase 0 — Ship blockers *(2 days)*
Things that would embarrass or hurt users on day one.

- [ ] Fix broken release CI (`release.yml` calls non-existent `build/bundle.js`; produces ZIP instead of EXE)
- [ ] Service startup health check — NSIS shouldn't open browser until backend API is responding
- [ ] `install.ps1` must stop service before copying files (fixes file-lock on upgrade)
- [ ] Force admin password change on first login (kill the `admin/admin` default)
- [ ] Validate CORS origins at boot — warn/refuse wildcard in `citadel.config.json`
- [ ] Fix broken `/purchase` nav link (redirect to `/pricing` or remove)

### Phase 1 — Electron desktop app shell *(5 days)*
The premium product surface.

- [ ] Scaffold `desktop/` folder with Electron main process
- [ ] Load existing React frontend in renderer (BrowserWindow + `loadURL('http://localhost:3001')` or packaged bundle)
- [ ] Custom window chrome (title bar, min/max/close, optional frameless design)
- [ ] System tray with right-click menu (Open, Pause Service, Quit)
- [ ] IPC for native operations (file pickers, open-in-explorer, notifications)
- [ ] Auto-update via `electron-updater` (GitHub Releases as update server initially, citadels.cc CDN later)
- [ ] App icon + branding (Citadel logo as .ico, splash screen)
- [ ] Handle "backend not running" gracefully — show installer hint or start service from app

### Phase 2 — Licensing + delivery *(4 days)*
How paid users actually get the product.

**On citadels.cc (Ubuntu VPS, add via Docker + existing GitHub deploy):**
- [ ] User accounts: signup, login, password reset, email verification (transactional email via Resend or Postmark)
- [ ] Account dashboard: subscription status, **Download Citadel** button, billing portal link, device list (2 slots shown)
- [ ] Paddle integration: hosted checkout, webhook handler (`/webhook/paddle`) for subscription state changes
- [ ] License API: `POST /api/license/activate` (email+pw → signed token, machine bound), `GET /api/license/verify` (token → status), `DELETE /api/license/deactivate` (free up a slot)
- [ ] Download gating: `/download` redirects to `/login` if not authenticated, then to `/account/download` with signed URL

**In Citadel desktop app:**
- [ ] Setup-wizard step: "Enter citadels.cc credentials"
- [ ] License client in backend (`backend/lib/license-client.js`): activates on first run, refreshes every 24h
- [ ] Machine ID binding (Windows `MachineGuid` from registry)
- [ ] Graceful offline mode (7-day grace), lapsed state (read-only + upgrade banner)

### Phase 3 — Installer polish *(3 days)*
Frictionless one-click install.

- [ ] Purchase EV code-signing cert from SSL.com (~1-3 day approval)
- [ ] Integrate `signtool` into `installer/build.js` (sign `CitadelSetup-*.exe` after NSIS build)
- [ ] NSIS icon + custom branding
- [ ] Port 3001 conflict detection at install time (fail fast with clear message)
- [ ] Windows Firewall rule creation during install (inbound TCP 3001 for LAN access)
- [ ] Checksum verification (SHA256) on downloaded Node runtime + NSSM during build
- [ ] Consolidate to one uninstaller — remove `uninstall.ps1`, rely on Add/Remove Programs entry
- [ ] NSSM graceful-stop tuning (proper wait + kill escalation)

### Phase 4 — Docs + polish *(3 days)*
The "looks like a real product" phase.

- [ ] 5-8 screenshots: dashboard, types editor, live map, mod manager, Discord bot panel, in-game mod. Add to docs + README.
- [ ] Delete `CHANGELOG.md`, `CHANGELOG_v2.1.0.md`, `DISCORD_CHANGELOG.md`, `discord_changelog.txt` at repo root. Single source: `docs/changelog.md`.
- [ ] Rewrite/remove `docs/deployment-walkthrough.md` (still references pre-pivot Cloud + Stripe flow)
- [ ] Document 15 missing backend route groups in `docs/reference/` (audit, watchlist, globals/events/limits editors, expansion.*)
- [ ] Move docs from GitHub Pages to **citadels.cc/docs** (DNS/reverse-proxy on your Ubuntu VPS)
- [ ] CI parity check: script greps `backend/routes/*.js` against `docs/reference/` and fails build on undocumented routes

### Phase 5 — End-to-end dry run *(2 days)*
Prove it works before press release.

- [ ] Smoke tests for critical paths (auth, file write, RCON, backup, license activate) — ~20 tests, not 500
- [ ] Clean Windows VM: install → pay via Paddle sandbox → download → install → activate → use dashboard
- [ ] Simulate subscription cancel → verify read-only mode kicks in after grace period
- [ ] Simulate 3rd device activation → verify rejected with clear message

---

## Post-v1.0 backlog (not gating ship)

- **v1.1 — perf:** virtualize large editor tables (types.xml 1000+), streaming XML parse, fix silent `catch {}` blocks, harden data-store write queue
- **v1.2 — features:** Live Map system (visual zone/marker placement), Expansion Quest Creator
- **v2.0 — platform:** Linux/Mac desktop app, multi-server management from one Manager

---

## Open dependencies

| Dependency | Who | Lead time |
|---|---|---|
| Paddle merchant account | You | 1-3 days approval |
| SSL.com EV cert + USB token | You | 1-3 days + shipping |
| Resend/Postmark for transactional email | You | Same day |
| Price decision: $14.99 or $15.99? | You | Blocked until confirmed |

## Starting order

1. **Now:** Fix release CI (Phase 0 item 1) — ~1 hour, unblocks future releases
2. **Today:** Start Paddle merchant signup, order EV cert — lead-time items
3. **Parallel:** Scaffold Electron shell (Phase 1) while awaiting cert
4. **Once cert arrives:** Phase 3 installer signing work
5. **Once Paddle approved:** Phase 2 licensing integration
