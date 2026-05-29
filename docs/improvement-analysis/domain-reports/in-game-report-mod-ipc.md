# Domain Report: In-game report mod & IPC

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

**Reference codebase** (dsm-reference, TypeScript + Enforce Script):

The reference uses a **hybrid dual-mechanism approach**:

1. **Mod Architecture** (watcher_mod/, ~1394 LOC):
   - Monolithic `DayZServerManagerWatcher.c` (1132 LOC) that polls once every report interval
   - Creates static data dumps (ammunition, magazines, weapons, items, zombies) on first run via `JsonFileLoader<T>.JsonSaveFile()`
   - Uses `GetGame().GetPlayers(players)` to iterate active players each tick
   - Collects vehicle and player data into a `ServerManagerEntryContainer` class
   - **Two reporting paths**: can POST to REST API (`m_RestContext.POST()`) OR write a single tick file (`DZSM-TICK.json`) depending on `useApiForReport` config

2. **Manager-side IPC** (TypeScript, src/services/):
   - `IngameReport` service (ingame-report.ts) scans the tick file on an interval (1000ms default), detects modification time changes, parses JSON
   - File watcher pattern: checks `mtime` to determine if fresh data arrived
   - REST-based alternative (`IngameREST`): exposes `/ingamereport` POST endpoint (port server_port+10)
   - Lazy initialization of REST API config written to `DZSMApiOptions.json`

3. **Data Model** (types/ingame-report.ts):
   - Simple container: `IngameReportEntry` (vehicle or player) with position, speed, damage, category
   - Top-level `IngameReportContainer` with `players[]` and `vehicles[]` arrays

**IPC mechanism**: Primarily **file-based** (tick file polling or REST POST), no command queue."

## How Citadel does it

**Current codebase** (Citadel, Node.js + Enforce Script):

The current system is **substantially more sophisticated** with **multi-subsystem architecture** and **bidirectional command queue**:

1. **Mod Architecture** (dayz-mod/@CitadelAdmin/, ~8413 LOC):
   - **Distributed design** across multiple scripts:
     - `CitadelCore.c` (3_Game, ~500 LOC): Central singleton with player/AI/vehicle/event registries, performance metrics, lifecycle management
     - `CitadelMissionServer.c` (5_Mission, ~150 LOC): Mission hooks (OnInit, OnMissionFinish, OnUpdate), grid-scan for static objects
     - `CitadelReporter.c` (5_Mission): Periodic vehicle + event reporter
     - `CitadelMetricsTracker.c` (5_Mission): Server FPS, tick times, entity counts
     - `CitadelPlayerTracker.c` (5_Mission): Player data with position, health, survival stats
     - `CitadelCommandRunner.c` (5_Mission): Command file processor (reads `commands/*.cmd.json`, writes `responses/*.res.json`)
     - `CitadelPlayerTracker.c`, `CitadelEventLogger.c`: entity tracking
   - **Custom JSON serialization**: Inline string concatenation (no external JsonLoader dependency)
   - **Performance optimizations**: Registry caching (2s TTL for AI count), swap-and-pop O(1) removal, event logger buffer flush

2. **Sidecar IPC** (Node.js, sidecar/):
   - `command-queue.js`: **Bidirectional** atomic file-based RPC (write `.cmd.json`, wait for `.res.json`)
   - Timeout + polling + fs.watch combo for response detection
   - `game-data-store.js`: Caches in-memory copies of metrics, vehicles, events (refreshed on polling)
   - `citadel-bridge.js` (backend): EventEmitter-based polling with mtime change detection for all data files
   - Maintains subscription counter for auto-start/stop of polling

3. **Data Model**:
   - Rich player data: position, health (all four types), survival stats, vehicle status, session duration
   - Vehicle positions with health/maxHealth
   - Dynamic world events with positions
   - Server metrics: FPS, AI/animal counts, tick times (low/avg/high), entity counts, uptime
   - Event log (append-only JSONL)

4. **Command Coverage** (~75+ commands documented):
   - Player actions: heal, kill, teleport, spawn item, strip, explode, kick, freeze, cure, set blood type, etc.
   - Vehicle actions: delete, repair, refuel, unstuck, explode
   - World actions: time, weather, wipe AI/vehicles, broadcast, flatten trees, clear zombies
   - Configuration-driven (CitadelConfiguration.c)

**IPC mechanism**: **Primarily file-based** with bidirectional request-response pattern (command queue), polling-based telemetry."

## Detailed analysis

## Comparison: In-game Report Mod & IPC Architecture

### Executive Summary

The reference codebase (dayz-server-manager v3.10.0) implements a **simple, focused data-export system** using file-based polling or REST POST, while the current Citadel codebase is a **substantially more sophisticated, production-grade system** with bidirectional RPC, distributed mod architecture, and comprehensive telemetry. Citadel is **more advanced** in nearly all respects, though there are specific areas where the reference's simplicity offers lessons and where Citadel can improve robustness.

