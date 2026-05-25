# v2.20.0 — Citadel Cloud is plugged in

The companion release to v2.19.0's split. Where 2.19 *renamed and reframed*
the Agent vs Cloud halves, 2.20 is the first build where the Agent
**actually talks to Cloud over the wire** — a per-DayZ-server WebSocket to
`wss://api.citadels.cc/ws/plugin`, in the same shape CFTools/GameLabs uses
for their cloud↔agent pairing.

If you've been wondering why your servers haven't been showing up in
`citadels.cc/cloud/console` after Cloud sign-in — they weren't supposed to
yet. They are now.

---

## What's new

### Cloud pairing (the headline)

A new **Citadel Cloud** card lives at the top of each server's Settings
page. Two fields: paste the Server ID and the API key from
[citadels.cc/account → Plugin servers → + Add server](https://citadels.cc/account),
hit **Pair**, and the Agent opens an authenticated WebSocket to Cloud for
that DayZ server. Status flips live as the supervisor reconciles —
*Pending → Connected*, or *Auth failed* with the reason inline if you
mis-paste.

Under the hood:

- **One WS per DayZ server**, not per install. Cloud single-socket enforces
  this with code `4007` (`CLOSE_SUPERSEDED`) — pair the same key in two
  places and the older connection drops. Matches Cloud's design.
- **Encrypted at rest.** The API key never sits plaintext on disk. The
  existing AES-256-GCM credential-encryption helper wraps it in
  `data/plugin-servers.json`.
- **Auto-connect on linked + running.** The supervisor opens the WS when
  the DayZ server transitions to `running`, closes it when stopped. No
  WS spinning for offline servers.
- **Auth-failure semantics.** A 401 from the Cloud `/api/v1/license/activate`
  endpoint no longer logs you out of the Agent (see Fixed below) —
  the dashboard's session-expired handler used to mis-fire on Cloud
  credential failures and bump you back to the Agent login screen.

### Telemetry streaming

Once the WS is authenticated and the `@CitadelAdmin` mod is loaded on the
server, the Agent now pushes:

- **`metrics`** every 15s — FPS×100 integer (the cloud divides), player
  count, AI/animal/vehicle/entity counts, uptime. Sourced from the mod's
  `metrics.json` (already in the cloud-expected shape — direct passthrough).
- **`player_position`** — batched live positions from the mod's
  `players.json`. Heading sent as `0` for now; the mod doesn't expose
  orientation yet.
- **`player_connect` / `player_disconnect`** — derived from
  `events.jsonl`. Disconnect carries `duration` in seconds; the forwarder
  tracks session-start per `steamId` so even the lighter
  `{type: 'disconnect'}` event variant gets a meaningful duration.
- **`kill`** — killer/victim ids+names, weapon, distance, both positions,
  `is_headshot` plus a normalized `hit_zone` (head/brain/torso/limb)
  derived from the mod's free-form `DamageZone` string.
- **`death`** + **`suicide`** — death cause coerced into the Cloud's
  `DeathCause` enum (pvp/suicide/fall/infected/explosion/animal/
  environment/unknown) via substring match on the mod's free-form text.
- **`chat`** — channel + message + speaker.

### Inbound commands (Cloud console → DayZ)

The live-ops console at `citadels.cc/cloud/console` can now push commands
to a paired server. The Agent translates Cloud's `CommandAction`
vocabulary to the mod-side IPC actions and replies with `command_result`
carrying the original id:

| Cloud command | → | Mod action |
|---|---|---|
| `kick` | → | `player.kick` |
| `ban` | → | `player.kick` (durable list arrives via `config_sync`) |
| `heal` / `kill` / `teleport` / `spawn_item` / `message` | → | `player.*` |
| `broadcast` / `set_time` / `set_weather` / `wipe_ai` / `wipe_vehicles` | → | `world.*` |

### Cloud Bans push (`config_sync`)

When Cloud pushes its authoritative ban set to a paired server, the Agent
writes it atomically to `$profile:Citadel/config_bans.json` for the mod
to consume. Mod-side enforcement (deny on connect) is a follow-up — the
file is in place and ready.

---

## What moved to Cloud

Five surfaces that made more sense at the Cloud layer (one trust graph,
one cross-server view) are removed from the Agent:

- **Chat Log** (`/chat-log`)
- **Kill Feed** (`/kill-feed`)
- **Live Dashboard** (`/live`)
- **Bans** (`/bans`) — local management UI only; `data/bans.json` stays
  on disk for the future migration, and per-player ban actions on the
  Players page still work.
- **Watchlist** (`/watchlist`) — `data/watchlist.json` stays; the
  on-connect alert path still fires from `player-profiles.js`.

The `bans.manage` permission is dropped from the Moderator role since the
surface it gated is gone.

---

## Fixed

- **New server didn't appear after Deploy.** `ServersContext.loadServers`
  carried a stale `if (!API.token) return` guard from before the M11
  cookie-auth migration. `API.token` is always `''` under cookie auth, so
  the gate was a permanent no-op — the server list never refreshed after
  the initial load. Removed. Also added a 750ms follow-up refresh after
  the `deployProgress: complete` socket event to absorb backend write
  timing.

- **Cloud sign-in bumped you to the Agent login.** When you typed wrong
  Citadel Cloud credentials, the API forwarded Cloud's 401 verbatim. The
  dashboard's global 401 handler interpreted that as Agent session
  expiry and logged you out. Backend now rewrites upstream 401/403 from
  `citadels.cc` to `422` so credential failures stay body-level errors,
  not session ones.

- **Activation banner sat stale for up to 5 min after activation.** The
  banner polls `/api/citadel-license/status` every 5 minutes; the
  license page's local refresh didn't notify it. Now dispatches a
  `citadel:license-changed` window event on activate/refresh/deactivate
  that the banner subscribes to. Also clears the per-session "dismissed"
  flag on activate so a previously-dismissed banner doesn't re-appear.

---

## Upgrade notes

- **Cloud-side dependency.** Pairing requires `citadel-cloud` ≥ commit
  `f17348e` deployed on `api.citadels.cc` (the `Plugin servers` UI on
  `/account` is the visible signal). If you self-host Cloud, redeploy it
  first.
- **No DB migrations.** This is an Agent-only release.
- **No config changes required.** The new `cloud-bridge` supervisor
  reuses `CITADEL_LICENSE_API` for the WS URL — same env var, no new
  one to set.
- **Per-server pairing.** Each DayZ server needs its own Server ID + API
  key from Cloud. The pairing UX is identical to CFTools/GameLabs except
  the credentials live in the Agent's encrypted store, not in a mod
  config file.
- **`ws@^8.18.0`** added as a backend dependency. The installer bundles
  it; no manual install needed for end users. Same library + same major
  as Cloud's plugin binary uses internally.

---

## Known limitations

These are deliberate scope cuts — coming in follow-ups:

- **`vehicles` / `world_events`** forwarders aren't wired yet. The mod
  already writes `vehicles.json` and `events_world.json` to disk; the
  Agent side just needs to plumb them through. Trivial follow-up.
- **`player_stats_update`** (accuracy → anti-cheat) needs mod-side
  shots-fired/hits tally hooks. Tracked separately in the alignment
  spec.
- **`battleye_guid`** on `player_connect` is sent as omitted — the mod
  doesn't expose it yet. Coordinated change with `@citadel/shared`.
- **TrustScore display in PlayerProfile** — Cloud computes it but no
  Agent UI consumes it yet.
- **Cloud-side `Rotate key` doesn't force-close the live socket.** The
  next idle-timeout (60s) closes it naturally on the first missed ping.

---

## Verification

- Backend `node --check` + `eslint --quiet` clean on all new modules
  (`cloud-bridge/{storage,ws-client,supervisor,forwarders,commands,
  config-sync}.js`, `routes/cloud-bridge.routes.js`).
- Frontend production build green; bundle smaller post-refactor
  (`index` chunk dropped ~32KB from removing five page lazy-imports).
- Live deploy at `C:\Citadel\` survives restart, `/healthz` 200, service
  uptime stable across all incremental syncs.
- E2E pairing flow (paste Server ID + API key → supervisor opens WS →
  status flips to Connected) verified locally pre-release.
