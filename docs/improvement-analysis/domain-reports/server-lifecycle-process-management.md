# Domain Report: Server lifecycle & process management

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

**Reference (dsm-reference, TypeScript, ~2 years)**

Uses a clean, layered architecture with strong separation of concerns:

1. **Process Management (processes.ts, ~500 lines)**: Cross-platform abstractions via `ProcessSpawner` (spawns with timeouts, handles PTY for interactive output), `WindowsProcessFetcher` (queries WMIC), `Processes` base class (CPU/memory metrics, kill signals SIGTERM→SIGKILL escalation).

2. **Server Startup (server-starter.ts, ~286 lines)**: `spawn()` with detached=true, stdio='ignore', unref(); OS-specific command building (Windows uses `cmd /c start`; Linux runs exe directly). Includes config writing, DayZ.xml adjustment, SteamCMD integration, hook execution before/after start. Graceful (RCON) → forced (kill) transition.

3. **Monitoring (monitor.ts, ~241 lines)**: Long-running `Monitor` service with tickRunning guard, configurable `serverProcessPollIntervall` (from config), state machine (STOPPED→STARTING→STARTED→STOPPING) with intermediate-state blocking. CPU-based stuck-state detection (last 5 samples within ±3% variance → issue warning + Discord notify).

4. **Server Detection (server-detector.ts, ~70 lines)**: Caches DayZ process lookup for 1 second; applies 1-second TTL to avoid hammering OS on rapid polls.

5. **Type Safety**: Full TypeScript with enums (`ServerState`), interfaces (`IService`, `IStatefulService`), dependency injection via tsyringe, logging layer (LoggerFactory). Error handling flows through promise chains with explicit error logging.

**Key patterns**: Dependency injection, long-lived service classes with start/stop lifecycle, explicit state machines, promise-based async patterns, defensive polling intervals.


## How Citadel does it

**Current (Citadel, JavaScript/Node, commercial product)**

Uses a functional, module-based architecture optimized for rapid iteration and operational robustness:

1. **Process Management (process-manager.js, ~264 lines)**: Windows-only (tasklist/taskkill/PowerShell). Dual guards: `_pendingDetect` (per executable) and `_pendingMetrics` (per PID) prevent concurrent spawns. Unified `getProcessMetrics()` makes ONE PowerShell call (WorkingSet64 + CPU ticks together), delta-based CPU sampling with 5-min stale-entry cleanup. `spawnDayZServer()` returns `{child, launchFailed}` promise for early-failure detection (10s grace window).

2. **Server Lifecycle (server-lifecycle.js, ~318 lines)**: Centralizes start/stop/restart for reuse across manual UI, Discord bot, health monitoring, auto-updater. Multi-layer pre-checks: external process detection, port conflict checks (both Citadel-managed + system-wide PowerShell), firewall rule setup. Graceful RCON shutdown → taskkill fallback. Exponential backoff on restart failures (3s→6s→12s→24s→120s, resets if server runs >5 min). Sidecar/tailer lifecycle, audit logging, notifications, webhooks on every state change.

3. **Crash Detection (crash-detector.js, ~133 lines)**: Separate extraction from polling loop. Detects when running PID disappears. Circuit breaker: max 10 auto-restarts/hour (rolling window). Exponential backoff on crash (5s→10s→20s→40s→80s→5min), separate cooldown per restart type. Fires crash hooks, notifications, Discord alerts.

4. **Restart Scheduler (restart-scheduler.js, ~598 lines)**: Three schedule types (interval, daily, onetime). Default warnings 30/15/5/1 min before restart with RCON message interpolation. Persists schedules + restart history (50 entries) to JSON. Now disabled in-agent (migrated to Citadel Cloud). Exports full API: getSchedule, setSchedule, triggerRestart, getStatus.

5. **Wait-for-Ready (wait-for-ready.js, ~55 lines)**: Standalone CLI tool polling HTTP health endpoint until ready or timeout, used by installer.

