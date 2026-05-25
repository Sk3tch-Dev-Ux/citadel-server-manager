## Citadel Agent v2.19.0 — The Agent/Cloud split

This is a product-direction release, not a feature release. With Citadel
Cloud coming back online as the connected platform, the local app no
longer needs to carry every feature itself. **Citadel Agent** is now
focused on what it does best — installing, configuring, modding, and
operating DayZ servers directly on the owner's machine. Anything that
needs centralized infrastructure, automation that survives a sleeping
PC, or cross-machine visibility moves to **Citadel Cloud** at
[citadels.cc/cloud](https://citadels.cc/cloud).

If you self-host and never planned to use Cloud, the local feature set
you care about (server install, mod manager, config editors, file
browser, backups, RPT logs, RCON, start/stop/restart, local bans) is
unchanged and clearer than it was before. If you were on the way to
Cloud anyway, this release sets up the seam.

**Drop-in upgrade in terms of disk state** — the install path, registry
key, Windows service, executable filename, and `%APPDATA%/Citadel/` data
folder all stay identical. Existing user accounts, license activation,
saved server configs, bans, watchlist, priority queue, backups, and mod
cache survive the upgrade untouched. Only the UI and the auto-spawned
processes change.

**One breaking change to note up front:** the dashboard now binds to
`127.0.0.1` (loopback) by default instead of `0.0.0.0`. If you used to
browse to `http://<server-ip>:3001` from another machine on your LAN,
add `BIND_HOST=0.0.0.0` to your `.env` to opt back in (the Agent will
log a security warning). The intended remote-access path going forward
is Citadel Cloud, not direct LAN exposure of the Agent.

---

### What's in this release

- **Rename to Citadel Agent.** Window title, tray, menu, About dialog,
  installer chrome, splash page, README headline — everywhere a user
  sees the product name, it's now "Citadel Agent". Machine identifiers
  (install path, registry key, Windows service name, exe filename,
  AppData folder) deliberately stay "Citadel" so upgrades land in place.

- **Loopback bind by default.** New `server.bindHost` config (env:
  `BIND_HOST`). Default `127.0.0.1`. Set to `0.0.0.0` for LAN access.
  Anything other than loopback logs a security warning at startup.
  Remote access is now a Citadel Cloud concern.

- **Cloud Bans management UI removed; Trust Network sync stays.** The
  `/global-bans` page and its sidebar entry are gone. Submitting bans to
  the Trust Network, browsing the global pool, and managing
  false-positive reviews all happen at citadels.cc/cloud now. The Local
  Agent still downloads the synced ban list and writes it to each
  server's `ban.txt` — that's local execution work and has to stay here.
  A small status banner on the Bans page shows how many community bans
  are currently applied, with a deep-link to manage in Cloud.

- **Restart Scheduler UI + engine removed.** The per-server scheduler
  page is gone and the in-Agent cron loop no longer starts. Any
  schedules sitting in `data/restart-schedules.json` are inert and left
  on disk for your inspection. Cloud will own scheduling going forward
  and call the Agent's existing `/api/server-control/restart` endpoint
  when a window fires. "Restart now" controls are unchanged.

- **Webhook config UI removed; internal events still emit.** The
  `/webhooks` page and CRUD routes are gone, and outbound HTTP delivery
  is stubbed (`fireWebhooks` and `sendDiscordWebhook` log only). The
  ~20 internal call sites that emit events on lifecycle changes, mod
  updates, crashes, watchlist hits, etc. stay intact — they're the seam
  that will be rewired to emit upward to Cloud once that channel ships.
  If you relied on the Agent delivering Discord webhooks directly,
  that delivery is gone in this release.

- **Discord bot extracted to its own repo.** The Citadel Discord bot
  now lives at [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot).
  The Agent no longer launches the bot as a child process. Existing
  customers who want the bot running can either run the citadel-bot
  repo standalone (it still calls into the Agent's `/api/discord/*`
  surface with the same `DISCORD_BOT_API_KEY` auth) or set
  `CITADEL_AGENT_SPAWN_BOT=1` in `.env` as a legacy escape hatch for
  one release. Citadel Cloud will host the bot going forward so its
  uptime doesn't depend on your home PC.

- **Server Hub reframed.** Breadcrumb is now "Your Servers" instead of
  "Server Hub." A small positioning line above the stats explains this
  is the servers managed by *this* Agent, and links to Cloud for
  multi-machine fleet view. The batch start/stop/restart actions are
  unchanged.

- **License banner copy clarified.** Five subscription states
  (unactivated / grace / past-due / lapsed / expired) all said "Citadel
  Cloud" when the underlying state was actually the base Citadel
  subscription. Fixed across all variants so renewal and reconnect copy
  reads correctly. The base subscription activates the Agent; the Cloud
  add-on is separate.

- **Setup wizard reframed.** Welcome heading and intro paragraph now
  describe Citadel Agent as "local DayZ server management for Windows."
  The completion step has an explicit optional next-step line pitching
  Citadel Cloud for remote control, automations, and the Trust Network.

- **Pre-split planning docs removed.** `AUDIT_REPORT.md`,
  `AUDIT_REPORT_2026-05-19.md`, `ROADMAP.md`, `PRIORITIZED_FIXES.md`,
  and `docs/admin/smoke-test-global-bans.md` all described a product
  surface that doesn't exist post-split. They're recoverable from git
  history if you want to look back. Live admin docs had dangling
  references to those files removed surgically.

---

### What did NOT change

To set expectations clearly — everything below works the same as v2.18.6:

- **Install path** (`C:\Citadel`), **registry key** (`Software\Citadel`),
  **Windows service** (`CitadelServer`), **executable filename**
  (`Citadel.exe`), and **userData directory** (`%APPDATA%/Citadel/`).
- **All local server management** — SteamCMD install/deploy, Steam
  Workshop mod manager (search/install/update/uninstall/reorder), every
  config editor (serverDZ.cfg, types, events, globals, limits,
  spawnabletypes, spawnpoints, economycore, expansion trader/quests/
  loadouts, mod configs), File browser with Monaco editor, mission and
  profile folder management.
- **Server lifecycle controls** — start, stop, restart, force-quit.
- **Local bans** (`data/bans.json`) with per-server `ban.txt` sync.
- **Local backups** + retention policies.
- **RPT log tailer** + crash detector + console.
- **RCON / BattlEye client** with command history.
- **Kill feed**, **chat log**, **watchlist**, **priority queue (VIP)**,
  **player profiles**.
- **In-game admin mod** (`@CitadelAdmin`) and the file-based IPC bridge.
- **License activation flow** at `/citadel-license` — sign in with your
  citadels.cc account, refresh, deactivate.
- **Trust Network ban enforcement** — the synced ban list is still
  downloaded hourly and written to every server's `ban.txt`. Only the
  management UI moved.
- **Local user accounts, roles, permissions, audit log.**
- **In-app notification center** (`addNotification`) — the in-app side
  of the event flow stays; only outbound HTTP delivery is stubbed.

---

### Migration guide

| What you were doing | What to do now |
|---|---|
| Browsing dashboard from another machine on your LAN | Add `BIND_HOST=0.0.0.0` to `.env` (logs a security warning), or pair with Citadel Cloud for proper remote access. |
| Configuring outbound webhooks in the `/webhooks` page | Migrate them to Citadel Cloud once the webhook fan-out feature ships there. Local delivery is stubbed in this release. |
| Scheduling automatic restarts in `/servers/*/scheduler` | Move schedules to Citadel Cloud. Old `data/restart-schedules.json` is left on disk untouched but no longer loaded. |
| Submitting bans to the Trust Network from `/global-bans` | Manage at citadels.cc/cloud. Locally-issued bans still auto-submit to the Trust Network in the background; only the browse/manage UI moved. |
| Running the bundled Discord bot | Either run [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot) as a separate process (point `PANEL_API_URL` at the Agent), or set `CITADEL_AGENT_SPAWN_BOT=1` for one more release. |

---

### Behind the scenes

- **27 + 11 + 2 files changed** across the three refactor commits.
  Net: ~4,700 lines deleted, ~315 added. Most of the deletion is the
  three big page components (GlobalBansPage, RestartSchedulerPage,
  WebhooksPage) and the four root-level planning docs.
- **The internal event bus stayed intact.** `fireWebhooks(eventType, data)`
  is called from ~20 places — server lifecycle, auto-updater, polling,
  crash detector, mods, watchlist. All 20 sites are preserved. The
  function just no longer delivers outbound; it will be rewired to emit
  upward to Cloud in a future release.
- **bot-manager is still importable.** It's a no-op when no child
  process is running. This keeps `polling.js`'s graceful-shutdown call
  safe and lets the legacy env-var path work.
- **`/api/cloud-bans/status` and `/api/discord/*` are still served**
  so external callers (the license banner, the relocated Discord bot)
  continue to work.

---

### Coming next

- **Citadel Cloud feature rollout** at citadels.cc/cloud — scheduled
  restarts, automated messages, multi-Agent fleet view, webhook
  fan-out, hosted Discord bot. Independent track from this Agent
  release.
- **Citadel Bot v1** — the standalone Discord bot repo gets its own
  release cycle.
- **Cleanup** — the `/discord-bot/` folder will be removed from this
  repo after this release ships and customers have had a chance to
  migrate. The dead webhook helpers in `lib/notifications.js` will
  follow once the Cloud event channel takes their place.
