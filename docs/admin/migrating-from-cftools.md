# Migrating from CFTools to Citadel — Banlist Import

If you're switching from CFTools Cloud to Citadel and you have an existing
banlist (potentially with thousands of bans), you don't need to start from
scratch. Citadel can pull your CFTools banlist via the official CFTools
API in one operation.

**Effort:** ~2 minutes for a typical banlist. Up to ~10 minutes for the
biggest community lists (we cap at 100,000 bans per import as a safety
measure).

---

## What you need

1. **A CFTools API token.** Get one from the
   [CFTools Developer Portal](https://developer.cftools.cloud/). The
   import uses the `Authorization: Bearer <token>` pattern documented
   in the CFTools Quick Start.
2. **Either** the **banlist ID** of the list you want to import, **or**
   the **server ID** (we'll resolve to the attached banlist).

The **banlist ID** is a 24-character hex string like
`693628d4fc4178db4369ab7b`. You'll find it at the top of any banlist
page on CFTools, labelled "Banlist ID". The CFTools "Share Code" (a
UUID like `772bd58d-7bdf-4c35-b7b1-01d1e7fe7895`) is a *different*
identifier — it's for sharing/following lists, not for API access.
Use the Banlist ID, not the Share Code.

You don't need an OAuth 2.0 client app — that's a separate CFTools API
flow for "user-facing apps" and isn't needed here. A static API token
from the Developer Portal is sufficient.

---

## How it works

1. **Open** the Citadel dashboard → **Bans** → click **From CFTools**.
2. **Paste your API token** and either banlist ID or server ID.
3. **Click "Preview import"**. Citadel calls CFTools, fetches the first
   page, and shows you:
   - The banlist ID that was matched
   - How many bans appear on the first page
   - How many are Steam64-format (importable into DayZ's `ban.txt`)
   - How many are non-Steam64 (will be skipped — see below)
   - A sample of the first 5 importable bans
4. **Click "Import all"** to commit. Citadel pages through the entire
   banlist, filters to Steam64, dedupes against your existing local
   bans, and writes the result to `data/bans.json` plus every managed
   server's `ban.txt`.
5. The import dialog shows the final result: `added`, `updated`,
   `skipped`, and any `errors`.

---

## What gets imported

**Important:** Per the
[CFTools data API](https://developer.cftools.cloud/documentation/data-api),
bans on CFTools target `cftools_id` (their internal player identifier)
or `ipv4` (an IP address). Neither is directly usable in DayZ&apos;s
`ban.txt`, which only accepts Steam64 IDs.

**Imported:** every ban whose record carries a Steam64 alongside the
CFTools account ID. CFTools&apos; ban records often include this in
the original capture metadata (the `steam_id`, `steam64`,
`player.steam64`, etc. fields — we try several common locations).
Imports go into your local Citadel ban database via the same
`ban-engine.addBan()` path used by the Players page.

**Skipped:**
- `cftools_id` bans where the record has no Steam64 attached. Without
  a Steam64 we can&apos;t enforce the ban via `ban.txt`. The preview
  shows you how many of your bans fall into this category before you
  commit, so there are no surprises.
- `ipv4` bans — DayZ&apos;s `ban.txt` doesn&apos;t accept IP bans.
- Malformed records (rare).

If you see a high "no Steam64 on record" count in the preview, the
practical workaround is to:
1. Note the affected `cftools_id` values from the preview.
2. Manually look them up on CFTools&apos; web UI to find the original
   Steam64.
3. Add them via the `Add Ban` dialog with the Steam64 you found.

A future iteration could automate this via CFTools&apos;
`/v1/users/lookup` endpoint, but that endpoint is rate-limited
(20/minute) and currently documented for the Steam64 → CFTools
direction only. For now, the import is opportunistic — it grabs every
Steam64 it can see in the existing records.

---

## What happens to the data

- **Local first.** Imported bans go into `data/bans.json` (Citadel's
  local ban database) and into every managed server's `ban.txt`. Your
  servers are protected immediately on the next BattlEye check.
- **Not auto-submitted to Citadel Cloud.** Even if you have the
  Citadel Cloud add-on, imported CFTools bans do NOT auto-flow to the
  community ban DB. We made this choice deliberately:
  - 5,000 imported bans would burst past the per-customer rate limits.
  - Importing a poisoned external banlist could pollute the network.
  - Bans should reach the community DB through your own deliberate
    submission, not automatic forwarding.

  If you want a specific imported ban to also propagate to the
  Citadel Cloud network, remove it locally and re-add it via the
  Players page or **Add Ban** with the **"Submit to Citadel Cloud
  community ban DB"** toggle enabled. This forces you to think about
  category and intent for each one — which is the point.
- **Credentials are NOT saved.** Your API token is used once for the
  import and discarded from memory. Subsequent imports require
  re-entry. This is by design (one-shot, never persisted) — minimum
  blast radius if anything ever compromises Citadel's local data
  directory.

---

## Troubleshooting

### "CFTools API token rejected"
The token is invalid, revoked, or doesn't have access to the
endpoint. Verify it on the
[CFTools Developer Portal](https://developer.cftools.cloud/).

### "Server has no banlist attached on CFTools"
The `serverId` you provided doesn't have a banlist configured on the
CFTools side. Either configure one on CFTools first, or use the
banlist ID directly if you know it.

### "Hit our 100,000-ban hard cap"
A safety limit. If your CFTools list legitimately has more than 100k
bans, contact support — we can raise the cap on your installation.

### Import succeeds but bans don't appear in-game
- Confirm the SteamID format in the preview — we only import
  `format: 'steam64'`. Other formats are skipped.
- Restart the affected DayZ server. BattlEye reads `ban.txt` on
  player connect; existing connected players need to reconnect to be
  kicked.
- Check the per-server `ban.txt` directly:
  `<server>/profiles/ban.txt`. Imported SteamIDs should be there.

### "Subscribe to Citadel Cloud" — does CFTools migration require Cloud?
**No.** CFTools migration is a feature of the local Citadel app. The
Citadel Cloud add-on is separate; it gates the network-wide community
ban DB, not local imports.

---

## Endpoints (for support / debugging)

The dashboard's import flow uses these local-backend endpoints:

| Method | URL | Purpose |
|---|---|---|
| `POST` | `/api/cftools-import/preview` | Auth + first-page summary, no DB writes |
| `POST` | `/api/cftools-import/run` | Full import, paged through to completion |

Both require the `bans.manage` permission (same as the rest of `/api/bans/*`).

Body shape: `{ apiToken, banlistId? | serverId? }`. The token is never
logged or persisted.

The local backend in turn calls these CFTools endpoints:
- `GET https://data.cftools.cloud/v1/server/{server_id}` (only when
  resolving server → banlist)
- `GET https://data.cftools.cloud/v1/banlist/{banlist_id}/bans`
  (streamed response; consumed in one go — CFTools doesn&apos;t
  paginate this endpoint)

See `backend/lib/cftools-import/` for the implementation.
