# Domain Report: Logging, metrics & monitoring data

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

The reference (dayz-server-manager ~2022, TypeScript) uses a layered architecture: (1) **Structured file tailing** via LogReader (src/services/log-reader.ts:30-210) with a `tail` library and event-based architecture; defines RPT/ADM/SCRIPT log types as an enum and maintains file descriptors with mtime tracking. (2) **Type-safe metrics** (src/types/metrics.ts) with MetricTypeEnum (SYSTEM, PLAYERS, AUDIT, INGAME_PLAYERS, INGAME_VEHICLES) and MetricWrapper<T>. (3) **Database persistence** (src/services/database.ts) using better-sqlite3 with lazy-init wrapper (Sqlite3Wrapper) managing prepared statements, transactions, and safe param binding. (4) **Metrics collection** (src/services/metrics-collector.ts:13-74) orchestrating 15-second polling intervals with configurable retention, pushes to DB. (5) **System sampling** (src/services/system-reporter.ts:26-105) calculating CPU/RAM/disk via os module with delta-based calculations for total vs. interval usage. (6) **Dependency injection** using tsyringe singleton factories for service initialization. Logs kept in-memory but metrics persisted to metrics.db with timestamp+JSON payload. EventBus pattern emits InternalEventTypes.LOG_ENTRY for real-time feeds.

## How Citadel does it

Citadel (Node.js, current) uses an in-memory event-driven approach with file I/O persistence: (1) **Structured logging** via pino (backend/lib/logger.js:6-101) with JSON output in production, pretty-printing in dev, automatic redaction of 13+ sensitive fields (password, token, apiKey, jwt, etc.), and URL query string sanitization. (2) **Log tailing** split into: RPT scraper (rpt-scraper.js) reading last 4–128KB for FPS/kills with regex parsing, and console tailer (rpt-tailer.js:1-170) using fs.watchFile polling (1s Windows-reliable) with ring buffer (MAX_CONSOLE_LINES=500). (3) **Metrics storage** (audit.js:43–51) in-memory rolling window (360 points ~90min at 15s intervals) pushed per tick; CPU/RAM/FPS/players. (4) **System metrics sampler** (system-metrics-sampler.js:1-221) sampling CPU (30s) and disk (10min) asynchronously with threshold alerts + cooldowns. (5) **PvP stats** (pvp-stats.js:1-273) persistent per-server leaderboard as JSON with debounced writes (500ms), kills/deaths tracking, weapon stats. (6) **Routes** (logs-metrics.routes.js:40–108) exposing /api/:id/logs (with filtering by level/source/time), /api/:id/console, /api/:id/metrics. Logs buffered in ctx.serverStates[serverId].logs (unshift/pop O(1)). No dedicated metrics database.

## Detailed analysis


## Logging, Metrics & Monitoring Data: Cross-Reference Comparison

### Executive Summary

This domain tracks server health, player behavior, and system resource usage through three intertwined pipelines: **log tailing** (parsing DayZ RPT/ADM/console files), **metrics collection** (CPU, RAM, FPS, player count), and **analytics** (leaderboards, kill feeds, trend data). The reference codebase (TypeScript, ~2 years old) demonstrates a structured, database-backed approach using dependency injection and type safety. The current Citadel codebase (Node.js, production) uses a pragmatic in-memory architecture with file-system polling and JSON persistence, achieving the core functionality but with significant architectural gaps around data retention, schema safety, and lifecycle management.

### Key Architectural Differences

#### 1. **Metrics Storage & Retention**

**Reference Approach:** Better-sqlite3 database persistence. The `Metrics` service (src/services/metrics.ts) maintains per-metric-type tables (SYSTEM, PLAYERS, AUDIT, etc.) with timestamp-indexed rows and JSON-serialized values. The `deleteMetrics(maxAge)` method (line 43–51) enforces retention policy, enabling historical queries and long-term trend storage.

**Current Approach:** In-memory rolling arrays. The `pushMetrics()` function (audit.js:43–51) appends to `ctx.serverStates[serverId].metricsHistory` with separate arrays for CPU, RAM, players, FPS, and timestamps, capped at 360 entries (~90 minutes at 15-second intervals). On process restart, all metrics are lost.

