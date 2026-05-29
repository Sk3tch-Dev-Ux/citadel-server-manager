# Citadel — Cross-Reference Improvement Analysis

**Date:** 2026-05-29  
**Reference compared against:** `mr-guard/dayz-server-manager 3.10.0` (TypeScript, ~2 years old, single-process + Angular UI + watcher mod, 37 test files, Linux+Windows)  
**Current product:** Citadel Agent v2.20.0 (Node/Express backend, React frontend, Electron desktop, Discord bot, sidecar, @CitadelAdmin DayZ mod)  
**Method:** 13 parallel domain agents each read both codebases and produced structured findings; a synthesis agent consolidated and ground-truthed them.

---

## Executive summary

Citadel is a far larger, more mature, commercially-hardened product than the dsm-reference manager. Across all 13 domains the consistent pattern is: Citadel leads decisively on operational robustness and security (JWT+MFA+CSRF+fail2ban, AES-256-GCM credential encryption, audit logging, crash detection with circuit breakers, exponential backoff, atomic ZIP backups with locked-file handling via robocopy, bidirectional command-queue IPC, 75+ in-game admin commands, multi-server orchestration, restart scheduler, mod auto-rollback), while the TypeScript reference leads only on engineering hygiene: type safety, dependency injection, an event bus, comprehensive tests (35 test files vs Citadel's 1), and centralized request/config schema validation. The single highest-leverage theme is exactly that hygiene cluster — test coverage, typed-JS robustness (JSDoc + stricter ESLint), and centralized config/input validation — because Citadel's biggest sophisticated subsystems (backoff state machines, atomic data-store writes, auto-updater journal recovery, RCON packet handling) are almost entirely untested, which is the real production risk for a paid product.

The review surfaced two genuine correctness/security bugs worth fixing immediately: (1) unescaped XML serialization in globals-xml-parser.js (and likely other non-economycore parsers) that will corrupt mission files if a value contains &, <, or \" — verified at globals-xml-parser.js:74; and (2) backup delete/restore endpoints passing a client-supplied filename into safePath() without path.basename(), a path-traversal vector — verified at backup-engine.js:350-379. Both are trivial fixes. I also verified and DOWNGRADED two prominent recommendations that the domain reviews got wrong: the graceful SIGTERM/SIGINT/uncaughtException/unhandledRejection shutdown handler ALREADY EXISTS (server.js:540-558, polling.gracefulShutdown), and sidecar cleanupStaleFiles() is ALREADY wired on a 60s interval (sidecar/server.js:1342). Do not re-implement these.

The recommended path is incremental, NOT a rewrite. Explicitly reject full TypeScript conversion and tsyringe DI as too risky for a 2-year-old commercial product; instead capture the same benefits cheaply via stricter ESLint (floating-promise detection), JSDoc typedefs on core modules, a tiny request-validation helper, and a real test suite targeting the highest-risk state machines. Multi-part RCON packet assembly is the one functional gap that can cause silent data loss (large player/ban lists fragment over BattlEye) and should be prioritized. Linux/Docker and config hot-reload are real strategic gaps but are deliberate scope choices, not defects.

---

## Where Citadel already leads

Citadel is a substantially larger and more production-hardened product, and several reference 'recommendations' would be regressions if adopted. Do NOT regress these:

- Security: JWT + token revocation + TOTP MFA + CSRF (HMAC double-submit, constant-time) + per-IP/username fail2ban with escalating bans + AES-256-GCM credential encryption at rest + constant-time bcrypt with dummy-hash timing protection + comprehensive audit logging. The reference uses plaintext HTTP Basic Auth with credentials stored plaintext in config — unacceptable for production. This is the largest gap and it favors Citadel overwhelmingly.
- Resilience: crash-detector with a 10-restarts/hour circuit breaker, exponential backoff with uptime-based cooldown reset (restart 3s->120s, crash 5s->5min), comprehensive port-conflict + firewall pre-checks before spawn, and unified single-call RAM+CPU metrics collection. The reference has no retry/backoff and no circuit breaker.
- Updates: auto-rollback if the server crashes within 60s of a post-update restart, write-ahead journal for crash recovery, RCON countdown/lock/kick during updates, atomic staging->backup->rename mod install, and an LRU mod cache with disk-space monitoring. The reference has none of these.
- Backups: ZIP compression with robocopy staging to copy locked DayZ files, disk-space pre-check, and an automatic pre-restore safety snapshot. The reference does plain directory copies with no lock handling.
- IPC/mod: a bidirectional file-based command queue with atomic writes and 75+ admin commands, plus performance caching and session/event tracking. The reference is data-export only.
- Already-implemented items the reviews wrongly flagged as missing: graceful SIGTERM/SIGINT/uncaughtException/unhandledRejection shutdown (server.js:540-558 + polling.gracefulShutdown) and sidecar cleanupStaleFiles() on a 60s interval (sidecar/server.js:1342). Skip these.
- Architecture: explicitly reject full TypeScript + tsyringe migration. It is a large, high-risk rewrite of a working 2-year-old commercial product; the type-safety benefit is better captured via JSDoc + stricter ESLint. Also reject flattening 200+ endpoints into the reference's single CommandMap.

---

## Feature gap matrix

| Domain | Reference advantage (ref_has / current_lacks) | Citadel advantage (current_has / ref_lacks) | Net verdict |
|---|---|---|---|
| Server lifecycle | CPU stuck-state detection; process-lookup TTL cache | Crash detector + circuit breaker (10/hr), exp. backoff, port/firewall pre-checks, audit on all transitions, restart scheduler. (Graceful shutdown ALREADY present — server.js:540-558) | Citadel far ahead |
| SteamCMD & mods | Typed exit-code enum; per-mod lastDownloaded; size-aware batching | Auto-rollback on post-update crash, RCON countdowns, WAL crash recovery, atomic install, LRU mod cache, workshop scraping | Citadel far ahead; add concurrency lock |
| RCON / BattlEye | Multi-part packet assembly; inbound CRC32; lastResponse timeout; dedup cache | Command whitelist/validation, Socket.IO routing | Reference leads on protocol correctness (real bug) |
| Config & validation | Hot-reload watcher; comment-JSON; nested Arma cfg parsing; reflect-metadata schema | AES-256-GCM cred encryption, env-override system, mod-config schema registry, JWT-secret persistence | Citadel ahead on security; ref ahead on ergonomics |
| Logging & metrics | SQLite metrics persistence + retention; typed metric enums | pino redaction of 13+ fields, killfeed/leaderboard, console buffer API | Mixed; persistence is the gap |
| Scheduler/hooks/backups | Cron expressions (node-schedule); DI lifecycle | ZIP + robocopy locked-file handling, disk-space pre-check, restore safety snapshot, hook timeouts, blocking/non-blocking semantics | Citadel far ahead; harden robocopy/ZIP-integrity |
| Discord bot | Event-driven auto-notifications; message queueing; DI | Slash+button+modal UI (v14), HMAC audit signing, tiered cooldowns, multi-server context, input sanitization | Citadel ahead; add event notifications |
| In-game mod & IPC | REST report option; static config dumps | Bidirectional command queue (75+ cmds), atomic writes, perf caching, session/event tracking | Citadel far ahead; add registry overflow caps |
| Web UI / REST API | Centralized CommandMap; OpenAPI; schema validation | JWT+MFA+revocation, server-scoped RBAC, webhooks, diagnostic ring buffer | Mixed; validation+docs are real gaps |
| Mission/XML editors | DI + tests; async I/O | escapeXml (economycore only), per-file error isolation, mtime cache, audit trail | Citadel ahead BUT XML-escaping bug in other parsers |
| Architecture/testing | DI, event bus, 35 test files, TS, strict lint | Atomic data-store, multi-server orchestration, process resilience | Reference ahead on hygiene (the key theme) |
| Security & auth | (none meaningful) | JWT, CSRF, fail2ban, TOTP, cred encryption, audit, timing-attack protection, token revocation | Citadel vastly ahead |
| Cross-platform/ops | Linux binary, Docker, OS detection, systemd | NSSM service (15s throttle, failure recovery), Electron desktop, robust installer | Reference ahead on Linux; Citadel ahead on Windows ops |

---

## Quick wins (low risk, high value)

| # | Title | Domain | Files | Why |
|---|---|---|---|---|
| 1 | Fix unescaped XML in globals-xml-parser and audit all other parsers | Mission files & XML editors | `backend/lib/economycore-parser.js (export escapeXml to a shared util), backend/lib/globals-xml-parser.js:74, then audit spawnabletypes-parser.js, events-xml-parser.js, types-xml-parser.js, limits-parser.js, randompresets-parser.js, cfgeventspawns-parser.js` | VERIFIED bug: globals-xml-parser.js:74 interpolates g.name/g.type/g.value raw into attributes with no escaping. Only economycore-parser.js has escapeXml(). Any value containing &, <, or " produces malformed XML that DayZ rejects — silent server-config corruption. Trivial fix, critical impact. |
| 2 | Sanitize backup filename to a basename before safePath in delete/restore | Event scheduler & backups | `backend/lib/backup-engine.js:350-379` | VERIFIED path-traversal vector: deleteBackup()/findBackupFile() (backup-engine.js:350-379) pass client-supplied filename into safePath(backupsRoot, filename) without path.basename() or a /^backup-[\d-]+\.zip$/ allowlist. Apply path.basename() + regex validation. One-line guard, high security value. |
| 3 | Validate CREDENTIAL_ENCRYPTION_KEY format/length at startup | Security & Config | `backend/lib/credential-encryption.js:54-74, backend/lib/setup.js / server.js boot` | VERIFIED gap: credential-encryption.js refuses a missing key in production but never validates that the provided key is a 64-hex-char (256-bit) value. A typo or short key silently weakens AES-256-GCM. Add a loud startup check (hex, >=64 chars) that aborts in production. |
| 4 | Add floating-promise / misused-promise detection to ESLint | Architecture, Code Quality & Testing | `backend/.eslintrc.json` | Current backend/.eslintrc.json is eslint:recommended only — no async safety. With ~5000 lines of async JS and 30+ route files, unawaited promises are a silent bug vector. Add eslint-plugin-promise (or @typescript-eslint via checkJs) for no-floating-promises-equivalent rules. Trivial config change, high leverage. |
| 5 | Add 1-second TTL cache to process detection | Server lifecycle & process management | `backend/lib/process-manager.js` | VERIFIED: process-manager.js has _pendingDetect dedup but no TTL cache. Metrics polling + crash-detector call detectRunningProcess/detectProcessByPid repeatedly per 15s tick across 4+ servers, hammering PowerShell. A {lastCheck,result,ttl:1000} cache (reference ServerDetector pattern) cuts PowerShell invocations ~50%. |
| 6 | Add jest coverage thresholds and capture a baseline | Architecture, Code Quality & Testing | `backend/jest.config.js` | jest.config.js has collectCoverageFrom but no coverageThreshold. Run with --coverage to get the baseline, then set a low floor (e.g. lines:40, functions:50) that ratchets up. Cheap and prevents regression once tests are added. |
| 7 | Add SteamCMD concurrency lock (global semaphore/queue) | SteamCMD, mods & updates | `backend/lib/steamcmd.js` | steamcmd.js spawns SteamCMD without mutual exclusion; concurrent auto-update + manual download from the same dir causes race conditions / corrupt downloads. A simple in-process mutex (or file lock) is a small, high-value fix for a commercial product. |
| 8 | Add per-category sensitive-field redaction note + RCON allowed-commands API | Security & Authentication | `backend/lib/rcon-validator.js, backend/lib/token-revocation.js, backend/routes/rcon-players.routes.js` | Two trivial UX/security wins: expose rcon-validator getAllowedCommands() via an auth-gated endpoint so the UI shows allowed commands instead of guessing; and add an enum of token-revocation reason codes for cleaner audit forensics. |

---

## High-value strategic projects

| # | Title | Domain | Effort | Risk | Why |
|---|---|---|---|---|---|
| 1 | Test suite for high-risk state machines and persistence | Architecture / Cross-cutting | large | low | Citadel's most sophisticated, highest-risk code is almost entirely untested (1 test file covering only helpers). Target: exponential backoff (backoff.js, server-lifecycle.js, crash-detector.js cooldown-reset logic), data-store.js atomic write/flush/crash-recovery, auto-updater journal recovery at each state, RCON sequence wraparound, and SteamGuard detection scenarios. This is the single highest-leverage investment for production reliability of a paid product. Build incrementally to 10-15 high-value test files. |
| 2 | Multi-part RCON response assembly | RCON / BattlEye integration | medium | medium | Correctness bug with silent data loss: BattlEye fragments responses >~512 bytes (large player/ban lists) across packets, and rcon-client.js assumes single-packet responses. Add a multipart buffer keyed by sequence with completion detection (reference rcon.ts:675-712). Pair with inbound CRC32 validation and a lastResponse-based stale-connection timeout independent of keepalive. |
| 3 | Centralized request-validation schema layer | Web UI & REST API Architecture | medium | low | 40+ route files each hand-roll inline if-checks for input validation. A tiny lib/request-validator.js (required/optional, type, length, regex, enum, custom) used as route-entry middleware removes 20-30% boilerplate and yields consistent error messages. No external dep needed. Foundation for later OpenAPI generation. |
| 4 | Metrics persistence with better-sqlite3 + retention | Logging, metrics & monitoring data | medium | medium | Metrics live only in a ~90-minute in-memory rolling window and are lost on restart — customers with dashboards/compliance lose history. better-sqlite3 (synchronous, fits current patterns) with a retention policy enables historical trends, time-range/downsample API queries, and long-window alerting ('server pegged 2h+'). Also unblocks CSV/JSON export. |
| 5 | OpenAPI/Swagger spec for the REST surface | Web UI & REST API Architecture | large | low | Zero API documentation today across 200+ endpoints. An OpenAPI spec unblocks SDK generation, the Discord bot / Cloud bridge integrations, and automated API testing, and forces a review of every endpoint's auth and params. Start with auth/servers/mods as proof-of-concept, iterate. Do this AFTER the validation schema layer so metadata can feed the spec. |
| 6 | Config file watcher (hot reload) + JSDoc typedefs on core modules | Config Management & Validation / Code Quality | medium | low | Two complementary robustness investments: (1) chokidar-based watcher with MD5 change detection + debounce so manual citadel.config.json edits reload without restart; (2) retrofit JSDoc @typedef/@type to ctx, config, data-store, and core service signatures to get IDE type-checking and autocomplete without a TypeScript migration — captures most of the reference's type-safety benefit at a fraction of the risk. |
| 7 | Linux/Docker support behind an OS-detection abstraction | Cross-platform support & operations | large | medium | Strategic market expansion (VPS/cloud). Start with the foundational, near-zero-risk piece: a detect-os.js abstraction plus platform guards around firewall-manager.js and service-installer.js (NSSM/PowerShell are Windows-only and would hard-fail elsewhere). Full Linux server + Dockerfile is a large follow-on. This is opportunity, not a defect — sequence it after the reliability work. |

---

## Prioritized roadmap

## P0 — Do now (correctness/security bugs + cheap safety nets; days)
1. Fix unescaped XML serialization: promote escapeXml() to a shared util and apply in globals-xml-parser.js:74 and every other parser builder (spawnabletypes, events, types, limits, randompresets, cfgeventspawns). [VERIFIED bug]
2. Sanitize backup filename via path.basename() + /^backup-[\\d-]+\\.zip$/ allowlist in backup-engine.js deleteBackup()/findBackupFile(). [VERIFIED traversal vector]
3. Validate CREDENTIAL_ENCRYPTION_KEY (64-hex/256-bit) loudly at production startup. [VERIFIED gap]
4. Harden backup integrity: validate ZIP after Compress-Archive (open + read one entry), treat robocopy exit 4-7 as failure (not just >=8), add in-progress flag timeout, queue ticks.
5. ESLint: add async/promise safety rules (eslint-plugin-promise). Add jest coverageThreshold + capture baseline.
6. SteamCMD concurrency lock (mutex/queue).

## P1 — Next (highest-leverage robustness; weeks)
7. Test suite for risk-concentrated code: backoff state machines, data-store atomic writes/flush/recovery, auto-updater journal recovery, RCON sequence wraparound, SteamGuard scenarios. Ratchet coverage threshold up.
8. Multi-part RCON response assembly + inbound CRC32 validation + lastResponse stale-connection timeout. [correctness/data-loss]
9. Centralized request-validation schema middleware across routes; standardize error envelope {error,code?,suggestion?,details?} + catch-all Express error handler.
10. 1s TTL process-detection cache (process-manager.js).
11. JSDoc typedefs on ctx/config/data-store/core service signatures (type safety without TS).
12. Sidecar/mod hardening: CitadelCore event/vehicle registry overflow caps (FIFO eviction), command action whitelist before write, staleness ('connection lost') events on CitadelBridge.
13. CPU-based stuck-state detection (alert-only); per-username rate limiting alongside per-IP; tamper-evident/append-signed audit log.

## P2 — Strategic (larger investments; quarters)
14. Metrics persistence via better-sqlite3 + retention + time-range/downsample API + export.
15. OpenAPI/Swagger spec (after validation layer) -> SDK + integration testing.
16. Config hot-reload watcher (chokidar + MD5 + debounce); optional comment-JSON template docs.
17. Discord event-driven notifications (crash/startup/update-complete) + message-ready queueing.
18. Cron-expression restart schedules as opt-in (node-schedule) layered over existing logic.
19. Cross-platform: detect-os.js + platform guards on firewall/service modules, then Linux server + Dockerfile (market expansion).
20. Nested Arma-cfg parser for serverDZ.cfg; ajv schema validation on JSON imports.

Explicitly NOT doing: full TypeScript/tsyringe migration; CommandMap flattening; re-adding already-present graceful shutdown or sidecar cleanup.

---

## Full consolidated report

# Citadel Cross-Reference Consolidated Improvement Plan

## 1. Context and overall posture

This report consolidates 13 domain reviews comparing Citadel (the current commercial Windows-focused Node.js/JavaScript product) against `dsm-reference` (DayZ Server Manager v3.10.0, a ~2-year-old TypeScript project). The dominant finding, repeated across nearly every domain, is asymmetric: **Citadel decisively leads on operational robustness and security; the reference leads only on engineering hygiene** — type safety, dependency injection, an event bus, and especially test coverage (35 test files vs Citadel's 1).

Because Citadel is the larger, paid product, the correct strategy is to harvest the reference's hygiene practices incrementally without regressing Citadel's substantial operational advantages, and explicitly to avoid the two big rewrites the reference might tempt us toward (full TypeScript + tsyringe DI, and collapsing 200+ endpoints into a single CommandMap). The single highest-leverage theme — and the one the orchestrator correctly flagged — is **test coverage + typed-JS robustness + config/input validation**, because Citadel's most sophisticated subsystems are also its least tested.

## 2. Ground-truth verification (corrections to the domain findings)

I verified several load-bearing claims directly against the code. Two prominent recommendations are already implemented and must NOT be re-done:

- **Graceful shutdown already exists.** server.js:540-558 registers `process.on('SIGTERM')`, `SIGINT`, `unhandledRejection`, and `uncaughtException`, delegating to `gracefulShutdown(server, ...)` exported from polling.js. The lifecycle-domain 'critical' recommendation to add this is obsolete; at most, verify it flushes data-store and closes Socket.IO.
- **Sidecar stale-file cleanup is already wired.** sidecar/server.js:1342 calls `setInterval(() => cleanupStaleFiles(), 60000)`. The IPC-domain 'high' recommendation to invoke it is obsolete.

Three bug/gap claims are confirmed real and become P0:

- **Unescaped XML (confirmed).** globals-xml-parser.js:74 interpolates `g.name`, `g.type`, `g.value` directly into attribute strings. Only economycore-parser.js defines `escapeXml`. Any `&`, `<`, or `\"` in a value yields malformed XML the DayZ server rejects — silent config corruption.
- **Backup path traversal (confirmed plausible).** backup-engine.js:350-379 `deleteBackup()`/`findBackupFile()` pass a client-supplied `filename` into `safePath(backupsRoot, filename)` with no `path.basename()` or filename allowlist.
- **CREDENTIAL_ENCRYPTION_KEY not format-validated (confirmed).** credential-encryption.js:54-74 refuses a *missing* key in production but never checks the *provided* key is 64-hex/256-bit, so a weak/typo'd key silently degrades AES-256-GCM.

Also confirmed: process-manager.js has only a `_pendingDetect` dedup Set, no TTL cache (the 1s-cache quick win is valid); ESLint is bare `eslint:recommended` (no async safety); jest.config.js has no `coverageThreshold`.

## 3. Where Citadel already wins (do not regress)

- **Security:** JWT + revocation + TOTP MFA + CSRF (HMAC double-submit, constant-time) + per-IP/username fail2ban + AES-256-GCM credentials at rest + constant-time bcrypt with dummy-hash. The reference is plaintext Basic Auth with plaintext credentials in config.
- **Resilience:** crash detector with 10/hr circuit breaker, exponential backoff with uptime-based cooldown reset, port/firewall pre-checks, single-call RAM+CPU metrics. Reference has none.
- **Updates/backups:** auto-rollback on post-update crash, WAL journal recovery, RCON countdown/lock/kick, atomic mod install, LRU mod cache; ZIP backups with robocopy locked-file staging, disk pre-check, pre-restore safety snapshot.
- **IPC/mod:** bidirectional atomic command queue with 75+ admin commands.

These represent years of commercial hardening and should be protected during any refactor.

## 4. The central theme: tests + typed-JS + validation

Citadel's risk is concentrated in untested complexity. The backoff math (backoff.js, server-lifecycle.js, crash-detector.js) with its 5-minute uptime cooldown reset, the data-store.js atomic temp-file+rename with symlink refusal and permission modes, the auto-updater's write-ahead journal recovery, and RCON sequence wraparound are exactly the kind of non-obvious logic where regressions are silent and expensive — and all are currently untested. The first-class investment is therefore a focused test suite over these state machines plus persistence, accompanied by two cheap accelerants: stricter ESLint (catch floating promises across ~5000 lines of async JS) and JSDoc typedefs on core modules (most of TypeScript's safety benefit, none of the migration risk). On the input side, a small request-validation helper replaces ad-hoc per-route `if` checks, standardizes error responses, and later feeds an OpenAPI spec.

## 5. Functional gaps worth real money

Beyond hygiene, two functional items matter. **Multi-part RCON assembly** is a genuine correctness bug: BattlEye fragments responses over ~512 bytes (large player/ban lists), and rcon-client.js assumes single packets — silent truncation/loss. Pair it with inbound CRC32 validation and a `lastResponse` stale-connection timeout. **Metrics persistence** (better-sqlite3 + retention) ends the ~90-minute in-memory window that is lost on restart, unblocking dashboards, exports, and long-window alerting.

## 6. Deliberate scope choices (opportunities, not defects)

Linux/Docker support, config hot-reload, cron-expression schedules, comment-JSON config, and an event bus are reference strengths that reflect Citadel's deliberate Windows-commercial focus rather than defects. They belong in P2 as strategic bets (Linux/Docker especially unlocks the VPS/cloud market), sequenced after the reliability work and started with the zero-risk OS-detection abstraction plus platform guards on the Windows-only firewall/service modules.

## 7. Sequencing rationale

P0 is bugs and cheap safety nets (XML escaping, backup path guard, key validation, backup integrity, ESLint/jest config, SteamCMD lock) — all low-effort, low-risk, high-value, mostly trivial diffs. P1 is the high-leverage robustness core (tests, RCON multipart, validation layer, process cache, JSDoc, mod registry caps). P2 is strategic platform/observability investment. Throughout, avoid the two large rewrites and the two already-done items. This keeps Citadel's operational lead intact while closing the engineering-hygiene gap that is its only real exposure as a commercial product.

---

## Per-domain reports

- [Server lifecycle & process management](domain-reports/server-lifecycle-process-management.md) — 14 feature gaps, 10 code improvements, 10 recommendations
- [SteamCMD, mods & updates](domain-reports/steamcmd-mods-updates.md) — 14 feature gaps, 11 code improvements, 10 recommendations
- [RCON / BattlEye integration](domain-reports/rcon-battleye-integration.md) — 10 feature gaps, 6 code improvements, 6 recommendations
- [Config Management & Validation](domain-reports/config-management-validation.md) — 9 feature gaps, 8 code improvements, 7 recommendations
- [Logging, metrics & monitoring data](domain-reports/logging-metrics-monitoring-data.md) — 10 feature gaps, 10 code improvements, 8 recommendations
- [Event scheduler, lifecycle hooks & scheduled backups](domain-reports/event-scheduler-lifecycle-hooks-scheduled-backups.md) — 11 feature gaps, 10 code improvements, 10 recommendations
- [Discord bot integration](domain-reports/discord-bot-integration.md) — 10 feature gaps, 10 code improvements, 8 recommendations
- [In-game report mod & IPC](domain-reports/in-game-report-mod-ipc.md) — 10 feature gaps, 9 code improvements, 8 recommendations
- [Web UI & REST API Architecture](domain-reports/web-ui-rest-api-architecture.md) — 9 feature gaps, 9 code improvements, 8 recommendations
- [Mission files & XML editors](domain-reports/mission-files-xml-editors.md) — 10 feature gaps, 7 code improvements, 7 recommendations
- [Architecture, Code Quality & Testing](domain-reports/architecture-code-quality-testing.md) — 9 feature gaps, 10 code improvements, 8 recommendations
- [Security & Authentication](domain-reports/security-authentication.md) — 11 feature gaps, 10 code improvements, 10 recommendations
- [Cross-platform support & operations](domain-reports/cross-platform-support-operations.md) — 8 feature gaps, 7 code improvements, 6 recommendations
