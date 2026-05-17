# DayZ Expansion Docs Site — Integration Audit

**Source**: https://dayzexpansion.com (new wiki, version `v26.05.16.23`)
**Generated**: 2026-05-17
**Data**: `DayzServerController-ExpansionData.zip` (256 files, 50 settings schemas, 10 tool definitions, 117 templates, 2 forms, 24 mod metadata files)
**Auditor scope**: Citadel — backend schemas, expansion routes/managers, and web editor pages.

---

## TL;DR

The new DayZ Expansion wiki ships a machine-readable spec for every Expansion settings file (50 schemas), 24 mod metadata records, 10 web tools, and 117 ready-to-use JSON templates. Cross-referenced against Citadel:

- **Citadel's 4 in-tree Expansion schemas are all stale.** Every one is missing fields (HardlineSettings: 13 → 23; MarketSettings: 9 → 28; GeneralSettings: 18 → 26; TerritorySettings: 10 → 13) and uses some field names that have been renamed upstream.
- **46 of the 50 official schemas are not represented in Citadel at all** — including AI, RaidSettings, GarageSettings, NotificationSettings (47 fields), VehicleSettings (49 fields), QuestSettings, Quest_1, all quest objective types, MapSettings, SpawnSettings, P2P market, etc.
- **No reference anywhere in the repo to `dayzexpansion.com`** — meaning users currently have no in-app way to jump from a config editor to the corresponding official docs.
- The wiki's tool layer (Market Editor, Quest Editor, Hardline Editor, Settings Editor, Loadout Editor, Price Calculator, ARGB↔Int, Icon Browser, JSON Validator, Config Diff) overlaps cleanly with Citadel's existing pages and is a candidate to either **link out to** or **mirror locally** for offline use.

**Recommended path**: replace `backend/schemas/expansion/` with a sync pipeline that pulls from the new wiki's schema feed, expose deep-links to dayzexpansion.com inside the Citadel editors, and ship the 117 JSON templates as "New file" actions in the file browser.

---

## 1. Schema staleness — per-file gap analysis

Citadel ships its own JSON Schemas under `backend/schemas/expansion/` and they're used by `web/frontend/src/components/SchemaEditor.jsx` and the editor pages (ExpansionEditorPage, TraderEditorPage, etc.). All four are out of date.

### 1.1 HardlineSettings (new `m_Version=11`)
Citadel has 13 fields; upstream has 23.

**Missing in Citadel (item rarity tier system, added in newer m_Versions):**
`PoorItemRequirement`, `CommonItemRequirement`, `UncommonItemRequirement`, `RareItemRequirement`, `EpicItemRequirement`, `LegendaryItemRequirement`, `MythicItemRequirement`, `ExoticItemRequirement`, `EnableItemRarity`, `DefaultItemRarity`, `ItemRarity`, `ItemRarityParentSearch`, `EntityReputation`, `EnableFactionPersistence`, `m_Version`

**In Citadel only (likely renamed/removed upstream):**
`EnableHardline`, `ReputationOnKillInfected`, `ReputationOnKillAnimal`, `ReputationOnKillPlayer`, `ReputationOnKillFriendly`, `ReputationOnKillBandit`, `DefaultReputation`, `ReputationTiers`

**Risk**: A current server's `HardlineSettings.json` will fail Citadel's validator on the rarity fields and won't expose the rarity editor to the admin. Reputation-on-kill settings may have moved to `EntityReputation`.

### 1.2 MarketSettings (new `m_Version=17`)
Citadel has 9 fields; upstream has 28.

**Missing in Citadel:**
`Currencies`, `CurrencyIcon`, `ATMSystemEnabled`, `ATMPartyLockerEnabled`, `ATMPlayerTransferEnabled`, `LandSpawnPositions`, `AirSpawnPositions`, `LargeVehicles`, `DisableClientSellTransactionDetails`, `DisallowUnpersisted`, plus 9 more.