**Impact:** Current approach prevents historical trend analysis, compliance audits, and long-term anomaly detection. Customers cannot view "server was pegged for 6 hours yesterday" or export metrics for capacity planning. The reference design survives restarts and enables external dashboards or BI tools to consume historical data.

#### 2. **Type Safety & Schema**

**Reference:** Explicit enums and type wrappers. `LogTypeEnum` (SCRIPT, ADM, RPT) and `MetricTypeEnum` (SYSTEM, PLAYERS, AUDIT, INGAME_PLAYERS, INGAME_VEHICLES) provide compile-time discrimination. `MetricWrapper<T>` interface enforces { timestamp, value } shape, and `LogMessage` specifies { timestamp, message }. Services accept typed parameters: `pushMetricValue(type: MetricType, value: MetricWrapper<any>)`.

**Current:** Ad-hoc positional arguments and object shapes. `pushMetrics(serverId, cpu, ram, playerCount, fps)` (audit.js:43) relies on argument position; callers must remember order and pass the right types. Metrics emission `ctx.io.emit('metrics', { serverId, cpu, ram, ... })` lacks schema validation. PvP stats use plain JSON serialization with no type guards.

**Risk:** Current approach is error-prone for refactoring (renaming a parameter breaks all callsites silently) and lacks IDE autocomplete. Metrics schema is implicit, making validation and versioning harder.

#### 3. **Sensitive Data Redaction**

**Reference:** No built-in redaction; relies on callsites to avoid logging credentials.

**Current (Stronger):** Pino logger with comprehensive redaction. Automatically redacts 13+ sensitive fields (password, token, jwt, apiKey, rconPassword, guardCode, mfaSecret, authorization) and sanitizes URLs before logging (logger.js:81–98). Query parameters like `?api_key=SECRET` are scrubbed before the log record reaches pino, preventing accidental credential leakage in server logs.

**Note:** This is one area where Citadel exceeds the reference. The URL sanitization (lines 81–98) prevents a real vulnerability where the DayZ mod's CommandRelay still sends `?api_key=...` on every GET (as documented in the code).

#### 4. **Log Tailing & File Watching**

**Reference:** `LogReader` service (log-reader.ts:30–210) uses the `tail` npm library with `new tail.Tail(filePath, { follow: true, fromBeginning: true, flushAtEOF: true })`. On error, retries with exponential backoff (10s between attempts, max 3 retries before giving up). Maintains a `FileDescriptor` with mtime for each log type.

**Current:** Dual approach:
- **RPT scraper** (rpt-scraper.js:14–35) reads only the last 4 KB for FPS extraction and last 128 KB for kill parsing. Stateless, efficient but potentially misses older events.
- **Console tailer** (rpt-tailer.js:78–153) uses `fs.watchFile(..., { interval: 1000 })` with manual read-loop, maintaining an offset for incremental reads. Deduplicates identical lines within 2 seconds.

**Risk Difference:** Reference's `tail` library handles partial reads, line buffering, and rotation detection (though not explicitly shown). Current's manual offset tracking is fragile if DayZ rotates logs or if the file is truncated (e.g., on restart). Current does handle truncation (offset > stat.size → reset offset, line 101–102).

#### 5. **Service Lifecycle & Dependency Injection**

**Reference:** TSyringe singleton pattern. `MetricsCollector`, `LogReader`, `SystemReporter`, and `Database` are singletons registered with the DI container. Services have explicit `start()` and `stop()` hooks. Example: `MetricsCollector.start()` initializes a timer, calls `stop()` to clear it (lines 27–44).

**Current:** Module-level globals and lazy initialization. `ctx` is a global context object, logger is a module-level pino instance, tailers are stored in a `tailers` object keyed by serverId. No formal lifecycle; tailing starts on first server status poll and cleanup is implicit (e.g., `stopTailing(serverId)` is called from polling.js but no guarantees).

**Risk:** Current approach can leak file descriptors if stopTailing is missed or called out-of-order. Difficult to test individual services in isolation.

#### 6. **Killfeed Parsing & Leaderboards**

**Reference:** No dedicated module; would require custom implementation.

**Current (Stronger):** 
- **rpt-scraper.js** (lines 41–66) extracts kills via regex: `/(\d{2}:\d{2}:\d{2})\s+Player "([^"]+)"[^]*?was killed by (?:player "([^"]+)"|(\S+))/g`. Parses victim, killer, method (PvP vs. environment).
- **pvp-stats.js** (lines 107–254) tracks per-player: kills, deaths, headshots, longestKill distance, weapons used, K/D ratio. Maintains persistent JSON with debounced writes (500ms). Supports multiple sort orders (kills, headshots, K/D).