### Architecture Comparison

**Reference Approach:**
- Monolithic watcher mod (1132 LOC in single `DayZServerManagerWatcher.c`)
- Manager-side: TypeScript service that polls a JSON tick file for modifications or receives REST POST
- Unidirectional: mod sends data only; no command execution capability
- Simple data model: players and vehicles with position/speed/damage

**Current (Citadel) Approach:**
- Distributed mod architecture across 8 specialized scripts (8413 LOC total)
- Sidecar with atomic file-based RPC (command queue + response polling)
- Bidirectional: 75+ admin commands with request-response semantics
- Rich data model: player vitals, survival stats, vehicle health, dynamic events, tick-time metrics, session tracking
- Performance-optimized: registry caching, O(1) removal, event logger buffering

Citadel is unquestionably more capable. The reference's monolithic approach would not support Citadel's command infrastructure.

### Key Strengths & Weaknesses

**Reference Strengths:**
1. **Simplicity**: Single-file mod (~1132 LOC) is easy to audit and understand
2. **Config dumps**: Pre-computes and exports ammunition, weapon, item, container metadata as JSON—useful for UIs, wikis, analysis tools
3. **Dual reporting mode**: Operators can choose file polling (no external dependency) or REST POST (lower latency) via config flag
4. **Clear data contracts**: IngameReportEntry interface is explicit and minimal

**Reference Weaknesses:**
1. No command execution—purely observational
2. No session tracking or detailed player stats (energy, water, vehicle status)
3. No dynamic event tracking
4. No atomic write pattern visible for command coordination (if attempted)
5. Monolithic watcher makes changes risky

**Citadel Strengths:**
1. **Bidirectional command queue**: Full RPC with 75+ admin commands (player heal/kill/teleport, vehicle repair, world weather, etc.)
2. **Rich telemetry**: Player health (4 types), survival stats, vehicle status, session duration, event positions, tick-time diagnostics
3. **Performance optimizations**: Registry caching (2s TTL), O(1) removal, swap-and-pop, event logger buffering
4. **Distributed architecture**: Separate reporters/trackers by concern (metrics, players, vehicles, events, commands) make changes safer
5. **Atomic writes**: Command files use `.tmp` → `rename` pattern to prevent partial reads by mod
6. **Proper layering**: Mission-level lifecycle hooks (OnInit, OnMissionFinish), grid-based static object scanning
7. **Configured behavior**: CitadelConfiguration controls intervals, debug mode, module enable/disable
8. **Session tracking**: Player session start times tracked in registry

**Citadel Weaknesses:**
1. No REST POST option for telemetry—always file-based polling (though file polling is reliable, REST would enable lower-latency high-frequency updates)
2. No static config dumps (ammo, weapons, items, containers)—would require parsing the config tree
3. Unbounded event/vehicle arrays (can exceed memory on 30-day uptime servers)
4. Command action validation missing—typos or injection could create orphaned files
5. Stale file cleanup function exists but is never called automatically
6. Command response timeouts have minimal logging for diagnostics
7. Magic numbers (interval timings) hardcoded instead of in CitadelConfiguration

### File-Based IPC: Strengths & Concerns

Both codebases use file-based IPC (JSON files in profile directory). This is reasonable for DayZ because:
- No external HTTP/database dependencies for game-side code
- Survives mod crashes (files persist)
- Auditable (admins can inspect .json files)
- Simple for operators to debug

However, relying solely on filesystem polling has latency costs (~2s typical round-trip for telemetry). The reference's REST POST option mitigates this for high-frequency data; Citadel could benefit from the same.

**Atomic Write Pattern:** Citadel correctly uses `.tmp` → `rename` to prevent the mod from reading partial command JSON. This is a best practice the reference should adopt (though JsonFileLoader may handle it internally).

### Performance & Scalability

**Citadel excels** here:
- CitadelCore.GetActiveAICount() caches for 2s instead of iterating on every poll
- Swap-and-pop O(1) removal (vs. O(n) array.Remove())
- Event logger buffer flushed on shutdown
- mtime-based change detection avoids re-parsing unchanged files

**Reference:**
- Monolithic design iterates GetGame().GetPlayers() on every tick—fine for typical servers (<100 players) but scales poorly
- No caching visible for expensive operations

### Data Quality & Diagnostics

**Citadel** provides far richer diagnostics:
- Server FPS derived correctly from tick_avg (not inflated counters)
- Tick-time histogram (low/avg/high) shows performance distribution
- AI count split (total vs. active) for load tracking
- Entity count (useful for finding rogue generators or spawners)
- Session duration for admin insights
- Event positions (useful for map visualization)