6. **Port Checker (port-checker.js, ~136 lines)**: Two-layer check: (1) against ctx.servers for Citadel-managed conflicts, (2) system-wide PowerShell Get-NetTCPConnection for listening ports.

**Key patterns**: Functional/modular, in-memory state guards, dual polling (metrics + crash detection), Promise-based with non-blocking Discord/webhook fire-and-forget, centralized context (ctx), graceful degradation (port check fails open), audit trail on all ops.


## Detailed analysis

# Server Lifecycle & Process Management: Cross-Codebase Comparison

## Executive Summary

Citadel's server lifecycle implementation is operationally mature and feature-rich, with sophisticated crash detection, exponential backoff, circuit breaker limits, and comprehensive pre-flight checks. The reference codebase (dsm-reference) is architecturally cleaner (TypeScript, dependency injection, explicit service lifecycles) but lacks operational hardening features like restart backoff, crash auto-recovery, and audit logging. Citadel is ahead on operational robustness; the reference is ahead on code quality and maintainability. This report identifies 5 critical improvements for Citadel (all low-risk, high-impact) and 5 nice-to-haves.

## Current Architecture Comparison

### Process Management Layer

**Reference** (`processes.ts`, ~500 lines):
- `ProcessSpawner` class abstracts spawn logic with configurable timeout, PTY support, and handler callbacks
- Cross-platform: `WindowsProcessFetcher` (WMIC) + Linux /proc reader
- Metrics computed from two `ProcessEntry` samples (CPU delta over time, memory working set)
- No deduplication guards; repeated rapid calls spawn multiple PowerShell processes

**Citadel** (`process-manager.js`, ~264 lines):
- Focused on Windows (tasklist, taskkill, PowerShell)
- Two explicit deduplication guards: `_pendingDetect` and `_pendingMetrics` (per executable, per PID) prevent concurrent queries
- `getProcessMetrics()` unified call: single PowerShell query returns WorkingSet64 + UserProcessorTime + PrivilegedProcessorTime in one shot (major efficiency gain)
- Delta-based CPU sampling with 5-minute cleanup of stale entries to prevent unbounded memory growth
- Early-launch failure detection: `spawnDayZServer()` returns `{child, launchFailed}` promise that resolves after 10-second grace window

**Winner**: Citadel. The unified metrics call is a significant improvement over reference's pattern. Deduplication guards prevent OS query storms on multi-server setups. However, no process lookup caching (1-second TTL) means metrics tick may query OS 2–3 times for the same PID.

### Server Lifecycle Orchestration

**Reference** (`server-starter.ts`, ~286 lines):
- Separates concerns: `startServer()` and `killServer()`
- Kill gracefully via RCON first, then falls back to `process.kill()`
- No pre-flight checks (port conflicts, firewall rules)
- Synchronous state machine; no retry logic

**Citadel** (`server-lifecycle.js`, ~318 lines):
- Unified `startServer()`, `stopServer()`, `restartServer()` for reuse across UI, Discord bot, health monitoring
- Pre-flight checks: (1) external process detection, (2) port conflict detection (Citadel-managed + system-wide), (3) firewall rule setup (non-blocking)
- Graceful RCON shutdown (5-second grace) then taskkill
- Sophisticated retry on restart: exponential backoff (3s→6s→12s→24s→120s), cooldown reset if server survives >5 minutes
- Sidecar/tailer lifecycle management, audit logging on every transition, notifications + webhooks

**Winner**: Citadel by a large margin. The pre-flight checks and exponential backoff are operational necessities missing from reference.

### Monitoring & Crash Detection

**Reference** (`monitor.ts`, ~241 lines):
- Long-running `Monitor` service with configurable `serverProcessPollIntervall`
- State machine with intermediate-state blocking (prevents STOPPED→STARTING→STARTED→STOPPED thrashing)
- CPU-based stuck-state detection: if last 5 samples are within ±3% variance, alert and emit Discord notification
- No auto-restart on crash; just detection and logging