Reference has no equivalent; implementing PvP stats would require custom regex + state management. Current's PvP module is domain-specific and well-factored.

#### 7. **System Resource Sampling**

**Reference:** `SystemReporter` (system-reporter.ts:26–105) samples CPU per socket via `os.cpus()` and calculates usage as `(cpuBusy / (cpuBusy + idle))` per core, then totals across cores. Tracks previous report for delta calculations: `interval = currentTotalTick - prevReport.uptime`, `used = currentCpuSpent - prevReport.cpuSpent`. Memory from `system.memTotal - system.memFree`.

**Current:** 
- **system-metrics-sampler.js** (lines 47–62) samples CPU via two `os.cpus()` snapshots 500ms apart, calculates idle/busy delta, returns percentage. Does not track history for process-level deltas. Memory is `(total - free) / total * 100`.
- Uses async sampling with separate timers: 30s for CPU/RAM, 10min for disk. Disk sampling shells out to PowerShell (Windows only, skipped on Linux/Mac).

**Difference:** Reference's delta calculations (subtracting previous report values) give true "CPU used in the interval"; current's single-delta approach gives instantaneous CPU %. For DayZ server monitoring, instantaneous is often sufficient, but reference's method is more accurate for capacity planning.

#### 8. **Error Handling & Retry Strategies**

**Reference:** Explicit retry with exponential backoff. LogReader (log-reader.ts:127–143) catches tail errors, unwatches the file, and retries up to 3 times with 10s delays. After max retries, gives up and logs a warning.

**Current:** 
- **rpt-tailer:** Watches file, on read errors logs debug message, continues polling.
- **system-metrics-sampler:** On disk sample failure, resolves null, continues. On CPU sample edge case (single-core VM), might return 0.

**Risk:** Current lacks explicit backoff; if a file is temporarily unavailable, it hammers it every 1s (fs.watchFile interval). Could spike CPU usage on flaky storage.

### Code Quality & Robustness Observations

#### Strengths in Current Codebase
1. **Sensitive data redaction** is production-grade (pino redaction paths + URL sanitization).
2. **Killfeed parsing** and **PvP leaderboards** are feature-complete, not present in reference.
3. **Pragmatic file watching** with deduplication and ring buffers (500-line console history kept; O(1) push+shift).
4. **Health threshold monitoring** (metrics-collector.js:100–137) with cooldown logic integrated into metrics collection.

#### Weaknesses
1. **No metrics persistence** beyond 90 minutes; no historical queries.
2. **Type safety is minimal** (positional arguments, implicit object shapes).
3. **Lifecycle is informal** (no start/stop hooks, hard to test).
4. **Log rotation not handled** (DayZ rotates RPT files; current offset-based reader could miss events or read duplicates).
5. **System sampling is stateless** (no delta calculations for true interval usage).

### Specific Code Issues & Risks

1. **audit.js:48–49:** `Object.keys(m).forEach(k => { ... m[k] = m[k].slice(-METRICS_HISTORY_SIZE) })` — inefficient if metricsHistory has many keys. Better to track length and pop/shift.

2. **rpt-tailer.js:100–112:** Offset tracking across file rotations. If DayZ rotates `server_console.log` to `.1` and writes a new `.log`, current code checks `stat.size < offset` and resets. This is correct, but no log is emitted about the rotation, making debugging harder.

3. **system-metrics-sampler.js:50–62:** CPU calculation assumes `c2[i]` exists for all i. If CPUs are hot-plugged or disabled, `c2.length !== c1.length`, causing undefined access. Defensive check missing.

4. **metrics-collector.js:74:** `if (metrics) pushMetrics(...)` silently skips if metrics collection fails. Should log at warn level, not just skip.

5. **rpt-scraper.js:56:** Regex allows `match[3] || match[4] || 'Unknown'` for killer name. If both are undefined (malformed log), 'Unknown' is used. No deduplication check; same kill event could be parsed twice if log file is re-read.

### Recommendations Priority & Effort