**Reference:**
- Basic player/vehicle snapshot—sufficient for observation but lacks depth

### Recommendations for Citadel

1. **High priority:**
   - Implement automatic cleanup of stale command files (call cleanupStaleFiles every 5 min during init)
   - Add overflow protection to event/vehicle registries (max 1000/5000 with FIFO eviction)
   - Add command action whitelist validation before writing files

2. **Medium priority:**
   - Emit 'stale' event from CitadelBridge if data hasn't changed for 30s (connection lost detection)
   - Add enhanced logging to CitadelCommandRunner for unprocessed command diagnostics
   - Consider optional REST POST mode for telemetry (fallback to file polling if REST fails)

3. **Low priority (future work):**
   - Move interval magic numbers to CitadelConfiguration
   - Implement optional static config dumps (ammo, weapons, items, containers) for ecosystem tools

### Security Considerations

Neither codebase implements strong IPC authentication:
- Files are written to the profile directory with no encryption
- REST API uses only a query string `key` parameter (HTTP, not HTTPS by default)
- Command queue has no signatures or nonces

For self-hosted (localhost) deployments this is acceptable, but Citadel's file-based approach with atomic writes is marginally safer than REST since files are harder to forge.

### Conclusion

Citadel's architecture is **production-grade** and substantially more sophisticated than the reference. The reference serves as a baseline for simplicity and offers two lessons: (1) static config dumps are valuable for ecosystem tools, and (2) dual file+REST reporting modes provide operational flexibility. Citadel should focus on robustness improvements (cleanup, overflow protection, validation, diagnostics) rather than architectural overhaul.

## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| REST API option for ingame reports | ref_has_current_lacks | medium | small | Reference supports toggling between file-based tick polling and direct REST POST to manager. Citadel always uses file-based IPC for data export. REST option would enable lower-latency updates in high-frequency scenarios. |
| Static data dumps (ammo, weapons, items, containers, zombies) | ref_has_current_lacks | low | large | Reference pre-computes comprehensive config dumps (ammunition, magazines, weapons, clothing, items, containers, zombies) on first run, stored as JSON. Citadel does not export this inventory/config metadata. Useful for UI item lists, wiki generation, admin tools. |
| Real FPS calculation from tick time | both_have_current_better | low | trivial | Citadel correctly derives real FPS from tick_avg (1000/tick_avg), reports fps*100 for precision. Reference behavior unclear from code shown but likely similar. Citadel is more rigorous (comment in game-data-store.js explains the derivation). |
| Session duration tracking | current_has_ref_lacks | medium | trivial | Citadel tracks player session start time in CitadelCore registry, exposes GetPlayerSessionDuration(). Reference does not mention this. Useful for admin/analytics. |
| Dynamic event tracking with positions | current_has_ref_lacks | high | trivial | Citadel tracks world events (heli crashes, contamination zones, etc.) with positions and metadata in CitadelCore. Reference focuses on player/vehicle positions only. |
| Bidirectional command queue | current_has_ref_lacks | critical | trivial | Citadel implements full request-response RPC via file queue (75+ commands: player actions, vehicle, world). Reference shows no command infrastructure—only data export via REST POST or tick file. Citadel is substantially more powerful. |
| Atomic file writes for command safety | current_has_ref_lacks | high | trivial | Citadel's command-queue.js uses atomic writes (.tmp → rename) to prevent mod reading partial JSON. Reference does not show explicit atomic write pattern (JsonFileLoader may or may not be atomic). |
| Performance optimizations (caching, O(1) removal) | current_has_ref_lacks | high | small | Citadel caches active AI/animal counts with 2s TTL, uses swap-and-pop for O(1) removal. Reference's monolithic approach may iterate full player/AI arrays on every tick. |
| Proper mission-layer lifecycle management | current_has_ref_lacks | medium | trivial | Citadel properly places command runner and reporters in 5_Mission layer, flushes data on OnMissionFinish, uses ProgressEvent for mission-loaded detection. Reference's layer placement unclear. |
| Grid-based static object scanning | current_has_ref_lacks | low | trivial | Citadel scans map in 10x10 grid sectors (starting 30s after mission load) to register static entity markers. Reference does not show this feature. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Add error recovery for malformed command responses | `/Users/sk3tch/Documents/GitHub/DayzServerController/sidecar/command-queue.js (lines 87-114)` | medium | trivial | low | Currently catches JSON.parse() SyntaxError and retries, but doesn't log which command failed. Add command action/ID to debug log so operators can trace hung commands. |
| Prevent command queue exhaustion by implementing max-age cleanup | `/Users/sk3tch/Documents/GitHub/DayzServerController/sidecar/server.js` | high | small | low | The cleanup function exists (command-queue.js) but is never called automatically. Should run periodically (e.g. every 5min) to delete stale command files >1min old. Add to server startup. |
| Add mtime-based staleness detection to CitadelBridge polling | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/citadel-bridge.js (lines 61-70)` | medium | small | low | Already caches mtime but doesn't emit a 'stale' event if data hasn't changed in >30s. Useful for dashboards to detect mod disconnection. Add optional staleness threshold config. |
| Validate command action string against whitelist before writing file | `/Users/sk3tch/Documents/GitHub/DayzServerController/sidecar/command-queue.js (line 58)` | medium | small | medium | Currently no validation of `action` param before serializing. Add whitelist (player.*, vehicle.*, world.*) to prevent typos from creating orphaned command files. |
| Add response timeout debugging to CitadelCommandRunner | `/Users/sk3tch/Documents/GitHub/DayzServerController/dayz-mod/@CitadelAdmin/scripts/5_Mission/CitadelCommandRunner.c` | medium | small | low | If a command file sits unprocessed for >30s, log it to CitadelEventLogger with command ID and action. Helps diagnose mod hangs or file permission issues. |
| Move magic numbers to constants in CitadelReporter/CitadelMetricsTracker | `/Users/sk3tch/Documents/GitHub/DayzServerController/dayz-mod/@CitadelAdmin/scripts/5_Mission/ (CitadelReporter.c, CitadelMetricsTracker.c)` | low | trivial | low | Interval values (5s, 10s, 15s) are hardcoded. Should read from CitadelConfiguration instead for runtime flexibility. |
| Add overflow protection to CitadelCore event registry | `/Users/sk3tch/Documents/GitHub/DayzServerController/dayz-mod/@CitadelAdmin/scripts/3_Game/CitadelCore.c (m_TrackedEvents array)` | high | small | medium | Events are appended indefinitely. If server runs for weeks without restart, array grows unbounded. Add max capacity (e.g. 1000) and FIFO eviction. |
| Document file format contracts in CitadelCommandRunner comments | `/Users/sk3tch/Documents/GitHub/DayzServerController/dayz-mod/@CitadelAdmin/scripts/5_Mission/CitadelCommandRunner.c (lines 1-100)` | low | small | low | File format is documented but could benefit from examples of command/response payloads for each action type (player.heal, player.teleport, etc.). |
| Use file existence check before reading game-data-store files | `/Users/sk3tch/Documents/GitHub/DayzServerController/sidecar/game-data-store.js (lines 24-46)` | low | trivial | low | readFileSync() will throw if file missing. Already guarded by fs.existsSync(), but error handling could be more specific (log file path on missing). |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Implement REST POST option for real-time ingame reports (optional fallback to file polling) | medium | medium | low | Reference shows value of dual-mode reporting (file vs REST). Citadel is file-only. For high-frequency updates (player positions), REST POST would reduce latency. Would allow sidecar to opt-in without polling overhead. Backward-compatible since file-based remains default. |
| Add automatic stale file cleanup to sidecar server startup | high | small | low | Function exists (cleanupStaleFiles) but is never invoked. Orphaned command files left by timed-out requests can accumulate and waste disk space. Should run on startup + periodically (5min interval). |
| Implement overflow protection for CitadelCore event/vehicle registries | high | small | medium | Arrays grow unbounded. Long-running servers (weeks+) risk memory exhaustion. Add capacity limits (e.g., 1000 events, 5000 vehicles) with FIFO eviction. Track evictions in metrics. |
| Add command action whitelist validation in sidecar before writing files | medium | small | medium | Typos or injected action values could create orphaned or invalid command files. Whitelist (player.*, vehicle.*, world.*) guards against operator error and potential security issues. |
| Add staleness detection events to CitadelBridge for connection monitoring | medium | small | low | Currently no way to detect if mod has stopped reporting (e.g., mod crash, file permission loss). Add optional 'stale' event emission (threshold 30s+ without mtime change) so dashboards can show 'connection lost'. |
| Move configuration values from hardcoded to CitadelConfiguration in reporters/tracker | low | small | low | Interval timings (5s vehicles, 10s events, 15s metrics) are hardcoded. Should read from CitadelConfiguration for operator flexibility without recompilation. Quick win for operational control. |
| Add comprehensive logging to CitadelCommandRunner for timeout diagnostics | medium | small | low | If a command file sits unprocessed for >30s, there's no log entry. Should log to CitadelEventLogger with command ID, action, timestamp. Helps diagnose mod hangs, file permission issues, or command handler crashes. |
| Consider optional static config dumps (low-priority future work) | low | large | low | Reference generates ammo/weapon/item/container dumps on first run. Useful for wiki generation, UI item lists, admin tools. Citadel lacks this. Not urgent but valuable for ecosystem. Would require parsing config tree (150-200 LOC) + infrastructure to push to sidecar. |

