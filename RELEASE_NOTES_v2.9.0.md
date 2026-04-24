## Citadel v2.9.0 — Expansion perf + Trader editor polish

### Expansion Editor (fixed: slow to load)
- **Lazy-loads configs on demand** — opens instantly, each section's file is only fetched when clicked. Previously all 32 files loaded up front in one monolithic request. Huge perceived-speed win.
- **Sidebar search** — filter the 23-section sidebar by label or filename
- **Per-section loading state** so you see progress when switching to a cold section
- Removed duplicate metadata fetch

### Trader Editor
- **Search in Traders, Zones, and Spawns tabs** (was: only Categories had search — painful with 15+ trader files)
- **Bulk price factor + offset** in Categories:
  - **Set to value** (original)
  - **× Factor** — multiply all selected prices by N (e.g. ×1.5 for a 50% raise)
  - **+ Offset** — add/subtract a flat amount
- NPC Spawns search matches both file names AND NPC EntityClass ("where does Hermit spawn?")

### New mod config API endpoints
- `GET /mod-configs/:schemaId/meta` — lightweight manifest
- `GET /mod-configs/:schemaId/file?fileName=…` — single file on demand

### Deferred to v2.10
- TraderPlus support — needs its own focused session
- Spawns editing (drag-on-map, gear editor) — stretch goal

See the full changelog at https://citadels.cc/docs/changelog
