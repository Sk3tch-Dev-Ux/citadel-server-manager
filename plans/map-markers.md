# Dynamic Map Markers Integration Plan

Track configurable items/buildings on the live map via Citadel mod integration.

## Changes

### Mod (4 files)
1. **NEW: `scripts/3_Game/CitadelMapMarkerManager.c`** — Config loader + registration tracker
2. **MODIFY: `scripts/4_World/hooks/CitadelItemHooks.c`** — Add marker register/unregister on item drop/pickup
3. **NEW: `scripts/4_World/hooks/CitadelBuildingHooks.c`** — House entity marker tracking
4. **MODIFY: `scripts/5_Mission/CitadelMissionServer.c`** — Grid scan for existing static objects + init manager

### Frontend (1 file)
5. **MODIFY: `LiveMapPage.jsx`** — Extended icon mapping for custom marker types

### No backend changes needed — existing pipeline handles everything.
