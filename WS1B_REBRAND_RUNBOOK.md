# WS1b — Installer / Packaging Rebrand Runbook

**Goal:** finish the "Citadel Agent → Citadel Server Manager" rebrand for the
parts that require an installer/desktop **build** to verify, plus the GitHub
repo rename that must be coordinated so deployed auto-updaters don't break.

> **STATUS (2026-06-17).** Step 1 installer labels ✅ and Step 2a/2b/2c repo
> rename + feed re-point ✅ are **merged** (PRs #18–21); the repo is now
> `Sk3tch-Dev-Ux/citadel-server-manager`. The **domain consolidation to
> citadel-hub.com** (new — Step 4 below) is **code-complete** and folds into the
> same release. What's left is *runtime verification on a real box*: the Step 1
> installer build-test, the Step 2d auto-update end-to-end check, and the Step 4
> deploy cutover. Nothing here is a code task anymore — it's build + deploy.

**What's already done (committed on `claude/release-hardening-2026-06-15`):**
- All in-app visible strings (dashboard, desktop window/tray/menu/About, service
  display name) → "Citadel Server Manager" (WS1a).
- **Installer visible labels** (this commit): `installer/citadel.nsi` `Name`,
  `VIAddVersionKey ProductName`/`FileDescription`, section title, `DetailPrint`,
  Start-Menu/desktop shortcut tooltips, Add/Remove-Programs `DisplayName`, and
  the `MUI_FINISHPAGE_RUN_TEXT` all now read "Citadel Server Manager".
  `install.bat`/`install.ps1` headers and the `release.yml` uninstall note too.
- `desktop/package.json` `description` + `shortcutName` → new name.

**Machine anchors deliberately KEPT (changing any of these orphans existing
installs or breaks auto-update — do NOT touch them in a label pass):**

| Anchor | Where | Why it must stay |
|---|---|---|
| Service name `CitadelServer` | `backend/lib/service-installer.js:27`, `install.ps1:22`, `desktop/src/auto-updater.js:61`, `installer/citadel.nsi` (nssm stop/start/remove) | Renaming orphans the running service on upgrade |
| Install dir `C:\Citadel` | `citadel.nsi` `InstallDir` | Upgrade-detection anchor; preserves `data/`+`.env` in place |
| Registry `HKLM\Software\Citadel` (+ ARP key `…\Uninstall\Citadel`) | `citadel.nsi` | Upgrade detection + uninstall entry identity |
| `CitadelSetup-*.exe` filename | `citadel.nsi` `OutFile`, `build.js`, `release.yml`, **and the self-update allowlist** `backend/lib/agent-updater.js` | The agent's download allowlist matches this exact name |
| Desktop `productName: "Citadel"` → `Citadel.exe` | `desktop/package.json:29` | NSIS shortcut targets reference `desktop\Citadel.exe` |
| `appId cc.citadels.desktop`, Start-Menu folder + `Citadel.lnk` filenames | `desktop/package.json:28`, `citadel.nsi` | Per-user state + pinned-shortcut continuity |
| `FIXED_SALT` crypto constant | `backend/lib/credential-encryption.js:23` | Changing it makes every user's stored encrypted creds undecryptable |

---

## Step 1 — Build-test the installer branding (no repo rename needed)

On the Windows build box (needs NSIS + the bundled Node runtime):

```bash
npm run build                 # web/dist
node installer/build.js       # → build/CitadelSetup-<version>.exe
```

Then on a throwaway VM / spare box:
1. **Fresh install** → confirm the wizard title, Start-Menu/desktop shortcut
   tooltips, and **Apps & Features** all read **Citadel Server Manager**, while
   it still installs to `C:\Citadel` and registers the `CitadelServer` service.
2. **In-place upgrade** over an existing `C:\Citadel` install → confirm `data/`
   and `.env` are preserved, the service is stopped/re-registered (not
   duplicated), and the pinned `Citadel.lnk` still launches.
3. Launch → desktop window title + tray + Help→About read the new name.

> If anything reads "Citadel Agent" still, grep the staging copy:
> `grep -rn "Citadel Agent" build/staging` (should be empty).

---

## Step 2 — GitHub repo rename + auto-update re-point ✅ DONE (PRs #18–21)

> All ref edits below were applied and the repo was renamed to
> `citadel-server-manager` (the 2a table is kept for the historical record and
> as the template if a future rename is ever needed). **The one remaining item
> is 2d — verify auto-update end-to-end from a previous release** once a new
> build is published. Stale `…/DayzServerController` links in README, docs, and
> the cloud marketing site were swept to the new name on 2026-06-17.

⚠️ **Do not apply these edits before renaming the repo** — every deployed agent
& desktop polls the *current* repo for updates; flipping the refs early points
them at a repo that doesn't exist yet. Sequence:

**2a. Ship one release that re-points the refs (still from the OLD repo name),**
so the *next* update an existing user pulls already knows the new feed. Edit:

| File:line (current) | Change |
|---|---|
| `backend/lib/agent-updater.js:31` | `RELEASE_PATH_PREFIX = '/Sk3tch-Dev-Ux/<NEW-REPO>/releases/download/'` |
| `desktop/src/auto-updater.js:49` | `FEED_REPO = '<NEW-REPO>'` (owner unchanged) |
| `desktop/package.json:57` | `"repo": "<NEW-REPO>"` |
| `installer/build.js:553-554` | `app-update.yml` owner/repo (writes the desktop feed) |
| `backend/tests/agent-updater.test.js:7,16,20` | update asserted URLs to `<NEW-REPO>` |
| `backend/tests/update-checker-url.test.js:18` | update asserted URL |
| `desktop/src/menu.js:46` | "Report an Issue" GitHub link |
| **Cloud** `packages/api/src/config.ts:405` | default `'Sk3tch-Dev-Ux/<NEW-REPO>'` |
| **Cloud** `.env.example:103`, `.env.production.example:125`, `docker-compose.coolify.yml:101` | `GITHUB_REPO=Sk3tch-Dev-Ux/<NEW-REPO>` |

Run `cd backend && npm test` (the two updater tests must pass) before tagging.

**2b. Rename the repo on GitHub** (Settings → rename). GitHub keeps a redirect,
but treat it as a temporary cushion, not permanent.

**2c. Update the live Cloud deploy:** set `GITHUB_REPO=Sk3tch-Dev-Ux/<NEW-REPO>`
in the Coolify env (the installer-download proxy reads it) and redeploy.

**2d. Verify auto-update end-to-end:** from a machine running the *previous*
release, confirm both the agent self-update and the desktop electron-updater
pull the next version from the renamed repo.

> Suggested new repo name: `citadel-server-manager` (matches the product).
> The npm package `name` (`citadel`) and `desktop` package `name`
> (`citadel-desktop`) are internal and need not change.

---

## Step 3 — Optional later: rename machine anchors (NOT recommended for v1)

If you ever want `CitadelServer`→`CitadelServerManager` (service) or a new
install dir, that's a migrating installer (stop+remove old service, register
new; detect old `C:\Citadel`, move `data/`+`.env`). It's a separate, higher-risk
project — the labels above already give users the full rebrand without it.

