# Domain Report: Event scheduler, lifecycle hooks & scheduled backups

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

Reference (TypeScript, dayz-server-manager 3.10.0) uses: (1) **Events service** (`src/services/events.ts`, lines 1-146): node-schedule library with cron patterns, singleton injection via tsyringe, error handling via try-catch with logging; supports 6 event types (restart, message, kickAll, lock, unlock, backup) dispatched from config; checks server state before running RCON-dependent events. (2) **Hooks service** (`src/services/hooks.ts`, lines 1-69): registers on MONITOR_STATE_CHANGE event bus to trigger afterStart hooks; iterates hook configs; executes programs with spawnForOutput; logs success/failure, emits Discord notifications on hook failure. (3) **Backups service** (`src/services/backups.ts`, lines 1-81): synchronous backup creation into dated directories under backupPath; getBackups() enumerates existing backups with mtime; cleanup() removes backups older than backupMaxAge (in days); no ZIP, no retention config, simple directory copy via Paths.copyDirFromTo(). All three are TypeScript singletons with dependency injection (tsyringe), logger-first logging patterns, and event-bus integration.

## How Citadel does it

Current ("Citadel", Node.js) uses: (1) **Restart Scheduler** (`backend/lib/restart-scheduler.js`, lines 1-598): custom timer-based scheduling (no cron library) with 3 schedule types (interval, daily, onetime); pre-calculates next restart with calculateNextRestart() function; manages warning timers separately; persists schedules to JSON; has manual restart trigger with countdown; history tracking (limited to 50 entries). (2) **Lifecycle Hooks** (`backend/lib/lifecycle-hooks.js`, lines 1-351): directory-scanning discovery with filename patterns (lifecycle.{event}[-{index}].{ext}); supports .bat, .ps1, .py runners; blocking vs. non-blocking event semantics; environment variable injection (CITADEL_SERVER_*); timeout enforcement per hook (default 30s); Socket.IO emission for hook results. (3) **Backup Engine** (`backend/lib/backup-engine.js`, lines 1-692): ZIP-based backups using PowerShell Compress-Archive + robocopy staging for locked-file handling; wildcard path expansion (e.g., "profiles/*.ADM"); disk-space check (500MB minimum); separated automated vs. manual backup types; safety backup on restore; cleanup by age (maxKeepDays config); 60-second tick for automated backups; ZIP listing via .NET ZipFile. API routes in `backend/routes/backup.routes.js` (lines 1-150+) expose REST endpoints for config, create, list, delete, restore. Separate `notifications.js` handles Discord webhooks (currently stubbed for Cloud migration) and in-app notification persistence (7-day retention).

## Detailed analysis

## Event Scheduler, Lifecycle Hooks & Scheduled Backups: Citadel vs. Reference

### Executive Summary

Citadel's implementation of event scheduling, lifecycle hooks, and backups is **more feature-rich and production-hardened than the reference**, with significant advantages in backup robustness (ZIP compression, locked-file handling, wildcard paths) and hook orchestration (filesystem discovery, blocking semantics, timeout enforcement). However, Citadel trades the reference's clean dependency injection (tsyringe + TypeScript) for a more loosely-coupled object-based context model, and lacks true cron expression support, instead implementing a custom interval/daily/onetime scheduler.

### 1. Event Scheduling: Timer-Based vs. Cron

**Reference approach** (`src/services/events.ts`):
- Uses `node-schedule` library with cron patterns (npm dependency)
- Simple loop over config.events, calls `scheduleJob(name, cron, callback)` for each
- Relies entirely on node-schedule's cron parser; no custom timing logic
- 6 supported event types dispatched by type name (restart, message, kickAll, lock, unlock, backup)
- Checks server state (via monitor.serverState) before running RCON-dependent events
- Clean start() and stop() lifecycle with try-catch error handling