**Citadel** (split across `polling.js`, `crash-detector.js`, `metrics-collector.js`):
- `polling.js` orchestrates metrics tick every 15 seconds
- `crash-detector.js` handles process disappearance detection with auto-restart logic
- Auto-restart with circuit breaker: max 10 restarts per rolling hour (prevents restart loops)
- Crash backoff: 5s→10s→20s→40s→80s→5min, separate cooldown window
- Crash hooks, notifications, Discord alerts
- No stuck-state detection (CPU variance monitoring absent)

**Winner**: Split decision. Citadel's circuit breaker is critical for production (prevents infinite restart loops). Reference's stuck-state detection is nice-to-have (helps catch hung processes). Citadel lacks caching—every 15-second poll may hit OS multiple times.

### Restart Scheduling

**Reference**: No scheduler in scope.

**Citadel** (`restart-scheduler.js`, ~598 lines):
- Three schedule types: interval, daily, onetime
- RCON warning system: configurable messages at 30/15/5/1 minute marks
- Persistence: schedules + history (50 entries) stored to JSON
- Now disabled (migrated to Citadel Cloud), but code is well-structured for future re-enablement

**Winner**: Citadel (reference has none). Not directly comparable.

## Feature Parity Analysis

| Domain | Reference | Citadel | Status |
|--------|-----------|---------|--------|
| Cross-platform detection | ✓ (Windows + Linux) | Windows only | Citadel choice (market-focused) |
| Process spawn detached | ✓ | ✓ | Parity |
| Graceful RCON shutdown | ✓ | ✓ | Parity |
| Forced kill with SIGKILL | ✓ | ✓ | Parity |
| Pre-flight port check | ✗ | ✓ | Citadel ahead |
| Firewall rule setup | ✗ | ✓ | Citadel ahead |
| CPU-based stuck detection | ✓ | ✗ | Reference ahead |
| Process caching (1s TTL) | ✓ | ✗ | Reference ahead |
| Unified metrics call | ~ (two calls) | ✓ | Citadel ahead |
| Exponential backoff on restart | ✗ | ✓ | Citadel ahead |
| Circuit breaker (crash limit) | ✗ | ✓ | Citadel ahead |
| Audit trail logging | ~ (basic) | ✓ | Citadel ahead |
| Lifecycle hooks | ✓ | ✓ | Parity |
| State machine blocking | ✓ | ✓ (via flag) | Parity |
| Graceful shutdown handler | ~ (IStatefulService) | ✗ | Reference ahead |
| Typed code (TypeScript) | ✓ | ✗ | Reference ahead |
| Dependency injection | ✓ | ✗ | Reference ahead |

## Critical Findings

### 1. Missing Graceful Shutdown (Critical)

**Issue**: When Citadel's Node process receives SIGTERM (container stop, systemd restart), polling loops continue running in background, potentially orphaning DayZ processes.

**Evidence**: 
- `polling.js` starts timers but no process-level shutdown handler registered
- `data-store.js` defers JSON writes; on abrupt exit, state corrupts
- No equivalent to reference's `IStatefulService.stop()` method

**Impact**: Production reliability. Containers expect clean shutdown.

**Fix**: Add `process.on('SIGTERM')` handler → stop all polling timers → flush data → exit. Effort: 2–4 hours.

### 2. No Process Lookup Caching (Medium Priority)

**Issue**: Every metrics tick may call `detectRunningProcess()` multiple times (once from polling, once from crash-detector). On 15-second intervals with 4+ servers, this is 8+ PowerShell invocations/minute.

**Evidence**: 
- `process-manager.js` lines 72–125 spawn PowerShell each call
- No TTL or deduplication across metrics-collector + crash-detector
- Reference `server-detector.ts` line 25 caches 1 second

**Impact**: Operational overhead, though not critical on modern Windows.

