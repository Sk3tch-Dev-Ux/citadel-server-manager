## Citadel v2.10.0 — Editable NPC spawns

The Spawns tab was view-only. Now it's a full map+table editor for your trader NPCs.

### Added
- **Drag NPCs on the map** to reposition — orange markers are the selected file's spawns
- **"Click to Place" mode** to add a new NPC at any map location
- **Inline table editing** for EntityClass, X, Z, Yaw; expand a row for TraderFile, Y, Pitch, Roll, and the gear list
- **Gear editor** — add/remove item class names for each NPC's spawn loadout
- **Add NPC + Delete NPC** buttons with per-file dirty indicator and Save
- **Live dirty tracking** — unsaved files show a ● in the sidebar and header

### Fixed
- Spawns tab was loading from the wrong endpoint (`/traders` JSON configs instead of `/spawns` parsed .map files). Positions sometimes rendered as `-` because field names were lowercase in the backend but read as uppercase in the UI.

See the full changelog at https://citadels.cc/docs/changelog