**Citadel approach** (`backend/lib/restart-scheduler.js`):
- Custom implementation of three schedule types: interval, daily, and onetime
- Calculates next restart time manually (calculateNextRestart(), lines 80-136)
- Manages per-server timers and warning intervals via setTimeout/clearTimeout
- Persists schedules to JSON; tracks restart history (limited to 50 entries)
- Supports manual trigger with countdown (triggerRestart(), lines 465-519)
- Currently disabled for Cloud integration (initialize() is a no-op as of May 2026)

**Analysis**: Citadel's approach is **lighter-weight** (no external cron library) and arguably **more feature-complete** within its scope (manual triggers, history, skip-next). However, cron expressions are far more expressive and familiar to sysadmins. The reference's simplicity is elegant: a single config array and node-schedule handles all the complexity. **Gap**: Citadel lacks support for arbitrary cron patterns (e.g., "every 2nd Tuesday at 10:15"). Recommendation: Add cron as an optional field alongside the existing interval/daily logic, using node-schedule to parse it when present. This is non-breaking and gives power users flexibility.

### 2. Lifecycle Hooks: Convention Over Configuration

**Reference approach** (`src/services/hooks.ts`):
- Hooks are defined in config (manager.config.hooks array)
- Each hook specifies program, params, and type (beforeStart, afterStart)
- Executes hooks sequentially via spawnForOutput with dontThrow flag
- Logs success/failure; emits Discord notifications on failure via EventBus
- No timeout enforcement shown; relies on OS process limits
- Very minimal — only ~69 lines total

**Citadel approach** (`backend/lib/lifecycle-hooks.js`):
- **Filesystem convention**: Scans `lifecycle_hooks/` directory for scripts
- Supports 4 events: pre-start (blocking), started (async), stopped (blocking), crashed (blocking)
- Supports .bat, .ps1, .py runners with spawn configuration per extension
- **Indexed multi-hooks**: `lifecycle.{event}-{index}.{ext}` allows ordered execution (e.g., lifecycle.pre-start-0.bat, lifecycle.pre-start-1.ps1)
- **Blocking semantics**: pre-start/stopped/crashed run sequentially; abort on non-zero exit. started fires concurrently
- **Timeout enforcement**: Per-hook timeout with process.kill() escalation (default 30s, configurable per server)
- **Environment injection**: CITADEL_SERVER_ROOT, CITADEL_SERVER_NAME, CITADEL_SERVER_PID, etc.
- **Socket.IO events**: Emits hookResult for UI updates (lines 244-285)
- Scaffolds a README explaining the system (lines 300-348)

**Analysis**: Citadel is **dramatically more sophisticated**. The filesystem convention eliminates config boilerplate and allows ops to add hooks without touching config files. The distinction between blocking and async hooks is explicit and safe (prevents pre-start hooks from running concurrently with startup). Timeout enforcement prevents runaway scripts from hanging the server. **Advantage to Citadel**: better for production ops. **Potential concern**: The reference's config-driven approach is easier to version-control and audit via Git.

### 3. Backups: Compression, Locking, and Safety

**Reference approach** (`src/services/backups.ts`):
- Simple directory copy (via Paths.copyDirFromTo) to timestamped subdirectories
- mpmissions_YYYY-M-D-H-M naming convention
- getBackups() enumerates with mtime, returns FileDescriptor array
- cleanup() removes backups older than backupMaxAge (in days)
- No compression, no ZIP, no restore capability

**Citadel approach** (`backend/lib/backup-engine.js`, ~700 lines):
- **ZIP compression** via PowerShell Compress-Archive (lines 202-207), reducing storage 50-80%
- **Robocopy staging** (lines 187-198): DayZ holds file locks during runtime; robocopy with /R:0 /W:0 copies non-locked files to staging dir first, avoiding Compress-Archive silent failures
- **Wildcard expansion** (lines 49-99): Patterns like "profiles/*.ADM" for selective backup
- **Disk space validation** (lines 147-166): Checks 500MB free before starting
- **Restore capability** (lines 402-554): Extracts ZIP; creates pre-restore safety backup automatically
- **ZIP listing** (lines 566-626): Inspects ZIP contents without extracting
- **Separate types**: automated (time-based) vs. manual (user-triggered) with separate directories
- **Cleanup** (lines 279-311): Removes .zip files older than maxKeepDays by checking mtime
- **In-progress flag** (lines 116-120): Prevents concurrent backups for a single server
- **Notifications & Socket.IO**: Emits backupCreated and backupRestore events (lines 258-260, 425-427)
- **5-minute timeout** for backup creation, **10-minute timeout** for restore

