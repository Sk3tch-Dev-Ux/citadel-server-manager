## Citadel v2.17.0 — Live Dashboard usability + map proxy + mod compile fixes

This release is a big quality-of-life pass on the Live Dashboard and the
in-game **@CitadelAdmin** mod. Every admin action that needed coordinates
(spawn, teleport) now has a click-on-map picker; the player right-click menu
gained Ban, Add to Priority, and a proper Profile view; map tiles are
now served and cached by Citadel itself instead of being fetched live
from a community CDN; and a long list of mod compile and runtime bugs
have been fixed.

> **Important:** the @CitadelAdmin mod has been updated alongside the
> desktop app. **Repack the PBO and redeploy it** to get the FPS reading
> fix, working Sunny/Rain/Fog/Storm weather, and the compile-error fixes.
> A stale PBO will still load (the desktop app and mod versions are
> independent), but you'll be missing the mod-side improvements.

---

### Added

- **Click-to-place picker for spawn buttons** — Heli Crash and Gas Zone
  used to send a hardcoded center-of-Chernarus coordinate (and fail with
  *"coords required"* on every other map). They now switch to the map
  tab; click anywhere to place.
- **Click-to-place player teleport** — right-click → Teleport used to
  drop players at `0,0,0` (the ocean corner of every map). Now switches
  to the map and you click the destination.
- **Right-click → Ban** — adds the player to the persistent ban store
  with a reason prompt. No more copy-pasting Steam IDs into the Bans
  page for quick bans.
- **Right-click → Add to Priority** — quick-add as VIP, permanent. Edit
  role/expiry on the Priority Queue page if you want something specific.
- **Right-click → Get Info** opens the player profile page instead of
  dumping JSON in a toast. The profile page picks up a fresh snapshot
  on mount and persists it.
- **Player Profile → Live State tab** — shows Health/Blood/Shock/Water/
  Energy bars, current position with a "View on Map" link, current gear
  per slot, and mod stats (kills, distance, accuracy, items picked/dropped).
  Snapshot persists across logout — useful forensics ("what gear did this
  duper have last time?").
- **Map tile proxy** — `/api/maps/tiles/:map/:style/:z/:x/:y.webp`
  fetches from xam.nu, caches to disk under
  `<install>/data/map-tiles/`, and serves with year-long browser cache
  headers. Maps keep working if xam.nu has a brief outage (for tiles
  already cached). New `DAYZ_TILE_VERSION` env var lets admins switch
  the upstream version without rebuilding the desktop app — useful when
  DayZ ships a new version and xam moves to a new path.
- **`GET /api/maps/version`** — surfaces current tile version + allowed
  styles to the frontend / for debugging.

### Fixed

- **Live Dashboard / Kill Feed / Chat Log all crashed** with
  *"Something went wrong"* — `serverMap` was declared inside
  `LiveDashboardPage` but used inside the sibling `LiveMapTab`
  component, causing a `ReferenceError`. Lifted via prop.
- **Map background was blank** even though vehicle markers rendered at
  correct coordinates — the hardcoded `TILE_VERSION = '1.28'` 404'd on
  xam.nu, which is currently serving `1.27`. Version is now configured
  server-side, defaults to `1.27`.
- **Tightened CSP** — `imgSrc` and `connectSrc` no longer whitelist
  external `xam.nu` hosts; the browser only ever talks to the local
  Citadel API now.

### Mod fixes — repack the PBO and redeploy

Lots of mod-side work this release. The big-impact ones:

- **Server FPS read 0 (or absurd numbers like 1998680) on the
  dashboard** — `cit_tps = cit_ticks / 2` was halving every reported
  value, and the tick-time average required a 60-sample warmup before
  reporting anything. Both fixed; FPS now shows real values immediately
  after server start.
- **Sunny / Rain / Fog / Storm weather buttons did nothing visible** —
  the weather changes were applied for one frame and then immediately
  overwritten by the engine's forecast loop. Added
  `SetWeatherUpdateFreeze(true)` and a 1-hour `minDuration` lock so the
  changes stick. Also switched from the deprecated `SetWindSpeed` to
  `SetWindMaximumSpeed`.
- **Repeated compile crashes** during mod loading. Every one fixed:
  - `CitadelLogger.Warning` (doesn't exist) → `Warn`
  - `GetYear() / GetMonth() / GetDay() / GetHour()...` (don't exist) →
    use existing `CitadelLogger.GetISO8601Static()` helper
  - `FPrintF` (doesn't exist) → `FPrintln`
  - `IndexOf("X", from)` (wrong arity) → `IndexOfFrom(from, "X")`
  - `?:` ternary operator (not supported in Enforce) → `if/else`
  - `int i` redeclared in same function scope → unique loop variable names
  - "Formula too complex" on long string concatenations → split into
    multiple `+=` statements
  - `Magazine.GetAmmoType()` (doesn't exist) → `GetType()`
  - `Weather.GetWindMagnitude() / GetWindDirection()` returned curve
    objects, were assigned to `float` → use `.GetActual()`
  - `Weather.GetOvercast()` similarly missing `.GetActual()`
  - `CGame.GetMissionName()` (doesn't exist) → `GetWorldName(out)`
  - `CGame.GetDate() / GetServerUptime() / GetWorldSize()` (don't
    exist) → derived from `GetTickTime()` and hardcoded 15360 to match
    `CitadelMissionServer`
  - Invented `Weapon_Base` API (`GetFireMode`, `GetChamberCount`,
    `GetReloadTime`, `GetWeaponManager`, `GetWeaponLength`,
    `BaseWeaponManagerModule`) → use real
    `GetCurrentMode(0) / GetMuzzleCount() / IsChamberFull(i) / GetMagazine(0)`
  - Trailing comma in `string.Format(...)` argument list → removed

### Upgrade notes

- The desktop installer auto-updates as usual: download
  `CitadelSetup-2.17.0.exe`, run as admin, follow the prompts.
- **The mod is shipped separately**. Repack
  `dayz-mod/@CitadelAdmin/` with Mikero MakePbo and copy the result to
  each server's `@CitadelAdmin/addons/CitadelAdmin.pbo`, then restart
  the DayZ server.
- The new tile cache directory `<install>/data/map-tiles/` will populate
  the first time a user opens the map. Disk usage grows with zoom
  exploration but stays well under 1GB for any single map.