**Fix**: Add `_lastProcessCheck: {ts, result}` to process-manager; return cached if <1s old. Effort: 30 minutes.

### 3. Missing Stuck-State Detection (Medium Priority)

**Issue**: If server hangs (e.g., infinite loop in script), CPU continues but FPS drops to 0. Operators notice via player complaints or game stats; Citadel has no automation.

**Evidence**: 
- Reference monitor.ts lines 204–231 tracks CPU variance
- Citadel metrics-collector.js has no such check
- Stuck servers consume resources but don't restart

**Impact**: Operational visibility; avoids cascading failures when one server hangs.

**Fix**: Add 5-sample CPU variance check; if <3% for 5 ticks, emit alert (non-blocking). Effort: 2 hours.

### 4. Crash-Detector Error Handling Incomplete (High Priority)

**Issue**: If `collectMetrics()` or any polling tick throws unhandled error, entire monitoring loop silently dies. No recovery.

**Evidence**: 
- `polling.js` `tick()` has try/catch, but top-level loop does not
- PowerShell commands may fail (permission denied, timeout)
- No global unhandledRejection listener

**Impact**: Silent monitoring downtime; operators unaware servers need manual restart.

**Fix**: Wrap tick invocation in try/catch + emit to logger. Effort: 1 hour.

### 5. No Tests for Exponential Backoff Edge Cases (High Priority)

**Issue**: Backoff logic is complex (restart cooldown reset after 5+ min uptime, max 10 crashes/hour). No unit tests. Edge cases like "crash at 4:59 min uptime" are untested.

**Evidence**: 
- `constants.js` defines RESTART_BACKOFF_DELAYS_MS but no test suite
- `crash-detector.js` canAttemptCrashRestart() uses rolling window but no test
- getNextBackoffDelay() in backoff.js (inferred) has no coverage

**Impact**: Risk of subtle bugs (restart loops, incorrect delays) under edge load.

**Fix**: Add Jest test suite; 15–20 test cases covering restart sequences, cooldown resets, circuit breaker. Effort: 4–6 hours.

## Low-Risk, High-Value Improvements

1. **Extract hardcoded timeouts to named constants** (e.g., 5000 ms RCON grace in line 174 of server-lifecycle.js). Makes tuning easier, documents intent. Effort: 30 min, zero risk.

2. **Add JSDoc @returns annotations** to crash-detector and restart-scheduler functions. Improves IDE support, no code changes. Effort: 20 min, zero risk.

3. **Document crash/restart backoff rationale** in constants.js (why 3s initial, why 5 min cooldown). Aids maintainers. Effort: 15 min, zero risk.

4. **Add RequestDeduplicator utility** to replace _pendingDetect/_pendingMetrics pattern. Reusable, testable. Effort: 1 hour, low risk.

5. **Integration test for spawn/stop/restart lifecycle** on real Windows test box. Catches PowerShell escaping bugs. Effort: 8 hours (setup), high confidence gain.

## Architectural Observations

### Citadel Strengths
- Operational maturity: backoff, circuit breaker, audit trail
- Pragmatic Windows-focus; no cross-platform complexity
- Centralized lifecycle (startServer, stopServer, restartServer) reused across UI, Discord, health monitoring
- Comprehensive pre-flight checks reduce operational surprises

### Citadel Weaknesses
- No graceful shutdown; potential orphaned processes on restart
- No stuck-state detection; relies on manual operator vigilance
- JavaScript without types; harder to refactor safely
- No dependency injection; tightly coupled modules via `require()`

### Reference Strengths
- Clean architecture: TypeScript, DI, explicit service lifecycles
- Stuck-state detection via CPU variance
- Cross-platform (though not needed here)
- Easier to test and refactor

### Reference Weaknesses
- No production hardening (no circuit breaker, no retry backoff)
- No pre-flight checks (port conflict, firewall)
- Monitoring is separate from restart logic
- No audit trail or webhook notifications