**High-Priority, Medium-Effort:**
- **Adopt better-sqlite3 for metrics.** Enable long-term trend storage, historical queries, and compliance audits. Use reference's Metrics service as a template. Estimated: 16 hours (DB schema, schema migration, API wrapper, retention policy).

**Medium-Priority, Small-Effort:**
- **Consolidate log/metric type definitions** (create schemas/logging.js). Reduces boilerplate and centralizes schema. Estimated: 4 hours.
- **Formalize service lifecycle** (start/stop hooks). Wrap tailers and collectors in service objects. Estimated: 6 hours.
- **Extend metrics API with time-range queries** (when DB is in place). Enables downsampling and trend views. Estimated: 8 hours.

**Low-Priority, Trivial-Effort:**
- **Strengthen CPU calculation** (handle variable core count). Estimated: 1 hour.
- **Add rotation detection log events.** Estimated: 2 hours.
- **Document metrics sampling SLAs.** Estimated: 1 hour.

### Risk Assessment

Migrating to better-sqlite3 carries **medium risk** because:
- Requires database schema migration if service is restarted mid-operation.
- Must handle concurrent writes (metrics collector on 15s ticks, API on GET requests).
- Backward compatibility: old in-memory metrics are lost, but acceptable since not persisted currently.

**Mitigation:** Introduce database layer as a wrapper around current in-memory arrays; keep both for a release cycle. Measure query latency; if DB calls block the event loop, use worker threads or async DB library (better-sqlite3 is synchronous).

Formalizing lifecycle and DI is **low risk** because the wrapping layer is additive; existing code is unchanged.

Improving log rotation handling is **medium risk** because edge cases in file offset tracking could cause duplication or loss. Requires thorough testing with actual DayZ log rotation scenarios.

### Conclusion

Citadel is **production-capable** but architecturally less sophisticated than the reference. The biggest gap is **metrics persistence**; customers lose 90+ days of trend data on restart. The reference's type-safe, DI-based design is more maintainable but requires significant refactoring. A pragmatic path forward: (1) adopt better-sqlite3 for metrics with a gradual rollout, (2) consolidate schemas, (3) keep the winning features (PvP stats, sensitive redaction, health monitoring) unchanged, and (4) add integration tests to prevent regressions in critical pipelines.


## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Metrics persistence to database (ref stronger, current weaker) | ref_has_current_lacks | high | medium | Reference stores metrics in better-sqlite3 with retention policy (deleteMetrics by maxAge), enabling historical queries and retention management. Current keeps metrics in memory only (~90min rolling window), loss on restart, no long-term trend data. |
| Type-safe metric enums and wrappers (ref stronger) | ref_has_current_lacks | medium | small | Reference defines MetricTypeEnum and MetricWrapper<T> (types/metrics.ts) with explicit type discrimination. Current uses ad-hoc pushMetrics() calls with positional args (cpu, ram, playerCount, fps) and plain object emissions. No compile-time checks or schema. |
| Injection container + singleton services (ref stronger) | ref_has_current_lacks | medium | large | Reference uses tsyringe DI for LoggerFactory, Database, LogReader, MetricsCollector with singleton scoping. Current has module-level globals (ctx, logger exports, _stores Map in pvp-stats). No service initialization pattern or lifecycle management. |
| Sensitive field redaction (current stronger) | current_has_ref_lacks | high | small | Current pino logger (logger.js:35–62) auto-redacts 13+ fields (password, token, apiKey, jwt, rconPassword, guardCode) via redact paths + URL sanitizer. Reference logger (util/logger.ts) has no built-in redaction; relies on callsites to avoid logging sensitive data. Current goes further with URL query param scrubbing. |
| Unified HTTP request logging middleware (current stronger) | current_has_ref_lacks | medium | trivial | Current uses pino with transport, sensitive field redaction, and env-based pretty-printing. Reference middleware/logger.ts logs raw request/response with hardcoded console.log—no log-level filtering, no redaction, no file persistence. Current also sanitizes URLs before logging. |
| Killfeed parsing + leaderboard stats (current stronger) | current_has_ref_lacks | low | trivial | Current rpt-scraper.js (line 54) parses kill regex with victim/killer/method, updateLeaderboard calculates K/D/score. Current pvp-stats.js tracks kills/deaths/headshots/weapon stats/longestKill per player. Reference has no dedicated killfeed parsing or leaderboard module. |
| File-level log rotation (neither implements well) | both_have_current_weaker | medium | medium | Reference logs RPT/ADM/SCRIPT from DayZ server files directly (no rotation handling). Current scrapes tail of RPT + console tailer (no rotation safety). Neither implements log rotation or max-file-size handling for their own logs. |
| Configurable metric poll intervals (ref stronger) | ref_has_current_lacks | low | trivial | Reference: metricPollIntervall from manager config (metrics-collector.ts:36). Current: hardcoded METRICS_POLL_INTERVAL_MS=15s and independent CPU sampler 30s, disk sampler 10min. No config override for metric frequency. |
| Process CPU/memory delta calculations (ref stronger) | ref_has_current_lacks | low | small | Reference SystemReporter calculates CPU delta by tracking prevReport timestamps and CPU spent (lines 50–53, 72–75), giving true interval usage. Current getProcessMetrics (from process-manager.js) returns raw CPU/RAM percentages; no delta-based interval calculation shown. |
| Console buffer API via dedicated Socket.IO event (current stronger) | current_has_ref_lacks | low | trivial | Current rpt-tailer emits 'consoleLog' Socket.IO event per line + maintains getConsoleBuffer() API for /console route. Reference LogReader emits generic InternalEventTypes.LOG_ENTRY but no API route examples shown. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Replace in-memory metrics with better-sqlite3 persistence | `backend/lib/audit.js, backend/lib/metrics-collector.js` | high | medium | medium | Current pushMetrics() (audit.js:43–51) stores metrics in ctx.serverStates[serverId].metricsHistory as rolling arrays. Add a metrics.db with tables per metric type (CPU, RAM, PLAYERS, FPS) with timestamp+value, implement retention via deleteMetrics(maxAge), migrate metrics polling to insert into DB. This enables historical trend queries and survives restarts. |
| Create MetricWrapper TS interface and typed metric enums | `backend/lib/audit.js, backend/lib/metrics-collector.js, backend/routes/logs-metrics.routes.js` | medium | small | low | Define MetricWrapper<T> = { timestamp: number, value: T } and MetricType enum (SYSTEM, PLAYERS, AUDIT). Replace pushMetrics(serverId, cpu, ram, playerCount, fps) with pushMetricValue(type: MetricType, value: MetricWrapper). Type-safe emissions and DB inserts. Small risk if scoped to new code paths. |
| Wrap log tailing with retry + exponential backoff | `backend/lib/rpt-tailer.js` | medium | small | low | Current readNewContent() catches errors but retrying is implicit. Reference LogReader (log-reader.ts:127–143) has explicit retry(count) and 10s delays. Add createTail-style retries to rpt-tailer's watchFile handler, cap at 3 attempts, log warnings, emit console.log entry on permanent failure. |
| Refactor pino logger to capture context/module names consistently | `backend/lib/logger.js` | low | small | low | Current pino logger is module-level default; callsites pass context via { serverId, consolePath } etc. Add createLogger(context: string) factory that auto-adds context to all logs from that module. Reduces boilerplate in logging calls (currently requires passing context in every log object). |
| Add log rotation + archive for DayZ server console logs | `backend/lib/rpt-tailer.js` | medium | medium | medium | Current rpt-tailer reads server_console.log directly but does not handle DayZ log rotation (DayZ rotates RPT/ADM/SCRIPT logs on restart). Add findRPTFiles-style logic to detect log rotation, handle file truncation gracefully (offset reset), and archive old server_console.log.N files to data/logs-archive/. |
| Formalize lifecycle hooks for tailing startup/shutdown | `backend/lib/rpt-tailer.js, backend/lib/metrics-collector.js` | low | small | low | Currently tailing is started/stopped ad-hoc. Reference LogReader extends IStatefulService with start()/stop() hooks. Formalize by wrapping rpt-tailer in a service object with start/stop, ensuring cleanup on server restart and preventing orphaned file watchers. |
| Add metrics export to CSV/JSON for long-term trend analysis | `backend/routes/logs-metrics.routes.js` | low | medium | low | Current /api/:id/metrics returns in-memory rolling window. Add /api/:id/metrics/export with time range, format (csv/json), and aggregation (raw/downsampled). Useful for historical analysis. If metrics are persisted to DB, this becomes cheaper. Can also compress exports gzip. |
| Harden system-metrics-sampler to handle PowerShell failures gracefully | `backend/lib/system-metrics-sampler.js` | low | small | low | Disk sampling (line 72) shells out to PowerShell; timeout is 5s but no retry. If PS call hangs or permission denied, sample silently fails. Add retry logic with exponential backoff, fallback to os.diskusage() if available, or use async child_process with .unref() to prevent blocking. Log failures but don't crash. |
| De-duplicate identical console log lines (improve noise reduction) | `backend/lib/rpt-tailer.js` | low | trivial | low | Current rpt-tailer dedups via lastLine+lastLineTime (line 125). Reference LogReader has no dedup. Extend current approach: track last 3–5 lines in a rolling window, skip if line matches any recent entry. Reduces repeat-message spam in DayZ logs (e.g., repeating 'FPS' lines). |
| Validate and document metrics sampling edge cases | `backend/lib/system-metrics-sampler.js, backend/lib/metrics-collector.js` | low | trivial | low | Current cpuPercent() uses os.cpus() deltas with 500ms delay; on 1-core VM might return 0. Document minimum requirements. Also: FPS fallback chain (sidecar → RPT → RCON) can return 0; audit.js should handle null/0 consistently for invalid metrics (skip emit or use sentinel value). |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Adopt better-sqlite3 for metrics persistence with retention policy | high | medium | medium | Reference's database design (src/services/database.ts, src/services/metrics.ts) enables historical trend queries and survives restarts. Current in-memory 90-min window is lost; customers with analytics dashboards or compliance needs lose data. Better-sqlite3 is lightweight, synchronous (fits current sync patterns), and already used by reference. Enables future exports, trend analysis, and longer-term alerting (e.g., 'server pegged for 2+ hours'). |
| Document and formalize server lifecycle hooks (start/stop services) | medium | small | low | Current tailing, metrics collection, and system sampling are ad-hoc. Reference uses IStatefulService pattern with lifecycle. Formalizing ensures cleanup on restarts, prevents file-descriptor leaks, and makes it testable. Low-risk refactor if scoped to new wrapping layer. |
| Consolidate log types and metric definitions into schema module | medium | small | low | Reference separates types (log-reader.ts, metrics.ts) from implementation. Current mixes them. Create backend/schemas/logging.js exporting LogType enum, MetricType enum, MetricWrapper type, LogMessage interface. All logging/metrics callsites import from there. Enables single source of truth and easier refactoring. |
| Extend metrics API with downsampling and time-range queries | medium | small | low | Current /api/:id/metrics returns raw in-memory array. Reference can query DB with time ranges. Add query params: ?since=<timestamp>&until=<timestamp>&downsample=<count>. Enables trend charts and long-term analysis. Low risk if current in-memory metrics are wrapped in a compatible interface first. |
| Preserve pino's sensitive-field redaction as a baseline security practice | high | trivial | low | Current auto-redaction of 13+ fields (logger.js:35–62) is stronger than reference. Ensure all new logging integrations inherit this. Document the redaction list and update it if new sensitive fields are added (e.g., moderation tokens, webhook secrets). Makes security audit easier. |
| Create integration test suite for log/metrics pipelines | medium | medium | low | No tests evident in current rpt-tailer, rpt-scraper, or metrics-collector. Reference has test/services/log-reader.test.ts, test/services/metrics.test.ts. Add tests for: log filtering, regex parsing (kills), metric collection error handling, DB retention, and graceful degradation (e.g., RCON unavailable). Catches regressions in critical pipelines. |
| Implement log rotation safety for DayZ RPT/ADM/SCRIPT files | medium | medium | medium | DayZ rotates log files on restart; current scrapers/tailers do not track file rotation. Reference handles via FileDescriptor mtime tracking. Add findLatestFiles() style rescanning when file size drops or mtime resets, gracefully handle offset overflow, and log rotation events. Prevents missed or duplicate log entries. |
| Establish SLA for metrics sampling (document latency, guarantees) | low | trivial | low | Current samples CPU/RAM every 30s, disk every 10min, server metrics every 15s. No documented SLA or guarantees (e.g., 'metrics shall be available within 60s of collection'). Document sampling windows, acceptable latency, and failure modes. Helps diagnostic troubleshooting and sets expectations for real-time features. |