**Analysis**: Citadel is **far superior**. The reference's approach is useless for a live DayZ server where mpmissions is held by the running process — backups would silently fail or be incomplete. Citadel's robocopy staging solves this. Compression is critical for cost (e.g., 100GB mpmissions → 20GB ZIP). Wildcard paths and pre-restore snapshots are production necessities. The reference is suitable only for cold backups. **Advantage to Citadel**: Production-grade backup system.

**Issue in Citadel**: The robocopy step (line 197) only warns if exit code >= 8, but codes 4-7 indicate partial success (some files locked/skipped). A partially copied backup silently succeeds, which is worse than failure. Recommend: either abort the ZIP if any robocopy fails, or clearly log which paths were skipped.

### 4. Dependency Injection & Testability

**Reference approach**:
- Uses `tsyringe` decorators (@singleton, @injectable)
- Constructor injection of dependencies (Manager, Monitor, RCON, Backups, EventBus)
- Enables compile-time type safety and easy mocking in tests (lines 15-32 of events.test.ts)

**Citadel approach**:
- Module-level `ctx` object (global context) accessed via require
- No DI framework; tight runtime coupling via ctx.servers, ctx.serverStates, ctx.io
- Harder to test in isolation; requires mocking ctx object

**Analysis**: Reference is **more testable and refactor-friendly**. Citadel's ctx model works but is less modular. This is a tradeoff: Citadel avoids external dependencies (no tsyringe, no TypeScript) for a lighter footprint, while sacrificing testability. **Not critical** since Citadel is a working production system, but worth noting for future refactors.

### 5. Error Handling & Robustness

**Reference**:
- Events.execute() wraps in try-catch, logs errors, continues (lines 46-54)
- Hooks.executeHooks() returns success/failure; exits with non-zero from pre-start aborts server start
- Minimal validation; assumes config is correct

**Citadel**:
- Comprehensive error handling throughout (backup-engine: lines 150-166 disk check, 266-273 error case)
- safePath() guards against path traversal (lines 16 notation, used in backup.routes.js line 355)
- In-progress flags prevent concurrent backups
- Socket.IO fallback prevents crashes if ctx.io is missing
- Extensive logging at DEBUG/INFO/WARN/ERROR levels

**Analysis**: Citadel is **significantly more robust**. However, several **critical issues** exist:

1. **Backup filename validation** (lines 355, 386): deleteBackup() and findBackupFile() don't validate filename; a client could pass `../../../etc/passwd`. Should use `path.basename(filename)` or regex validation.
2. **ZIP integrity** (line 235-240): Checks if ZIP exists but doesn't validate it's readable. Recommend: try opening with .NET ZipFile before marking as successful.
3. **In-progress timeout** (line 169): If the backup process crashes, the flag persists, blocking future backups. Add a 30-minute hardcoded timeout.
4. **Robocopy handling** (line 197): Partial failures (exit 4-7) are not aborted; incomplete backups succeed silently.
5. **Hook environment sanitization** (line 176-192): CITADEL_SERVER_ROOT injected without validation; corrupted installDir could be exploited by hook scripts.

### 6. Architecture & State Management

**Reference**:
- Stateful singleton services (Events, Hooks, Backups) manage their own state
- State is in-memory; lost on restart (e.g., scheduled tasks array, hooks array)
- Manager.config is the source of truth for events and hooks

**Citadel**:
- Global ctx object holds all state (servers, serverStates, webhooks, notifications, io)
- Persistent state in JSON files (restart-schedules.json, restart-history.json, backup-*.json)
- Easier to inspect and debug (read JSON from disk)
- Fewer in-memory data structures to track

