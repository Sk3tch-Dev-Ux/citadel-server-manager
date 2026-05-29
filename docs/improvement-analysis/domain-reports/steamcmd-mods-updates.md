# Domain Report: SteamCMD, mods & updates

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

The reference codebase (DayZ Server Manager v3.10.0) implements SteamCMD and mod/server updates using TypeScript with dependency injection (tsyringe). Key architecture:

**Files:** `src/services/steamcmd.ts` (1000+ lines), `src/services/download.ts` (57 lines), `src/services/mission-files.ts` (148 lines), `src/types/steamcmd.ts` (121 lines)

**Core Patterns:**
- Enum-based exit code handling (`SteamExitCodes` with detailed descriptions)
- `SteamMetaData` class: local JSON-based cache per mod (lastDownloaded timestamp vs Steam's time_updated)
- `SteamCMD` singleton: manages process spawning, Steam login, SteamGuard detection with auth token caching
- Event-driven architecture: listener callbacks emit typed events (mod-progress, app-progress, output, retry, exit)
- Retry logic: 3 automatic retries on timeout (exit code 10) with exponential backoff implicit in loop
- Mod update batching by file size: splits large mod lists into batches (max 5 items, max 1GB per batch)
- Mod linking vs copying: configurable `linkModDirs` and `copyModDeepCompare` with folder hash comparison
- Deep directory comparison: `sameDirHash()` utility for detecting mod changes
- Workshop path resolution: multiple search paths (server steamapps, user's DayZ install, SteamCMD dir, alternate paths)
- Meta.cpp parsing: extracts mod name, timestamp from DayZ mod metadata
- Linux support: auto-lowercasing of mod folder names on non-Windows
- Key management: automatic .bikey file discovery and copying to server keys/ directory
- Experimental server branch support: configurable app IDs for experimental vs stable
- Path security: absolute path validation, detects path traversal in mission-files
- Mock-friendly: dependency injection for FS and HTTPS, making testing easier

## How Citadel does it

Citadel (the current product) implements SteamCMD and mod/server updates using Node.js CommonJS with global context objects. Key files and architecture:

**Files:** `backend/lib/steamcmd.js` (483 lines), `backend/lib/workshop.js` (240 lines), `backend/lib/mod-manager.js` (401 lines), `backend/lib/mod-cache.js` (401 lines), `backend/lib/auto-updater.js` (875 lines), `backend/lib/update-checker.js` (215 lines)

**Core Patterns:**
- Process spawning: direct `spawn()` with stdout/stderr piping and timeout management
- SteamGuard handling: detects "Steam Guard", "Two-factor", "authenticator" strings in output; cached login session support
- Manual retry wrapper: `downloadWorkshopModWithRetry()` with 2 retries, 5s/15s delays, skips auth failures
- Exponential backoff for API rate limiting: `fetchWithRateLimit()` with token bucket algorithm (10/min, 100/hour)
- Workshop scraping: 5 regex patterns for different Steam HTML layouts, enriches with Steam API
- Global mod cache: 30-minute TTL, 10GB size limit, LRU eviction, disk space monitoring
- Mod installation: atomic pattern (staging → validate → backup → rename → cleanup)
- Mod validation: checks for meta.cpp/config.cpp, .bikey files, non-empty dir, reasonable file count
- Auto-update pipeline: state machine (idle → detected → countdown → stopping → updating → starting)
- Pre-update backups: creates automated backups before SteamCMD operations
- Auto-rollback: restores pre-update backup if server crashes within 60s after restart
- RCON integration: broadcasts countdown messages, locks server, kicks players on update
- Notification system: configurable per-update-type, support for Discord webhooks
- Update state persistence: write-ahead journal for crash recovery
- Server type detection: experimental vs stable (checks server.gameTitle field)
- Mod reordering and type management (client vs server mods): rebuilds launch params on change
- Workshop content search: multiple fallback paths with error handling
- Rate limiting: global state with per-IP rate limiting for workshop API

## Detailed analysis

## SteamCMD, Mods & Updates: Cross-Reference Comparison

### Executive Summary

Both codebases implement SteamCMD integration and workshop mod management, but take fundamentally different architectural approaches. The **reference (DayZ Server Manager)** emphasizes type safety, event-driven design, and clean separation of concerns via dependency injection. **Citadel** prioritizes operational robustness—integrating RCON notifications, automatic rollback, persistent state recovery, and global mod caching—at the cost of some architectural tidiness.

Citadel's feature set is substantially broader: it includes pre-update backups, rollback on crash, RCON-based player notifications, mod type tracking (client vs server), and a global mod cache with TTL and LRU eviction. The reference codebase is more elegant in structure but lacks these critical operational features. Neither codebase is objectively "better"—they reflect different priorities. However, Citadel has accumulated technical debt in output parsing, SteamGuard handling, and module organization that should be addressed.

---

### Architecture Comparison

**Reference (TypeScript + DI):**
- Strict dependency injection via tsyringe singleton pattern
- Abstract event listeners for progress tracking
- Enum-based exit code mapping with metadata
- Per-mod local metadata (JSON files in a metadata directory)
- Modular, testable design with clear boundaries

**Citadel (CommonJS + Global Context):**
- Global `ctx` object holds server list, state, I/O socket, credentials
- Event-driven via Socket.IO emit (not abstracted)
- Exit code checks hardcoded as string matching
- Global mod cache directory with persistent metadata
- Feature-rich but tightly coupled

### Exit Code Handling

**Reference:** Defines `SteamExitCodes` enum (lines 2–27 of steamcmd.ts) with success/failure metadata:
```typescript
export enum SteamExitCodes {
    SUCCESS = 0,
    UP2DATE = 6,
    FRESH_INSTALL = 7,
    GUARD_CODE_REQUIRED = 63,
    // ... etc
}
export const steamExitCodesDetails = { [SteamExitCodes.SUCCESS]: [true, 'Success'], ... }
```

**Citadel:** Relies on string matching in output:
```javascript
if (code === 0 || output.includes('Success! App') || output.includes('already up to date')) {
  return resolve();
}
```

**Analysis:** Reference's approach is more maintainable and extensible. Citadel's string matching works but is fragile to Steam output format changes. Citadel should adopt an enum-based approach.

### SteamGuard & Authentication

**Reference:** Detects guards in output, prompts stdin for code, allows manual password entry via inherited stdio (lines 295–320 of steamcmd.ts). Caches auth token in SteamCMD's config/ directory for reuse.

**Citadel:** More sophisticated. `validateSteamLogin()` (lines 205–287 of steamcmd.js):
- Detects guard strings: "Steam Guard", "Two-Factor", "Two Factor", "authenticator", "Account Logon Denied"
- Implements stall detection: if "Logging in" appears but no success/failure within 20 seconds, assumes guard is waiting for input and rejects
- Caches success state in `ctx.steamLoginValidated` flag; reuses cached login with username-only args
- Tracks rate limiting and invalid credentials separately

**Analysis:** Citadel's stall detection is crucial for automated workflows where stdin input isn't available. It's a practical improvement over reference. However, the 20-second timeout can produce false positives on slow connections. Reference's approach of letting the user input codes interactively is simpler but unsuitable for automated servers.

### Mod Update Detection & Caching

**Reference:** `SteamMetaData` class (lines 21–161 of steamcmd.ts):
- Stores local metadata per mod: `{ lastDownloaded: timestamp }` in JSON files
- Compares local `lastDownloaded` (divided by 1000 to seconds) with Steam API's `time_updated`
- In-memory cache with 60-second TTL for Steam API responses
- Falls back to local meta.cpp parsing if API is unavailable

**Citadel:** Global mod cache (mod-cache.js):
- Persistent disk cache with 30-minute TTL (not request-level like reference)
- LRU eviction when entry count exceeds 500 or total size exceeds 10 GB
- Disk space monitoring (warns if < 5 GB available)
- Compares cache `time_updated` with Steam API time_updated for invalidation
- Does NOT track per-mod `lastDownloaded` across cache entries

**Analysis:** Both approaches are valid. Reference's per-mod JSON files are simpler but don't share cached content across servers. Citadel's global cache reduces redundant downloads but requires more complex eviction logic. Citadel's 30-minute TTL is static; reference's 60-second TTL for API responses is more responsive to Steam updates. Citadel should adopt reference's pattern of comparing `time_updated` from Steam API with cached metadata.

### Mod Installation & Linking

**Reference:** (lines 853–911 of steamcmd.ts)
- Configurable link vs. copy via `linkModDirs` flag
- If copying, uses `copyModDeepCompare` flag to skip if hash matches
- `sameModMeta()` checks if meta.cpp is identical (simple string comparison)
- Handles directory lowercasing on Linux
- Copies .bikey files to server's `keys/` directory

**Citadel:** (lines 182–301 of mod-manager.js)
- Always copies via staging directory (no hardlink option)
- Atomic pattern: stage → validate → backup existing → rename → cleanup
- Validates installation: meta.cpp/config.cpp presence, .bikey files, dir non-empty, file count > 1
- Creates meta.cpp if missing
- Removes spaces from folder names (DayZ -mod= parameter is space-delimited)

**Analysis:** Citadel's atomic installation is more robust against crashes mid-copy. Reference's deep hash comparison is more accurate for detecting changes but requires full directory traversal. Citadel's validation is stricter and catches partial/corrupted downloads. Citadel's space-removal in folder names is a practical fix for a real DayZ limitation.

### Auto-Update Pipeline

**Reference:** No built-in auto-update. `updateMod()` and `updateServer()` are synchronous/promise-based calls.

**Citadel:** Sophisticated state machine (auto-updater.js, 875 lines):
- State progression: idle → detected → countdown → stopping → updating → starting → idle
- Pre-update backups with automatic rollback on post-start crash (60-second window)
- RCON integration: broadcast countdown, lock server, kick players
- Write-ahead journal for state recovery on crash
- Configurable notification per update type (game, mod, shutdown)
- Supports experimental server app ID
- Manual update triggering with same state machine

**Analysis:** This is Citadel's strongest differentiator. The reference codebase doesn't attempt operational workflow automation. Citadel's rollback mechanism is production-grade and prevents data loss from botched updates. The journal-based recovery ensures the server recovers to the correct state even if Citadel crashes mid-update.

### Workshop Search & Enrichment

**Reference:** Assumes workshop item IDs are known. Calls Steam API directly: `ISteamRemoteStorage/GetPublishedFileDetails/v1/` (lines 123–159 of steamcmd.ts).

**Citadel:** Full search pipeline (workshop.js):
- Scrapes Steam Workshop HTML for DayZ (app 221100)
- Uses 5 fallback regex patterns to handle different Steam HTML layouts
- Enriches results with Steam API details
- Implements per-IP rate limiting: 10 req/min, 100 req/hour (token bucket)
- Exponential backoff on 429 responses
- 10-second timeout on API requests, 15-second on HTML scraping

**Analysis:** Citadel's search capability is essential for user-facing mod discovery. Reference's assumption that mod IDs are pre-known is suitable only for server operators who manage mods manually. Citadel's rate limiting and multiple regex patterns show pragmatic handling of Steam's inconsistent HTML.

### Mod Cache Implementation

**Reference:** None (uses local per-mod metadata files).

**Citadel:** Sophisticated (mod-cache.js, 401 lines):
- Directory layout: `<cacheDir>/<workshopId>/` (content) and `<cacheDir>/<workshopId>.json` (metadata)
- TTL-based expiration (configurable, default 30 minutes)
- LRU eviction when entry count > 500 or total size > 10 GB
- Disk space warnings when < 5 GB available
- Metadata includes: workshopId, name, cachedAt, time_updated, size
- Functions: `getCached()`, `storeInCache()`, `cleanCache()`, `getCacheStats()`

**Analysis:** Citadel's cache is substantially more sophisticated. It solves a real problem: avoiding redundant downloads when multiple servers need the same mod. Reference's per-mod JSON approach doesn't address this. However, Citadel's global cache introduces complexity (LRU, disk space, TTL management). The interaction between cache invalidation and Steam API time_updated needs clearer documentation.

### Retry & Backoff Strategies

**Reference:** `execute()` method (lines 355–441 of steamcmd.ts) retries 3 times on timeout (exit code 10) without explicit delay, relying on SteamCMD's implicit retry behavior.

**Citadel:**
- `downloadWorkshopModWithRetry()` (lines 460–481 of steamcmd.js): 2 retries on transient failures, 5s/15s delays, skips auth failures
- `fetchWithRateLimit()` (lines 78–117 of workshop.js): exponential backoff (1s → 2s → 4s → 8s → 16s) on network errors and 429
- `checkRateLimit()` (lines 41–72 of workshop.js): token bucket algorithm with per-minute and per-hour limits

**Analysis:** Citadel's retry strategies are more thoughtful. Reference's 3-retry loop is implicit and lacks delay, which could hammer Steam servers. Citadel's differentiation between auth failures (no retry) and transient failures (retry) is smarter. The token bucket rate limiting is sophisticated and prevents client-side abuse.

### Production Maturity Gaps

**In Reference (missing):**
- No auto-update workflow with rollback
- No RCON integration for player notifications
- No pre-update backups
- No crash recovery mechanism
- No global mod cache (redundant downloads across servers)
- No rate limiting for Steam API (could be throttled)

**In Citadel (issues):**
- SteamGuard detection is duplicated across 4 functions
- Output parsing uses duplicated regex patterns
- No mutual exclusion for concurrent SteamCMD spawns
- SteamGuard stall timeout (20s) is arbitrary and may cause false positives
- Mod cache invalidation rules not fully documented
- No integration tests for state machine recovery
- Global ctx object makes unit testing harder
- No async/await consistency (some functions return Promise, others callback-based)

---

### Verdict

Citadel is significantly more feature-complete for production use. It handles the full lifecycle of updates (detection, notification, rollback) and includes critical reliability features (backups, state recovery, RCON integration). The reference codebase is more elegant architecturally but incomplete for a commercial product.

**Key improvements for Citadel:**
1. Extract SteamGuard and output parsing logic into reusable modules to reduce duplication
2. Add distributed locking to prevent concurrent SteamCMD invocations
3. Document cache invalidation rules and add integration tests for state recovery
4. Adopt reference's exit code enum pattern for clarity
5. Implement a mod download queue for better operational control


## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Typed exit code mapping with metadata | ref_has_current_lacks | medium | small | Reference has `SteamExitCodes` enum with detailed success/failure metadata; Citadel has hardcoded success checks (e.g., 'Success! App', 'already up to date') scattered throughout output parsing. |
| Local metadata caching per mod | ref_has_current_lacks | medium | small | Reference tracks lastDownloaded timestamp per mod, compares with Steam's time_updated; Citadel has global mod cache with TTL-based eviction but no per-mod download tracking. |
| Batch size optimization by file size | ref_has_current_lacks | low | medium | Reference batches mods by total download size (max 1GB, max 5 items), fetches mod metadata from Steam API to sort by size; Citadel downloads/updates mods individually or in simple batches without size awareness. |
| Directory hash-based update detection | ref_has_current_lacks | low | medium | Reference uses `sameDirHash()` to detect file-level changes; Citadel relies on meta.cpp timestamp comparison and manual cache validation. |
| Auto-rollback on post-update crash | current_has_ref_lacks | high | large | Citadel has sophisticated 60-second verification window with automatic rollback if server crashes; reference has no rollback mechanism. |
| RCON-based countdown notifications | current_has_ref_lacks | high | large | Citadel broadcasts countdowns to players, locks server, kicks on update; reference has no RCON integration for updates. |
| Update state persistence and crash recovery | current_has_ref_lacks | high | medium | Citadel uses write-ahead journal for state machine recovery; reference has no crash recovery for interrupted updates. |
| Global mod cache with eviction | current_has_ref_lacks | medium | large | Citadel has persistent 30-minute TTL cache with LRU eviction and disk space monitoring; reference stores only lastDownloaded timestamp per mod in local JSON. |
| Workshop scraping with rate limiting | current_has_ref_lacks | medium | medium | Citadel includes full workshop HTML scraping with 5 fallback regex patterns and per-IP rate limiting; reference focuses on API calls, assumes workshop items are known. |
| Atomic mod installation pattern | current_has_ref_lacks | medium | medium | Citadel uses staging → backup → atomic rename → cleanup; reference uses simpler link-or-copy approach with sameModMeta() comparison. |
| Configurable mod batching without size optimization | ref_has_current_lacks | low | medium | Reference optimizes batches by file size from Steam API; Citadel batches without size awareness. |
| Dependency injection for testability | ref_has_current_lacks | low | large | Reference uses tsyringe for DI, makes FS/HTTPS swappable; Citadel uses direct `require()` imports and global ctx object. |
| Event listener pattern for progress tracking | ref_has_current_lacks | low | small | Reference emits typed events (mod-progress, app-progress, output); Citadel uses Socket.IO emit directly, no abstract event interface. |
| Mod type management (client vs server mods) | current_has_ref_lacks | medium | small | Citadel tracks mod type in modList, builds separate -mod= and -serverMod= params; reference doesn't explicitly track this distinction. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Add SteamExitCodes enum and exit code mapping | `backend/lib/steamcmd.js` | medium | small | low | Replace hardcoded output string checks with a typed enum mapping exit codes to success/failure booleans and descriptive messages. Reference lines 2-27 in steamcmd.ts show the pattern. This improves maintainability and makes it easier to handle new exit codes. |
| Add per-mod lastDownloaded tracking metadata | `backend/lib/mod-cache.js` | medium | small | low | Expand the mod cache metadata to include lastDownloaded timestamp alongside cachedAt. Compare against Steam's time_updated when available to invalidate outdated cache entries. Reference pattern at steamcmd.ts lines 46-87. |
| Improve mod installation validation robustness | `backend/lib/mod-manager.js` | medium | small | low | Current validateModInstallation checks for meta.cpp, config.cpp, or .bikey files but doesn't verify they're readable or valid. Add sanity checks: verify meta.cpp is parseable, ensure mod dir isn't suspiciously small (< 100KB), check for known DayZ structure files (addons/, keys/, etc.). |
| Harden SteamGuard detection for stall cases | `backend/lib/steamcmd.js` | high | small | medium | Current validateSteamLogin has stall detection (20s timeout on 'Logging in' without success/failure), but the stall timer is only set once. If SteamCMD restarts output parsing mid-login, the timer may not fire. Add robust tracking of when 'Logging in' was last seen, restart the timer if seen again. |
| Add checksum verification for downloaded mods | `backend/lib/mod-cache.js, backend/lib/mod-manager.js` | high | medium | low | Store SHA256 of downloaded mod content in cache metadata and verify on retrieval. Detects corruption from incomplete downloads or disk errors. Reference doesn't do this either, but it's a safety improvement for a commercial product. |
| Prevent concurrent SteamCMD invocations | `backend/lib/steamcmd.js` | high | small | medium | Current code spawns multiple SteamCMD processes without mutual exclusion. If two servers call updateServerApp() or downloadWorkshopMod() in parallel, both may run SteamCMD from the same directory, causing race conditions. Add a global semaphore or queue. |
| Reduce verbosity of console logging in SteamCMD output handlers | `backend/lib/steamcmd.js` | low | small | low | The handleData() functions in downloadWorkshopMod, updateServerApp, updateWorkshopMod parse the same regex patterns multiple times per line. Extract the parsing logic into a helper function to avoid duplication and reduce cognitive load. Lines 143-177 in steamcmd.js have repeated regex logic. |
| Add explicit SteamCMD working directory isolation | `backend/lib/steamcmd.js` | low | small | low | Current code spawns SteamCMD with `cwd: path.dirname(cmdPath)` (implicit from spawn). If SteamCMD creates temporary files or config, they may be scattered. Explicitly ensure each invocation uses a dedicated working directory, or document why they're shared. |
| Add retry to Steam API rate limit handling | `backend/lib/workshop.js` | medium | small | low | fetchWithRateLimit() currently retries on network errors and 429, but doesn't retry on other 5xx errors. Add retry on 502/503/504 with exponential backoff. |
| Enforce cache directory size limit more aggressively | `backend/lib/mod-cache.js` | medium | small | low | Current code checks maxSizeBytes only after adding a new entry and evicts if over. If many large mods are cached near the limit, eviction may not free enough space before the next download. Consider pre-checking available space and proactively evicting before download. |
| Validate server installDir exists before SteamCMD spawn | `backend/lib/steamcmd.js` | medium | small | low | ensureSteamCMD() doesn't verify that the server installDir exists or is writable. If the path is missing or permissions are wrong, SteamCMD will silently fail or write elsewhere. Add explicit mkdir with error reporting. |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Migrate SteamGuard logic to a dedicated module with state machine | high | medium | medium | SteamGuard detection is scattered across validateSteamLogin, downloadWorkshopMod, updateServerApp, updateWorkshopMod. Create a SteamGuardHandler module that centralizes detection heuristics (regex patterns, stall timeouts, success/failure signals). This will reduce duplication and make it easier to handle edge cases (e.g., multiple guard prompts, SMS vs email vs authenticator). |
| Extract SteamCMD output parsing into reusable regex library | medium | small | low | Progress parsing is currently duplicated across 4 functions (downloadWorkshopMod, updateServerApp, updateWorkshopMod, validateSteamLogin). Create a module with parsers for: login success/failure, download progress, update progress, error messages. Reduces maintenance burden and makes behavior consistent. |
| Add distributed lock for SteamCMD to prevent concurrent invocations | high | medium | medium | SteamCMD is not designed for concurrent use from the same directory. Current code may launch multiple SteamCMD processes simultaneously if auto-update and manual download happen at the same time. Use a simple file-based lock (flock on Unix, lockfile on Windows) to ensure only one SteamCMD process runs at a time. |
| Implement mod download queue with priority | medium | large | medium | Currently, downloadWorkshopMod and updateWorkshopMod spawn SteamCMD directly. For commercial robustness, implement a queue (in-memory with optional persistence) that serializes downloads, prioritizes user-initiated downloads over auto-updates, and allows cancellation. This also solves the concurrent invocation problem. |
| Add integration test for SteamGuard scenarios | high | medium | low | SteamGuard detection is critical and error-prone. Create mock SteamCMD outputs and test validateSteamLogin against: (1) no guard required, (2) guard with successful input, (3) guard timeout, (4) rate limiting, (5) invalid credentials. This will catch regressions early. |
| Document mod caching strategy and invalidation rules | low | small | low | Citadel's mod cache is feature-rich but the interaction between TTL, Steam API time_updated, and per-mod lastDownloaded is not documented. Add inline comments and a CACHING.md file explaining: when cache hits, when it's invalidated, how LRU works, what to do if cache is corrupted. |
| Add smoke tests for auto-updater state machine recovery | high | medium | low | Auto-updater uses a write-ahead journal for crash recovery. Create tests that simulate crashes at each state (detected, countdown, stopping, updating, starting) and verify the server recovers to the correct state on restart. |
| Implement telemetry for SteamCMD failures | medium | small | low | When downloadWorkshopMod or updateServerApp fails, log not just the error message but also: SteamCMD exit code, total time, retry count, which output patterns matched. This data helps diagnose systematic issues (e.g., Steam API throttling, network instability). |
| Refactor mod-manager.js to decouple mod installation from mod detection | medium | medium | medium | autoDetectMods(), installModToServer(), updateLaunchParamsMods() are tightly coupled. Separate concerns: mod discovery (scan disk, parse meta.cpp), mod state (track in memory), mod installation (staging + atomic swap). This makes testing and reordering logic easier. |
| Add daily cache validation job | medium | small | low | Mod cache can become stale if Citadel crashes or is killed mid-download. Add a background job (runs once per boot or on-demand) that iterates the cache directory, verifies each entry is complete (non-empty, has meta.json), and removes corrupted entries. |