---

## Step 4 — Domain consolidation to citadel-hub.com (code DONE — deploy cutover)

The canonical scheme (owner-confirmed 2026-06-17) is:

| Surface | Host |
|---|---|
| Marketing (`/`, `/cloud`, `/mods`, `/pricing`, `/docs`, `/appeal`) | `citadel-hub.com` |
| App (`/dashboard`, `/account`, `/auth`, `/admin`, `/cloud/console`) | `app.citadel-hub.com` |
| API / WebSocket / Stripe webhook / `.well-known` | `api.citadel-hub.com` |

**Code is complete** across both repos (agent runtime API/WS defaults, the
auto-update download allowlist, the `@CitadelAdmin` mod endpoint, desktop +
frontend UI, cloud error strings/SEO/CSP/scripts, `.env*.example`,
`docker-compose.coolify.yml` Traefik rules, and all docs). **Deliberately left
on `citadels.cc`:** the JWT `issuer` (pinned in `license/verifier.js` — opaque,
breaking to change) and the Resend email senders (DNS-bound). Both are owner A/B
decisions, not oversights.

**Transition safety (already baked in):** the agent's download allowlist
(`agent-updater.js`) and the Coolify Traefik host rules accept BOTH the new and
legacy hosts, so already-deployed agents keep updating until they roll forward.

**Cutover order (do NOT reorder — a new agent build must not ship before the API
answers at the new host):**
1. Point DNS + Traefik at `citadel-hub.com` / `app.` / `api.`; keep the legacy
   `citadels.cc` / `cloud.citadel-hub.com` routes live in parallel.
2. Set Coolify env: `API_PUBLIC_URL`, `NEXT_PUBLIC_API_URL` → `https://api.citadel-hub.com`,
   `NEXT_PUBLIC_WS_URL` → `wss://api.citadel-hub.com`, `FRONTEND_URL` →
   `https://citadel-hub.com`, `CORS_ORIGINS` → `https://citadel-hub.com,https://app.citadel-hub.com`.
   Redeploy web (its CSP now only allows `api.citadel-hub.com`).
3. **Then** publish the new agent/desktop release (its defaults now resolve to
   `api.citadel-hub.com`); `api.citadels.cc` must keep serving for un-updated installs.
4. Once traffic drains, optionally set `CANONICAL_WEB_HOST=citadel-hub.com` to
   301 the legacy web hosts.

> Open design note: `FRONTEND_URL` is a single value but feeds both marketing
> (`/trust`) and app (`/account` checkout-return) links. With the app on its own
> subdomain it may need splitting into a marketing base + an app base — decide
> before relying on checkout-return URLs landing on the right host.