**Analysis**: Citadel's persistence model is **more durable**; schedules survive restarts. Reference's in-memory model is simpler but loses data. Citadel's approach is better for a long-running Agent.

### Key Findings Summary

| Aspect | Reference | Citadel | Winner |
|--------|-----------|---------|--------|
| **Event Scheduling** | Cron-based (flexible) | Timer-based (simple) | Reference (more expressive) |
| **Backup Compression** | No (directory copy) | Yes (ZIP) | Citadel |
| **Locked File Handling** | None (silently fails) | Robocopy staging | Citadel |
| **Hook Discovery** | Config-driven | Filesystem convention | Citadel (less config) |
| **Hook Blocking Semantics** | Implicit | Explicit | Citadel |
| **Hook Timeout Enforcement** | None | 30s enforced | Citadel |
| **Backup Restore** | Not present | Full implementation | Citadel |
| **Dependency Injection** | tsyringe (type-safe) | ctx globals (loose) | Reference |
| **Error Handling** | Minimal | Comprehensive | Citadel (with issues) |
| **State Persistence** | In-memory (lost on restart) | JSON files (durable) | Citadel |

### Conclusion

Citadel's implementation is **operationally superior** for DayZ server management: it handles real-world challenges (locked files, compression, manual triggers, hook orchestration) that the reference ignores. However, Citadel has critical security gaps (filename validation, ZIP integrity) and robustness issues (robocopy partial failure handling, in-progress timeout) that should be addressed. The reference's clean dependency injection and cron support are nice but non-essential for current operations. **Recommendation**: Prioritize fixing Citadel's critical issues (filename validation, ZIP integrity, robocopy handling) and consider adding optional cron support as a future enhancement.



## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Cron-based scheduling vs. timer-based scheduling | ref_has_current_lacks | medium | medium | Reference uses node-schedule with true cron patterns (via npm dependency); Citadel implements custom interval/daily/onetime timer logic without cron expressions. Cron is more flexible (e.g., 'every 2nd Tuesday'), but Citadel's approach is lighter-weight and has no external cron library deps. |
| Automatic backup ZIP compression | current_has_ref_lacks | high | trivial | Reference stores backups as plain directory copies (no compression); Citadel creates ZIP files with PowerShell, reducing storage by 50-80% depending on content. Citadel is strictly superior here. |
| Locked file handling in backups | current_has_ref_lacks | critical | trivial | Reference backup does not address DayZ's file locks (mpmissions held by running server); Citadel uses robocopy staging + /R:0 /W:0 to copy around locks, then ZIPs the staged copy. Citadel prevents silent backup failures. |
| Wildcard path expansion in backups | current_has_ref_lacks | medium | trivial | Reference supports only fixed paths; Citadel's expandWildcardPath() allows 'profiles/*.ADM' patterns for selective file backup. Citadel more flexible. |
| Disk space validation before backup | current_has_ref_lacks | medium | trivial | Reference has no pre-flight disk check; Citadel checks 500MB free before starting. Citadel avoids out-of-disk failures. |
| Hook file discovery and ordering | current_has_ref_lacks | high | trivial | Reference requires explicit hook config in JSON; Citadel scans filesystem with naming convention (lifecycle.{event}[-{index}].{ext}), supporting indexed multi-hook orchestration. Citadel reduces config boilerplate. |
| Hook timeout enforcement | current_has_ref_lacks | high | trivial | Reference does not set per-hook timeouts; Citadel enforces HOOK_TIMEOUT_MS (default 30s) with process.kill() escalation. Prevents runaway hooks. |
| Blocking vs. non-blocking hook semantics | current_has_ref_lacks | high | trivial | Reference hooks appear to execute sequentially (no explicit blocking vs. async distinction); Citadel separates pre-start/stopped/crashed (blocking, sequential, abort on failure) from started (non-blocking, concurrent, fire-and-forget). Citadel is explicit and safer. |
| Backup restore with safety snapshot | current_has_ref_lacks | high | trivial | Reference has no restore capability shown; Citadel's restoreBackup() creates a pre-restore safety backup automatically, preventing accidental data loss. Citadel more robust. |
| Typed dependency injection vs. object-based context | ref_has_current_lacks | medium | large | Reference uses tsyringe @singleton/@injectable for compile-time DI; Citadel uses module-level ctx object and require() for runtime coupling. Reference is more testable and refactor-friendly. |
| Graceful service lifecycle (start/stop) | ref_has_current_lacks | low | small | Reference Events.start() and Events.stop() cleanly manage cron job lifecycle; Citadel's restart-scheduler uses initialize() (now a no-op due to Cloud migration) and shutdown(). Citadel's API is looser. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Add in-progress flag timeout in backup creation | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/backup-engine.js (line 169-170, 223-225)` | high | small | low | If createBackup() is called twice in quick succession, the in-progress flag may persist indefinitely if the process crashes. Add a hardcoded timeout (e.g., 30 minutes) to auto-clear the flag. Currently: line 169 sets state.backup.inProgress = true, but no timeout exists if the process is killed. |
| Validate backup ZIP integrity after creation | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/backup-engine.js (line 235-240)` | high | small | medium | After Compress-Archive completes, the code checks if the ZIP exists, but does not validate it (e.g., is it a valid ZIP? Can it be read?). Add a quick validation: try opening the ZIP with .NET ZipFile and reading one entry. Prevents corrupted backups being silently persisted. |
| Escape backup filename in safePath call | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/backup-engine.js (line 355, 386)` | critical | small | high | deleteBackup() and findBackupFile() use safePath(backupsRoot, filename) without validation that filename is a simple basename. A malicious or confused client could pass '../../../etc/passwd' or 'file.zip?query'. Add path.basename(filename) before passing to safePath, or validate filename matches /^backup-[\d-]+\.zip$/ pattern. |
| Handle wildcard expansion errors gracefully in backup restore | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/backup-engine.js (line 442-447)` | medium | trivial | low | In restoreBackup(), the code expands wildcard paths to create a safety backup. If wildcard expansion returns an empty array (path doesn't exist), it skips the safety backup silently (line 486). Log a warning so admins know the safety snapshot wasn't created. |
| Add metrics/timing to hook execution results | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/lifecycle-hooks.js (line 238-240, 269-274)` | low | small | low | Hook execution logs success/failure but not duration. Slow hooks (e.g., 15s out of 30s timeout) go unnoticed. Store startTime before runHook(), measure elapsed, and include in log and Socket.IO event (e.g., 'durationMs': 1500). Helps operators spot performance issues. |
| Close staging directory race condition in backup creation | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/backup-engine.js (line 205-206, 232)` | medium | small | medium | The staging directory is removed asynchronously in proc.on('close'). If multiple backups fire in parallel (unlikely but possible), they may create the same staging dir name (based on timestamp) and interfere. Use a UUID or process-level counter for unique staging dirs, or add a locking mechanism. |
| Add robocopy success-code validation in backup creation | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/backup-engine.js (line 197)` | high | small | medium | The robocopy step checks 'if ($LASTEXITCODE -ge 8)' but the PowerShell script continues anyway with 'Write-Warning' instead of failing. If robocopy partially copies files (exit 4 = some failures), the ZIP may contain incomplete data. Change to fail the entire backup if any robocopy returns non-zero. |
| Prevent concurrent backup ticks with atomic flag | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/backup-engine.js (line 630-635)` | medium | small | low | The tick() function uses _tickRunning flag to prevent concurrent ticks, but the flag is set before the async work starts. If tick() runs twice and the first one is slower than 60s, the second tick may be skipped silently. Use a Promise-based approach or explicit queue instead of a boolean flag. |
| Add backoff retry for transient disk I/O errors | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/backup-engine.js (line 291-310)` | low | small | low | Cleanup reads dir entries and stats each file synchronously, but does not retry on ENOENT/EACCES errors (e.g., antivirus holding a file briefly). Add a simple retry loop (up to 3 attempts with 1s delay) for stat/unlink operations to avoid spammy debug logs. |
| Sanitize hook environment variables | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/lifecycle-hooks.js (line 176-192)` | high | small | medium | buildHookEnv() injects CITADEL_SERVER_ROOT and other env vars from ctx without validation. If a server installDir is corrupted or contains newlines, hook scripts could be exploited. Validate and sanitize (e.g., reject paths with newlines, ensure absolute paths, resolve symlinks). |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Implement ZIP integrity validation after backup creation | critical | small | low | Citadel's backup-engine checks if the ZIP file exists, but does not validate it. A PowerShell Compress-Archive error could create a zero-byte or corrupted ZIP silently. Add a quick .NET ZipFile read to confirm the ZIP is valid before updating lastBackupAt and notifying operators. This is a low-risk, high-confidence win that prevents silent data loss. |
| Validate backup filename as simple basename in delete/restore endpoints | critical | small | low | The deleteBackup() and findBackupFile() functions accept a filename parameter from the API without validating it. A malicious client could pass '../../../etc/passwd' and potentially access files outside the backup directory. Add a safeguard: filename = path.basename(filename) before processing, or validate it matches ^backup-[\d\-]+\.zip$. |
| Harden robocopy handling in backup creation | high | small | medium | The robocopy step in backup creation (line 197) issues a warning if exit code >= 8 but continues anyway. Exit codes 4-7 indicate partial success (some files skipped due to locks/permissions). A partially copied backup is worse than no backup. Either: (1) abort the ZIP if any robocopy fails, or (2) explicitly handle exit 0-7 as acceptable and only warn on 8+, with clear logging of which source paths were skipped. |
| Add in-progress timeout guard for backup creation | high | small | low | If createBackup() process crashes or is killed externally, the in-progress flag persists indefinitely, blocking future backups. Add a hardcoded or configurable timeout (e.g., 30 minutes) that auto-clears the flag. This is a low-risk defensive measure. |
| Implement cron expression support as opt-in enhancement | medium | medium | low | Citadel's restart scheduler uses custom interval/daily/onetime logic instead of cron. The reference uses node-schedule + cron-parser. Cron is more expressive (e.g., 'every 2nd Tuesday') and familiar to sysadmins. Add node-schedule as an optional parser: if a schedule contains a cron field, use node-schedule; otherwise fall back to existing interval/daily logic. This is non-breaking and gives power users more control. Effort is medium because it requires refactoring calculateNextRestart() and test coverage. |
| Add duration metrics to hook execution | medium | small | low | Hook logs currently show success/failure but not how long each hook took. Slow hooks (e.g., 20s of 30s timeout) go unnoticed, leading to surprise timeouts during restarts. Measure elapsed time (startTime before runHook), emit it in logs and Socket.IO events. Helps operators tune hook timeouts and spot hangs. |
| Use Promise-based queue for backup tick concurrency control | medium | small | low | The tick() function uses a boolean _tickRunning flag to prevent overlapping ticks. If a single tick takes >60s, the next tick will be skipped silently. Replace with a Promise-based queue (e.g., p-queue library) or explicit queue to ensure ticks are serialized without loss. |
| Validate hook environment variables for path injection | high | small | medium | buildHookEnv() injects CITADEL_SERVER_ROOT and other env vars from ctx without sanitization. A corrupted server installDir (e.g., containing newlines or quotes) could be exploited by a hook script. Validate and sanitize environment variable values (reject newlines, resolve symlinks, ensure absolute paths). |
| Log warning when backup restore skips safety snapshot | medium | trivial | low | In restoreBackup(), if wildcard path expansion returns no results, the safety backup is skipped silently (line 486). Admins should know the restore may not have a rollback point. Add a clear warning log so this is visible in audit trails. |
| Implement gradual migration away from timer-based restart logic to event-driven | low | large | medium | Citadel's restart scheduler was recently stubbed for Cloud migration (initialize() is now a no-op, line 570-573). The in-Agent code still runs manually via API but the scheduled cron loop is disabled. This is a larger architectural shift already in flight (per the comment: 'Restart scheduling moved to Citadel Cloud in May 2026'). No action needed now, but ensure frontend and Cloud integration are complete before fully removing this code. |

