## Citadel v2.18.1 — Auto-updater launch fix + Loadouts editor + Quest badge fix

A small follow-up release to v2.18.0 with one **critical** fix and two
quality-of-life improvements that came out of testing the Expansion docs
overhaul.

> **Upgrade strongly recommended for all v2.18.0 installs** — the
> auto-updater bug below silently swallowed startup errors and prevented
> the desktop window from opening on some systems. The installer's
> auto-stop logic handles upgrades safely; just run the new installer.

---

### Fixed

- **Desktop app failed to launch silently on startup** —
  `desktop/src/auto-updater.js` called an undefined `fileLog()` helper
  during `initAutoUpdater()`, which produced an unhandled promise
  rejection. On affected installs the Electron processes would start
  in the background (visible in Task Manager) but no window ever
  appeared. The bad call was a buggy leftover line —
  `appendUpdateLog()` on the line above already does the file logging.
  Removed.
- **Quest Creator list badges all showed "Treasure Hunt"** regardless
  of the actual quest. The badge was reading `quest.Type`, which is
  Expansion's quest *category* enum (Normal/Daily/Weekly/Group/Story,
  documented upstream as "Type selector (0–5)"). Almost every quest
  defaults to `Type: 1`, so almost every quest got mapped through
  Citadel's incorrect QUEST_TYPES table to "Treasure Hunt". Fix: surface
  each quest's first objective `ObjectiveType` instead — "Target/Kill"
  on a kill quest, "AI Patrol" on a patrol clear, "Travel" on a travel
  quest, and so on. The reliable `IsDailyQuest` / `IsWeeklyQuest`
  badges in the subtitle already covered the category info.

### Added

- **Loadouts editor** — new sidebar entry under **MOD CONFIGS** →
  **Loadouts**. Manages JSON files under
  `Profiles/ExpansionMod/Loadouts/`, both player spawn loadouts and AI
  faction loadouts.
  - File list with kind badges (Player / Hero / Bandit / AI / Custom,
    inferred from filename) and per-file slot/item counts.
  - Schema-driven editor backed by `BanditLoadout.schema.json` (one
    schema covers all loadout files — they share the same shape).
  - **"+ New from template"** modal pulling loadout-shaped templates
    from `/api/expansion-docs/templates` (Loadout, BanditLoadout,
    ExampleLoadout, etc.). Pick one, name your file, it's written and
    opens immediately.
  - **"Docs ↗"** opens the wiki's Loadout Builder
    (https://dayzexpansion.com/tools/custom/expansion-loadout-builder).
  - Save creates a backup snapshot under `<install>/.backups/`.
  - Delete also creates a backup before unlink, so files are
    recoverable.
  - Backed by a new `/api/servers/:id/expansion/loadouts` route with
    list / read / save / delete, audit-logged and path-traversal-safe.

### Notes for admins

- Previously the only way to edit Expansion loadouts was raw JSON
  through the Files page. The new Loadouts editor is the recommended
  workflow.
- Loadout files created via the New modal land at
  `Profiles/ExpansionMod/Loadouts/<YourName>.json`. Reference them by
  filename (without `.json`) in `SpawnSettings.json` for player spawn
  loadouts or in AI faction configs for AI loadouts.

### Repack required

- **Desktop app:** yes — rebuild and install to get the launch fix +
  Loadouts page.
- **@CitadelAdmin mod (PBO):** **no change in this release**. Existing
  v2.18.0 / v2.17.0 builds continue to work.
- **Server config files:** no migration required.

### Internals

- New files: `backend/routes/expansion-loadouts.routes.js`,
  `web/frontend/src/pages/LoadoutsPage.jsx`.
- Modified: `backend/server.js` (register route),
  `desktop/src/auto-updater.js` (fix),
  `backend/routes/expansion-quests.routes.js` (surface
  PrimaryObjectiveType),
  `web/frontend/src/pages/QuestCreatorPage.jsx` (use ObjTypeBadge in
  list), `web/frontend/src/router.jsx` (route),
  `web/frontend/src/layouts/AppLayout.jsx` (sidebar entry).