## Conclusion

Citadel's implementation is production-grade and operationally sophisticated. The reference is architecturally superior but lacks operational features. The 5 critical gaps identified above are all low-risk, achievable improvements that would significantly boost reliability and maintainability without breaking existing functionality. Priority order: (1) graceful shutdown, (2) error handling in polling loop, (3) backoff tests, (4) stuck-state detection, (5) process caching.


## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Cross-platform process detection (Windows vs. Linux/macOS) | ref_has_current_lacks | low | large | Reference: abstracts OS detection and has both Windows (WMIC) and Linux (/proc/) implementations. Current: Windows-only (tasklist/PowerShell). Citadel is commercial Windows-focused product — not a gap for the intended market, but a deliberate design choice. |
| Graceful shutdown of service on process exit | ref_has_current_lacks | high | medium | Reference: IStatefulService with explicit start/stop lifecycle, clearing timers and event listeners. Current: No formal shutdown hooks registered to Node.js process listeners (unhandled process termination could leave child processes orphaned). Polling loop just runs until force-killed. |
| CPU-based stuck-state detection | ref_has_current_lacks | medium | small | Reference: Monitors last 5 CPU samples; if variance <3% for 5+ ticks, marks server as stuck and alerts Discord. Current: No built-in stuck-state detection. Relies on manual operator intervention or external monitoring. |
| Process lookup caching with TTL | ref_has_current_lacks | medium | trivial | Reference: ServerDetector caches DayZ process list for 1 second, reducing OS polling overhead. Current: Every metrics tick calls detectRunningProcess (no cache), creating overhead on 15s polling interval with 4+ servers. |
| Unified multi-metric collection in single OS call | current_has_ref_lacks | high | trivial | Reference: Processes.getProcessCPUUsage computes from two ProcessEntry samples. Current: getProcessMetrics() combines RAM + CPU ticks in ONE PowerShell call (major improvement over reference pattern). Citadel is ahead here. |
| Graceful RCON shutdown before kill | both_have_current_better | low | trivial | Reference: killServer() tries RCON.shutdown() first, then falls back to process kill. Current: Also does graceful RCON shutdown (5s wait) then taskkill. Both are roughly equivalent. |
| Pre-start checks (port conflict, firewall rules) | current_has_ref_lacks | high | trivial | Reference: No port/firewall pre-checks before spawn. Current: Comprehensive port conflict detection (Citadel-managed + system-wide), firewall rule setup, all before spawn. Major operational advantage. |
| Exponential backoff on restart/crash with state-aware cooldown reset | current_has_ref_lacks | high | trivial | Reference: No retry or backoff logic. Current: Restart backoff 3s→120s with 5-min uptime cooldown; crash backoff 5s→5min with separate cooldown window. Sophisticated handling. |
| Circuit breaker for auto-restart (max 10/hour) | current_has_ref_lacks | high | trivial | Reference: No rate-limiting on auto-restart. Current: Tracks restart history per server in rolling 1-hour window, blocks auto-restart if limit hit. Prevents restart loops. |
| Audit logging on all lifecycle transitions | current_has_ref_lacks | medium | trivial | Reference: Logging via LoggerFactory but no structured audit trail. Current: Every start/stop/restart logs to audit.json with user ID, timestamp, reason. Full traceability. |
| Centralized restart scheduler with multiple schedule types | current_has_ref_lacks | low | trivial | Reference: No scheduler in this domain. Current: Full cron-like scheduler with interval/daily/onetime, RCON warnings, persistence, history tracking. Operational necessity. |
| State transition blocking (prevent intermediate state thrashing) | both_have_current_better | medium | trivial | Reference: Explicit block in monitor.ts: if state is STOPPING, reject incoming STARTED transition. Current: Uses _stateTransitioning flag during stop to block metrics polling. Both protect against concurrent state churn. |
| Dependency injection / IoC container | ref_has_current_lacks | low | large | Reference: Full tsyringe DI with @injectable/@singleton decorators, lazy initialization with @inject(delay()). Current: Plain require() with module-level state (ctx, logger). Less testable but simpler operationally. |
| Type safety via TypeScript | ref_has_current_lacks | low | large | Reference: Full TypeScript with enums, interfaces, strict nullability. Current: Plain JavaScript with JSDoc comments. Less compile-time safety but faster iteration. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Add process.on('SIGTERM'/'SIGINT') handler to drain connections and stop polling loops gracefully | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/polling.js, backend/app.js (or wherever main entry point is)` | critical | small | low | Currently, Node process termination does not properly shut down server monitoring loops or child processes. Add `process.on('SIGTERM', gracefulShutdown)` that: (1) stops all polling timers, (2) waits for in-flight metrics collection to complete, (3) closes Socket.IO, (4) flushes audit/data JSON to disk. Prevents orphaned DayZ processes and data corruption on restart. |
| Cache process detection results for 1 second to reduce OS query overhead | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/process-manager.js` | medium | trivial | low | Polling collects metrics every 15s but may call detectRunningProcess multiple times per tick across different checks. Implement a simple TTL cache: `{ lastCheck, result, ttl: 1000 }`. Similar to reference's ServerDetector pattern. |
| Add CPU-based stuck-state detection: track 5 samples, alert if variance <3% | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/metrics-collector.js (or new file monitor-health.js)` | medium | small | medium | Reference monitor.ts monitors CPU in stuck-detection; Citadel has no equivalent. When CPU ticks stop incrementing (stuck loop or hung process), send Discord alert + mark server as 'stuck' state. Can be non-blocking (metric warning only) to avoid false positives on legitimate idle servers. |
| Refactor server-lifecycle.js to use named constants for magic timeouts (5s RCON grace, 10s launch grace, 5min cooldown reset) | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/server-lifecycle.js` | low | trivial | low | Lines 174, 197, etc. have hardcoded delays. Extract to constants.js alongside LAUNCH_GRACE_PERIOD_MS, etc. Makes tuning easier and documents intent. |
| Add JSDoc @returns type annotations to crash-detector.handleCrash and restart-scheduler functions | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/crash-detector.js, /Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/restart-scheduler.js` | low | trivial | low | Current functions lack return type annotations. Add `@returns {Promise<{success: boolean, error: string\|null}>}` etc. Improves IDE autocomplete and future maintainability without requiring TypeScript conversion. |
| Wrap process.on('uncaughtException') handler around polling loop to log and continue instead of crashing | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/polling.js` | high | small | low | If collectMetrics or crash-detector throws unhandled error, entire polling loop dies. Wrap main tick logic in try/catch and emit to logger + Sentry (if configured). Current code has try/catch in tick() but not at top level. |
| Extract _pendingDetect and _pendingMetrics guards into a generic RequestDeduplicator utility | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/process-manager.js` | low | small | low | Lines 12–13 and 77–78 are nearly identical guard patterns. Create a reusable class to avoid duplicated logic and improve testability. |
| Add detailed comments explaining LAUNCH_GRACE_PERIOD_MS timeout semantics in spawnDayZServer | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/process-manager.js` | low | trivial | low | Lines 182–197 have a subtle promise that resolves after grace window even if process crashes. Document why this is 10s (DayZ slow startup) and that callers must check detectProcessByPid after launchFailed resolves. |
| Defensive: reject RCON/PID strings with shell-metachar regex in killProcess and port-checker | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/process-manager.js (line 146), backend/lib/port-checker.js` | medium | trivial | low | Both already do regex validation (`/[;&\|`$\\"']/`), but worth adding explicit unit tests. No code change needed, just assert these guards work as intended. |
| Add exponential backoff state machine tests covering edge cases (server-runs >5min and resets cooldown) | `(test suite; would be new)` | high | medium | low | Backoff logic in server-lifecycle.js and crash-detector.js is complex (cooldown reset on sustained uptime). Current code has no unit tests. Add Jest tests verifying: (1) first failure uses 3s, (2) second uses 6s, (3) server runs 5+ min then crashes again resets to 3s. |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Implement graceful shutdown handler: process.SIGTERM → drain + stop polling + flush state | critical | small | low | Citadel can crash abruptly on container/systemd restarts, potentially orphaning DayZ processes or losing in-flight audit/config changes. Reference pattern shows clean lifecycle management. Risk is low because handlers are backward compatible. Effort is small (register handlers, queue async work, await). Critical for production robustness. |
| Cache detectRunningProcess and detectProcessByPid results for 1 second | high | trivial | low | Citadel polls metrics every 15s, but crash-detector may call detectProcessByPid concurrently from the same tick. Reference ServerDetector uses 1s TTL. Effort is trivial (store timestamp + result). Reduces PowerShell invocations by ~50% on multi-server setups. No behavioral risk. |
| Add CPU-based stuck-state detection to metrics-collector or monitor loop | medium | small | medium | Reference detects when CPU variance <3% over 5 samples (hung process). Citadel currently has no stuck-state detection — admins must manually notice FPS drop or players complaining. Implementing as non-blocking (alert-only, not auto-restart) is safe. Effort small. Can save operator response time on frequent hangs. |
| Wrap polling tick loop in try/catch + emit to logger/Sentry to survive metric collection errors | high | small | low | If collectMetrics throws unhandled, entire monitoring loop dies silently. Reference pattern has explicit error handling. Risk is low (just defensive catch). Effort small. Prevents cascading failures on bad PowerShell output or race conditions. |
| Add comprehensive unit tests for exponential backoff state machine (backoff.js, server-lifecycle.js, crash-detector.js) | high | medium | low | Backoff logic is complex and non-obvious (cooldown reset on 5+ min uptime). No current tests. Reference has similar logic but doesn't test it either. Risk of subtle bugs (restart loops, incorrect cooldown calculation). Effort medium but high confidence gain. Recommend Jest test suite covering edge cases. |
| Document restart/crash backoff tuning parameters in constants.js with rationale comments | medium | trivial | low | RESTART_BACKOFF_DELAYS_MS and CRASH_BACKOFF_DELAYS_MS are tuned for specific DayZ startup times. Current comments are minimal. Document why 3s is initial delay (reference ~2-3s startup), why cooldown is 5 min (stability threshold), why max crash restarts is 10/hour (prevent thrashing). Aids future maintainers. |
| Consider migrating to structured logging (e.g., winston + JSON output) for operational observability | medium | medium | low | Current logger.js outputs to console/file. Reference uses LoggerFactory with levels. For production monitoring, structured JSON logs with timestamps, severity, context are better (easier to grep, parse in log aggregators). Not critical but medium-term win. Effort medium. No code change needed short-term. |
| Add audit trail index to audit.json (e.g., timestamp field) for faster querying of recent entries | low | small | low | Audit trail is appended sequentially but may be large (10k entries). Current code reads entire file. Add optional index field for pagination/filtering. Low priority (not a blocker) but improves UX when auditing restarts over time. |
| Add integration test that spawns real DayZ server and exercises start/stop/restart lifecycle | medium | large | low | Process management is critical. Current tests (if any) likely mock child_process. Real integration test (spawn actual exe on Windows test box) would catch PowerShell escaping bugs, timing issues, port conflicts. Effort large but high confidence. Recommend separate CI step. |
| Extract lifecycle hook orchestration into separate file (lifecycle-hooks already exists but verify it's well-integrated) | low | trivial | low | Hooks are called from multiple places: server-lifecycle.js, crash-detector.js, polling.js. Verify centralized executeHooks() is used consistently. Reference also has Hooks service. Current code seems well-separated, so this is a verification task (low priority). |