**In Citadel only (likely renamed):**
`ATMEnabled` (now `ATMSystemEnabled`), `MarketMenuCategories`, `MaxItemsPerRow`, `UseWholeMap`

### 1.3 GeneralSettings (new `m_Version=16`)
Citadel has 18 fields; upstream has 26.

**Missing in Citadel:**
`EnableAutoRun`, `EnableEarPlugs`, `EnableGravecross`, `EnableAIGravecross`, `GravecrossTimeThreshold`, `GravecrossSpawnTimeDelay`, `GravecrossDeleteBody`, `EnableLighthouses`, `EnableHUDNightvisionOverlay`, `DisableShootToUnlock`

**In Citadel only:** A pile of `Enable<Subsystem>` toggles (`EnableMarket`, `EnableHardline`, `EnableTerritory`, `EnableVehicle`, `EnableSpawnSelection`, `EnableMission`, `EnableAirdrop`, etc.). Per the upstream layout these subsystem-enable flags now live in their *own* settings files (e.g. `EnableTerritories` is in `TerritorySettings`, not `GeneralSettings`).

### 1.4 TerritorySettings (new `m_Version=6`)
Citadel has 10 fields; upstream has 13. Mostly renames:

| Citadel | Upstream |
|---|---|
| `MaxMembersPerTerritory` | `MaxMembersInTerritory` |
| `TerritoryPerPlayer` | `MaxTerritoryPerPlayer` |
| `EnableTerritoryMember` | `OnlyInviteGroupMember` |
| *(missing)* | `EnableTerritories`, `MaxCodeLocksOnBBPerTerritory`, `MaxCodeLocksOnItemsPerTerritory`, `TerritoryInviteAcceptRadius`, `AuthenticateCodeLockIfTerritoryMember`, `InviteCooldown`, `TerritoryPerimeterSize` |

---

## 2. Missing schemas — 46 of 50

Citadel has no schema/editor coverage for:

| Domain | File | Field count | Citadel impact |
|---|---|---:|---|
| AI | `AIPatrolSettings.json` | 32 | No editor for AI patrol routes (Citadel just edits raw JSON via Monaco) |
| AI | `AISettings.json` | 31 | Same |
| AI | `AILocationSettings.json` | 4 | |
| AI | `BanditLoadout.json` (loadouts/*) | 9 | |
| Base building | `BaseBuildingSettings.json` | 29 | |
| Base building | `RaidSettings.json` | 36 | |
| Base building | `GarageSettings.json` | 25 | |
| Base building | `DamageSystemSettings.json` | 5 | |
| Core | `NotificationSettings.json` | 47 | Currently exists in `manifest.json` but no schema |
| Core | `LogsSettings.json` | 33 | |
| Core | `SafeZoneSettings.json` | 14 | |
| Core | `NotificationSchedulerSettings.json` | 5 | |
| Core | `CoreSettings.json` | 4 | |
| Core | `MonitoringSettings.json` | 2 | |
| Core | `SocialMediaSettings.json` | 3 | |
| Chat | `ChatSettings.json` | 7 | |
| Book | `BookSettings.json` | 17 | |
| Groups | `PartySettings.json` | 20 | |
| Name Tags | `NameTagsSettings.json` | 12 | |
| Main | `PlayerListSettings.json` | 3 | |
| Market | `Aircraft.json` (trader zone) | 13 | |
| Market | `Ammo.json` (market category) | 7 | |
| Market | `BalotaAircrafts.json` (trader zone) | 7 | |
| Market | `P2PMarketSettings.json` | 10 | |
| Market | `P2PTrader_1.json` | 24 | |
| Missions | `AirdropSettings.json` | 19 | |
| Missions | `Airdrop_Random_Balota.json` | 21 | |
| Missions | `ContaminatedArea_Pavlovo-North.json` | 12 | |
| Missions | `MissionSettings.json` | 7 | |
| Navigation | `MapSettings.json` | 25 | |
| Personal Storage | `PersonalStorage_1.json` | 20 | |
| Spawn Selection | `SpawnSettings.json` | 20 | |
| Vehicles | `VehicleSettings.json` | 49 | Largest schema in the set |
| Quests | `QuestSettings.json` | 33 | Citadel has `QuestCreatorPage.jsx` but no schema |
| Quests | `Quest_1.json` (quest definition) | 38 | |
| Quests | `QuestNPC_1.json` | 18 | |
| Quests | 10 × `Objective_*.json` types | 8–17 each | Action, AICamp, AIEscort, AIPatrol, Collection, Crafting, Delivery, Target, Travel, TreasureHunt |

Field counts above come from the wiki's `settingsSchema[*].name` arrays, not from inferred property objects.

---

## 3. The 10 web tools — mapping to existing Citadel pages

| Wiki tool | URL | Citadel equivalent | Recommendation |
|---|---|---|---|
| **Market Editor** | `/tools/custom/market-manager` | `TraderEditorPage.jsx`, `expansion-trader.routes.js`, `backend/schemas/traderplus/` | Keep Citadel's editor (multi-server, live deploy). Add a "Open in wiki Market Editor" deep-link for users who want the visual node UI. |
| **Quest Editor** | `/tools/custom/quest-editor` | `QuestCreatorPage.jsx`, `expansion-quests.routes.js`, `expansion-quest-manager.js` | Same — link out. The wiki tool advertises a node-graph editor with bezier connections which is heavier than what Citadel ships. |
| **Hardline Editor** | `/tools/custom/hardline-editor` | (none — only schema-driven form in `ExpansionEditorPage.jsx`) | High value: adopt the wiki schema first so the existing form covers rarity tiers, then optionally link out. |
| **Settings Editor** | `/tools/custom/settings-editor` | `ExpansionEditorPage.jsx` | Same surface area. Sync schemas, then link out for the visual-map editor (SafeZones / AI patrols on a map). |
| **Loadout Editor** | `/tools/custom/expansion-loadout-builder` | (none — Citadel has no loadout editor) | Gap. Either link out or build using the upstream `BanditLoadout.schema.json`. |
| **Price Calculator** | `/tools/custom/trader-price-calculator` | (none) | Pure helper utility — link out. |
| **ARGB ↔ Int** | `/tools/custom/argb-calculator` | (none) | Useful for NotificationSettings / ChatSettings colors. Either link out or embed a 50-line component on Citadel's color-bearing editors. |
| **Icon Browser** | `/tools/custom/expansion-icon-browser` | `web/frontend/src/components/Icon.jsx` (local icons only) | Link out; or mirror the icon list as a picker control in NotificationSettings / NotificationSchedulerSettings. |
| **JSON Validator** | `/tools/custom/json-validator` | `web/frontend/src/components/JsonConfigEditor.jsx` (Monaco) | Citadel already validates inside the editor; recommend linking the 117 wiki templates so "New file" can produce a valid skeleton. |
| **Config Diff** | `/tools/custom/config-diff` | `BackupsPage.jsx` (file-level), no JSON diff | Useful integration target — show a structured diff after restoring a backup. |

The wiki's tool definitions also include `formFields[]` (input schema for the tool itself, e.g. Market Editor's "default min/max price"), which means a future Citadel integration could surface the same tool form locally if desired.

---

## 4. Mod metadata — 24 mods

`mods/<mod-id>/metadata.json` contains, for each Expansion module:
- workshop ID, version compatibility
- install instructions, dependencies, conflicts
- per-settings-file binding (`linkedModId`, `filePath`)
- troubleshooting notes

The 24 mods covered: `expansion-bundle`, `expansion-main`, `expansion-core`, `expansion-licensed`, `expansion-ai`, `expansion-animations`, `expansion-basebuilding`, `expansion-book`, `expansion-chat`, `expansion-groups`, `expansion-hardline`, `expansion-map-assets`, `expansion-market`, `expansion-missions`, `expansion-name-tags`, `expansion-navigation`, `expansion-personal-storage`, `expansion-quests`, `expansion-spawn-selection`, `expansion-vehicles`, `expansion-weapons`, `community-online-tools`, `cf-community-framework`, `dabs-framework`.

Citadel's `ModsPage` and `mod-cache.js` currently rely on Steam Workshop scrapes; the wiki feed gives a curated, intent-rich source for the same data and could replace or augment the Workshop fetch for these 24 known mods.

---

## 5. Templates and forms

- **117 JSON templates** (`templates/*.json`) — ready-to-paste skeleton configs for every settings file, including specialized ones (`Objective_AICamp.json`, `Teleporter_1.json`, `ContaminatedArea_Pavlovo-North.json`, market category presets like `Ammo.json`, `Vests.json`, `Melee_Weapons.json`).
- **2 form layouts** (`forms/Trader_Item_Entry.json`, `forms/Spawn_Location_Entry.json`) — pre-built field arrangements for two of the most-edited entry types.

**Integration target**: hook these into `FilesPage.jsx`'s "create new file" action. When a user creates a new `*.json` under `mpmissions/.../expansion/...` or `Profiles/ExpansionMod/...`, suggest the matching template.

---

## 6. Prioritized recommendations

### P0 — Correctness (this week)
1. **Replace `backend/schemas/expansion/`** with the 50 upstream schemas, normalized to your existing JSON-Schema draft-07 shape. Write a small adapter that converts `settingsSchema[].{name,type,example,description,defaultValue}` into draft-07 `properties{}`.
2. **Update `backend/schemas/expansion/manifest.json`** so the file list matches what upstream actually ships (PlayerListSettings, AIPatrolSettings, AISettings, etc. are missing; some current entries like `EnableTerritory` in GeneralSettings are gone upstream).
3. **Pin the wiki version** in your schema fetcher (`wikiVersion: v26.05.16.23` per `manifest.json`) so future syncs are reproducible.

### P1 — UX (next sprint)
4. **Deep-link to dayzexpansion.com** from every Expansion editor: a `?` icon next to each settings file that opens `https://dayzexpansion.com/mods/<mod-id>` or the matching tool page.
5. **Embed ARGB↔Int** as a small popup on color-typed fields (saves a context switch for `Color*` fields in NotificationSettings and ChatSettings).
6. **Template picker** in `FilesPage.jsx` for new JSON files under Expansion paths, sourced from `templates/_index.json`.
7. Promote `LoadoutsPage` (new) backed by `BanditLoadout.schema.json` since Citadel currently has no UI for loadouts.

### P2 — Strategic (next quarter)
8. **Schema sync pipeline** — scheduled job (weekly?) that re-pulls the wiki's schema dump, diffs against the in-tree copy, opens a PR with the changes. Avoids the drift we just discovered.
9. **Structured config diff** on backup restore (use the wiki's Config Diff tool model).
10. **Mod metadata source-of-truth** — for the 24 mods covered by the wiki, prefer its metadata over Workshop scraping; fall back to Workshop for the long tail.

---

## 7. What this audit did NOT cover

- I could not directly render the wiki's HTML pages (client-side SPA + no JS-capable fetcher in this session). All findings come from the `DayzServerController-ExpansionData.zip` you provided plus search-engine context.
- I did not enumerate every renamed field in MarketSettings, GeneralSettings, or the 46 missing schemas — only summarized counts and called out the most impactful diffs. A full field-by-field renames table can be generated from the schema dump with a one-page Python script if you want it.
- Trader configs (the non-Expansion-namespaced `traderplus/` schemas under `backend/schemas/`) were not compared against `mods/expansion-market/settings/*` since they target different mods.
- Quest objective subtypes have not been individually diffed against `expansion-quest-manager.js`'s assumptions — flagged but not enumerated.
