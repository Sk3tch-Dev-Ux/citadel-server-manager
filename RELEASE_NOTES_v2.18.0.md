> ## ⚠️ DO NOT INSTALL — setup wizard is broken in this release
>
> The first-run setup wizard silently 403s on the Network / Steam / Complete steps
> in v2.18.0 through v2.18.2. Buttons appear unresponsive with no error in the UI.
>
> **Upgrade to v2.18.4 or later.** See `RELEASE_NOTES_v2.18.4.md` for the fix.

---

## Citadel v2.18.0 — DayZ Expansion docs overhaul

This release is a complete rebuild of Citadel's DayZ Expansion support, driven
by the new official wiki at **[dayzexpansion.com](https://dayzexpansion.com)**.
Citadel previously shipped its own hand-maintained schemas for 4 Expansion
settings files — every one of them stale, some by multiple `m_Version`s.
v2.18.0 replaces them with the upstream wiki as the source of truth, ships
**all 50** Expansion settings schemas, adds **117 ready-to-use JSON templates**,
and gives admins one-click jumps from any Expansion editor straight into the
matching wiki tool.

The whole thing is driven by a single re-runnable sync script. The next time
the wiki updates, it's a one-command refresh.

> **Important:** no action required on the @CitadelAdmin in-game mod — the
> PBO didn't change in this release. This is a purely server-side /
> desktop-side upgrade.

---

### Added

- **50 Expansion JSON Schemas** — every settings file the wiki documents,
  from `AISettings.json` (31 fields) and `VehicleSettings.json` (49 fields)
  all the way down to two-field utility configs. Up from 4 schemas in
  v2.17.0. Each schema includes upstream descriptions, default values, and
  enum labels.
- **24-mod metadata index** — `backend/schemas/expansion/_mods.json` exposes
  workshop URLs, dependencies, conflicts, versions, and per-mod wiki links
  for every Expansion submodule plus its dependencies (CF Community
  Framework, DabsFramework, Community Online Tools).
- **117 JSON skeleton templates** under `backend/schemas/expansion-templates/`
  — ready-to-paste blank configs for every settings file the wiki documents
  (`HardlineSettings.json`, `Quest_1.json`, `Objective_AICamp.json`,
  market categories like `Vests.json` / `Melee_Weapons.json`, etc.).
- **2 form layouts** under `backend/schemas/expansion-forms/` — pre-built
  field arrangements for the two most-edited entry types
  (`Trader_Item_Entry`, `Spawn_Location_Entry`).
- **Template picker in Files page** — the new `+` button in the Explorer
  sidebar opens a searchable modal listing all 117 templates. Pick one,
  confirm the target path (pre-filled with a sensible Expansion default
  like `Profiles/ExpansionMod/Settings/HardlineSettings.json`), and the
  file is created via the existing safe `/files/write` path with a
  backup snapshot, then auto-opened in a new editor tab.
- **"Docs ↗" deep-links** in three editor pages:
  - **Expansion Editor** — opens the right wiki page for whichever
    section you have selected (Hardline Editor for HardlineSettings,
    Quest Editor for any Quest_* / Objective_* / QuestNPC_* file,
    Settings Editor for SafeZones / BaseBuilding / AI patrols / map
    markers, mod page for anything else).
  - **Trader Editor** — opens the Market Editor tool on the wiki.
  - **Quest Editor** — opens the visual node-graph Quest Editor on
    the wiki.
- **New API surface** at `/api/expansion-docs/*`:
  - `GET /api/expansion-docs/version` — wiki version + sync timestamp
  - `GET /api/expansion-docs/mods` — 24-mod metadata index
  - `GET /api/expansion-docs/templates` — template index
  - `GET /api/expansion-docs/templates/:name` — fetch one template
  - `GET /api/expansion-docs/forms` — form layouts
  Auth-gated, path-traversal-safe.
- **`scripts/sync-expansion-docs/`** — re-runnable sync pipeline.
  Refreshing to a newer wiki version is one command:
  `node scripts/sync-expansion-docs/sync.js`. Pin the version with the
  `wikiVersion` field in the source snapshot.

### Changed

- **HardlineSettings expanded from 13 → 23 fields** — the entire item
  rarity tier system is now editable in-app (Poor / Common / Uncommon /
  Rare / Epic / Legendary / Mythic / Exotic requirements,
  `EnableItemRarity`, `ItemRarity`, `EntityReputation`,
  `EnableFactionPersistence`, `m_Version=11`). Previously the Hardline
  editor was missing the whole rarity subsystem.
- **MarketSettings expanded from 9 → 28 fields** — `Currencies`,
  `CurrencyIcon`, `ATMSystemEnabled`, `ATMPartyLockerEnabled`,
  `ATMPlayerTransferEnabled`, `LandSpawnPositions`, `AirSpawnPositions`,
  `LargeVehicles`, `DisableClientSellTransactionDetails`, and the rest
  of the modern market surface, all now editable.
  Schema version `m_Version=17`.
- **GeneralSettings expanded from 18 → 26 fields** — adds
  `EnableAutoRun`, `EnableEarPlugs`, the full Gravecross suite
  (`EnableGravecross`, `EnableAIGravecross`, `GravecrossTimeThreshold`,
  `GravecrossSpawnTimeDelay`, `GravecrossDeleteBody`),
  `EnableLighthouses`, `EnableHUDNightvisionOverlay`,
  `DisableShootToUnlock`. Schema version `m_Version=16`.
- **TerritorySettings expanded from 10 → 13 fields and renamed to match
  upstream** — `MaxMembersPerTerritory` → `MaxMembersInTerritory`,
  `TerritoryPerPlayer` → `MaxTerritoryPerPlayer`,
  `EnableTerritoryMember` → `OnlyInviteGroupMember`. Adds
  `EnableTerritories`, `MaxCodeLocksOnBBPerTerritory`,
  `MaxCodeLocksOnItemsPerTerritory`, `TerritoryInviteAcceptRadius`,
  `AuthenticateCodeLockIfTerritoryMember`, `InviteCooldown`,
  `TerritoryPerimeterSize`.
- **`backend/schemas/expansion/manifest.json` rebuilt from upstream**
  with proper `schemaFile` pointers on every entry, so
  `backend/lib/mod-config-schema.js` now actually associates files with
  their schemas (it previously returned an empty bundle because no
  entry had `schemaFile` set).
- **Adapter preserves rich type info** — `enum_string` with labels,
  `color` (with `format: 'argb-int'`), `vector` (`format: 'vector3'`),
  `classname` (`format: 'dayz-classname'`), `icon`
  (`format: 'expansion-icon'`), and `map` with key/value type hints.
  Boolean toggles continue to render via the existing `[0,1]` integer
  enum convention in `SchemaEditor.jsx`.

### Fixed

- **`mod-config-schema.js` returned an empty schema bundle for
  Expansion** even when schemas existed on disk — the legacy manifest
  entries had no `schemaFile` field, so the loader silently associated
  zero schemas. New manifest sets `schemaFile` on every entry; the
  loader now returns 50.
- **Stale field set in the 4 in-tree Expansion schemas** caused valid
  modern config files to flag editor warnings for "unknown" fields
  (e.g. rarity tier requirements in HardlineSettings, ATM settings in
  MarketSettings). Replaced wholesale by the upstream schemas.

### Notes for server admins

- Existing `HardlineSettings.json`, `MarketSettings.json`,
  `GeneralSettings.json`, and `TerritorySettings.json` on your servers
  are **not modified by this upgrade** — only Citadel's schemas
  describing them are. Open one in the Expansion editor and you'll
  immediately see the previously-hidden upstream fields populated from
  the file's actual values.
- The CR-pickable territory fields renamed by Expansion several
  versions ago (`MaxMembersPerTerritory` → `MaxMembersInTerritory`,
  etc.) now match what Citadel expects. If your config still uses the
  old names, the field will show as missing — copy the value to the
  new name and remove the old one.
- The **Files** page's `+` button is the fastest way to spin up a new
  Expansion settings, quest, or market-category file from a known-good
  starting point. The picker pre-fills sensible target paths but
  supports any path your server permits.

### Internals

- `data/expansion-docs/source/` — full upstream snapshot pinned at wiki
  version `v26.05.16.23` (commit it if your `.gitignore` allows; the
  sync script reads from here).
- `docs/expansion-docs-audit.md` — the full gap-analysis report that
  drove this work (50 vs 4 schemas, field counts, rename table, tool
  mapping).

### Repack required

- **Desktop app:** yes — rebuild and reinstall to get the new editor
  pages, deep-links, and template picker.
- **@CitadelAdmin mod (PBO):** **no change in this release**. Existing
  v2.17.0 builds continue to work.
- **Server config files:** no migration required — the upstream schemas
  describe files Expansion already writes; your existing JSON is
  unaffected.
