## Citadel v2.6.0 — Auto-updater, Mod Configs auto-detection, Spawnable Types rework

### Auto-updater
- Citadel now auto-updates from GitHub Releases — downloads silently, prompts to restart when ready
- Banner shows progress in real time; dismissible error surface if the updater can't reach GitHub

### Mod Configs auto-detection
- New "Auto-detected Configs" section scans your `profiles/` directory and surfaces every JSON config file, grouped by mod folder
- Works for any mod without needing us to write a schema first
- Click-through JSON editor with Ctrl+S save
- Smart exclusions (ExpansionMod, BattlEye, DayZServer runtime state are skipped automatically)
- Path-traversal hardened

### Spawnable Types rework
- **Parser rebuilt on `fast-xml-parser`** — preserves every field including `<damage>`, `<hoarder>`, and `preset="1"` references (previously silently dropped on save — critical data-integrity fix)
- **Preset references** (new) — items can now be a direct class OR reference an entry in `cfgrandompresets.xml`, with searchable autocomplete
- **Side-panel detail view** — replaces the old accordion pattern that was unusable with real DayZ configs
- Damage range editor, column sorting, debounced search, 200 items/page

### Fixed (from v2.5.1)
- Files browser editor was blank on click — CSP blocked Monaco from loading. Fixed.

See the full changelog at https://citadels.cc/docs/changelog
