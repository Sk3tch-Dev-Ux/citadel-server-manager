# Phase 3 — Implemented Improvements (Change Log)

**Branch:** `analysis/dsm-cross-reference`
**Date:** 2026-05-29
**Scope:** The P0 tier of the [improvement roadmap](README.md) — verified correctness/security bugs plus cheap, low-risk safety nets. Each change was verified against the real code before editing, and every change is covered by a new test or a manual verification noted below.

> Strategy: surgical, low-risk wins only. No architecture changes, no TypeScript migration, no dependency additions. Everything here is behaviour-preserving for valid inputs and only changes behaviour for the malformed/malicious inputs that were previously mishandled.

---

## 1. Fixed unescaped XML serialization across all mission-file parsers  *(VERIFIED BUG — critical)*

**Problem:** Only `economycore-parser.js` escaped XML special characters. Every other economy-file serializer interpolated user-supplied strings directly into XML attributes/text. Any value containing `&`, `<`, `>`, `"` or `'` produced malformed XML that the DayZ server silently rejects on boot — i.e. silent economy-config corruption. The canonical case was `globals-xml-parser.js:74`.

**Fix:**
- Added a single shared helper module **`backend/lib/xml-escape.js`** exporting `escapeXml` (attribute values — also collapses CR/LF/TAB runs to one space) and `escapeXmlText` (element text — preserves whitespace).
- Applied escaping to every user-controllable string attribute/text node in:
  - `lib/globals-xml-parser.js` — `name`, `type`, `value`
  - `lib/types-xml-parser.js` — `type name`, `category`, `user`/`usage`/`value`/`tag` names
  - `lib/events-xml-parser.js` — `event name`, `secondary`, `position`, `child type`
  - `lib/limits-parser.js` — `category`/`usage`/`value`/`tag` names
  - `lib/cfgeventspawns-parser.js` — `event name`, `pos.group`
- Consolidated the two pre-existing local copies onto the shared util (single source of truth):
  - `lib/economycore-parser.js` now imports `escapeXml` (removed its duplicate; still re-exported for backward compatibility with `economycore-editor.routes.js`).
  - `lib/spawnabletypes-parser.js` — local `escXml` now delegates to the shared `escapeXml`.
- Numeric fields (nominal, lifetime, coords, etc.) were intentionally **not** wrapped — escaping never changes a number, and leaving them untouched keeps diffs minimal and output byte-identical for valid data.
- `lib/spawnpoints-parser.js` left unchanged — it only emits fixed group keys and numeric coordinates (no injection surface).

**Verification:** New regression suite `tests/parser-xml-escaping.test.js` round-trips malicious values through a real `fast-xml-parser` and asserts the decoded attributes equal the originals; `tests/xml-escape.test.js` unit-tests the helper.

---

## 2. Closed backup filename path-traversal vector  *(VERIFIED — high security)*

**Problem:** `deleteBackup()` and `findBackupFile()` (`backend/lib/backup-engine.js`) passed a client-supplied `filename` into `safePath()` with no `path.basename()` or filename allowlist. While `safePath` blocks `..` containment escapes, there was no defence-in-depth ensuring the target is actually a backup archive.

**Fix:**
- Added `sanitizeBackupFilename(filename)` to `backup-engine.js`: rejects any value containing a path separator or `..`, strips to `path.basename`, and requires a plain `^[A-Za-z0-9._-]+\.zip$` name.
- Applied it at the top of both `deleteBackup()` and `findBackupFile()` (returns `false`/`null` on rejection). The audit log message now records the sanitized name.
- Exported the function for testability.

**Verification:** `tests/backup-filename.test.js` covers traversal, separators, non-zip extensions, and bad input types.

---

## 3. Validate `CREDENTIAL_ENCRYPTION_KEY` loudly at startup  *(VERIFIED gap — high)*

**Problem:** `credential-encryption.js` refused a *missing* key in production but never validated that a *provided* key was strong. A truncated/typo'd key silently weakened the AES-256-GCM derivation (the key is used as a PBKDF2 passphrase, so even a 4-char key "works").

**Fix:**
- Added `validateKeyConfig()` to `lib/credential-encryption.js`:
  - Production + missing → throws (unchanged contract, now centralized).
  - Production + shorter than 32 chars → throws (a real `openssl rand -hex 32` key is 64 chars; anything this short is misconfiguration).
  - Present but not 64-hex → non-fatal warning (still usable as a passphrase).
  - Dev + missing → non-fatal warning.
- Wired it into the boot sequence in `lib/server-init.js` `startup()`, right beside the existing `JWT_SECRET` fatal guard. Fatal cases log `logger.fatal` and rethrow; warnings go to `logger.warn`.
- **Deliberately not a hard 64-hex requirement**, to avoid bricking existing production installs that set a reasonable (≥32-char) passphrase. Genuinely weak keys still fail fast.

**Verification:** `tests/credential-encryption.test.js` covers all branches plus an encrypt/decrypt round-trip and random-IV property.

---

## 4. ESLint async-safety rules + clean error baseline  *(hygiene — high leverage)*

**Problem:** `backend/.eslintrc.json` was bare `eslint:recommended` — no async-correctness signal across ~5000 lines of async JS. Lint also had **2 pre-existing errors**.

**Fix (`backend/.eslintrc.json`):**
- Fixed the 2 pre-existing `no-useless-escape` errors in `economycore-parser.js:22` (`VALID_FOLDER_REGEX`) — `[..._\-]` → `[..._-]`, behaviour-identical. Lint now reports **0 errors**.
- Added async/quality rules **as warnings** (so CI is not broken by the existing backlog, but the signal is now visible):
  - `no-async-promise-executor` (error — the one genuinely dangerous pattern)
  - `no-promise-executor-return`, `require-atomic-updates`, `no-return-await`, `no-unused-expressions` (warn)

**Note:** Full floating-promise detection requires type information (`@typescript-eslint` with `checkJs`, or `eslint-plugin-promise`). That was intentionally deferred to avoid adding a dependency and flooding CI with new failures — tracked as a P1 follow-up.

**Verification:** `npx eslint .` → 0 errors (was 2).

---

## 5. Jest coverage ratchet  *(hygiene)*

**Fix (`backend/jest.config.js`):** added a low `coverageThreshold` floor (statements/lines 10, functions 5, branches 3) and excluded `*.test.js` from `collectCoverageFrom`. Only enforced under `--coverage`; normal `npm test` is unaffected. Ratchet upward as the suite grows.

---

---

## 6. Multi-part RCON response assembly  *(P1 — VERIFIED data-loss bug)*

**Problem:** `lib/rcon-client.js` treated **every** BattlEye command response as a single packet (`payload.slice(1).toString('utf8')`, resolve immediately). BattlEye fragments any response larger than ~512 bytes — large `players` and `bans` lists — across multiple UDP packets, each framed as `[seq, 0x00, total, index, ...part]`. The old code (a) prepended the `0x00/total/index` control bytes as garbage onto the body and (b) resolved on the first fragment and deleted the pending command, silently discarding every subsequent fragment. Net effect: truncated/corrupted player and ban lists with no error.

**Fix (`backend/lib/rcon-client.js`):**
- Added `multipartBuffers` (a `Map` keyed by sequence) to the client.
- Extracted command-response handling into `_handleCommandResponse(payload)`, which detects the multi-part marker (`payload.length >= 4 && payload[1] === 0x00`) and otherwise treats the response as single-part.
- Added `_collectMultipart(seq, total, index, part)` — buffers fragments by index, tolerates out-of-order delivery and duplicate UDP retransmits, ignores malformed headers (`index >= total`), resets cleanly when a sequence is reused for a new response, and only returns the concatenated body once all fragments arrive.
- `send()` clears any stale buffer for a reused sequence and drops the buffer on command timeout; `disconnect()` clears all buffers.
- This is purely additive: single-part responses (the overwhelming majority) behave exactly as before.

**Verification:** `tests/rcon-multipart.test.js` (8 tests) covers single-part, in-order/out-of-order/duplicate fragments, a >512-byte reassembly, malformed headers, and sequence reuse.

---

## 7. RCON robustness follow-ups: CRC32 validation + stale-connection timeout  *(P1)*

Companions to the multipart fix, on the same `lib/rcon-client.js`:

- **Inbound CRC32 validation** — every received packet's 4-byte little-endian checksum (bytes 2..5, covering bytes 6..end) is now recomputed via `_verifyChecksum(msg)` and the packet is dropped (debug-logged) on mismatch. This matches the reference manager's behaviour and rejects corrupted/spoofed UDP. Verified self-consistent against the client's own `_buildPacket` framing (round-trip test).
- **Stale-connection timeout** — the client records `lastResponseAt` on every valid packet. A new guard at the top of the keepalive loop reconnects if nothing has been received for `RCON_STALE_TIMEOUT_MS` (45 s — BattlEye itself drops idle links at ~45 s), independent of whether `socket.send()` appears to succeed (UDP gives no delivery proof). New constant added to `lib/constants.js`.

**Verification:** 4 new CRC tests in `tests/rcon-multipart.test.js` (round-trip accept, tampered body, corrupted checksum field, runt packet).

---

## 8. Test suite for high-risk state machines & persistence  *(P1 — highest leverage)*

The analysis flagged that Citadel's most sophisticated, highest-risk code was almost entirely untested. This adds focused coverage for three of those modules (no behaviour change — two private helpers were exported purely for testability):

- **`backoff.js`** (exponential-backoff math shared by restart + crash recovery) — now **100% covered**: schedule escalation, clamp at the final delay, cooldown-window reset vs. no-reset-while-active, and per-key independence. Driven with fake timers to control `Date.now()`.
- **`data-store.js`** (atomic JSON persistence) — now **~96% covered**: `loadJSON` parse/missing/computed-default/corrupt-fallback, `forceFlush`/`flushAll` latest-wins coalescing, debounced atomic write leaving no `.tmp` residue, stale-temp-file cleanup, and the **M16 symlink-refusal guard** (verifies a symlinked destination's target is never clobbered).
- **`crash-detector.js`** circuit breaker — exported `canAttemptCrashRestart`/`recordCrashRestart`; tests the 10-restarts/hour rolling window: allow-up-to-limit-then-block, full recovery after the hour, partial aging frees exactly the expired attempts, and per-server isolation.

Coverage ratchet raised to statements 12 / branches 4 / functions 6 / lines 13 (overall now 13.3% / 15% lines, up from 11.6% at the start of this work — and the *targeted* high-risk modules are at 95–100%).

---

## 9. Quick-win batch: process-detection cache + SteamCMD lock + more tests  *(P1)*

- **Process-detection TTL cache** (`process-manager.js`) — `detectRunningProcess`/`detectProcessByPid` now cache results for `PROCESS_DETECT_TTL_MS` (1 s, new constant). Metrics polling and the crash detector hit the same PIDs/executables within one tick; the cache collapses those into a single `tasklist` call (~50% fewer spawns with several servers). Transient failures are deliberately **not** cached, and the cache is bounded by the existing 5-minute cleanup interval.
- **SteamCMD concurrency lock** (new `steamcmd-lock.js`, wired into `steamcmd.js`) — a global, non-reentrant mutex serializes every SteamCMD operation (`downloadWorkshopMod`, `validateSteamLogin`, `updateServerApp`, `updateWorkshopMod`) so two processes never share the staging dir / auth-token cache at once (previously a download + auto-update race could corrupt files). The retry wrapper re-acquires per attempt, so the lock is released during inter-retry backoff. `ensureSteamCMD` is intentionally left unlocked (called inside locked ops) to avoid reentrant deadlock.
- **Auto-updater journal tests** — exported the write-ahead-log helpers and covered the journal round-trip (write/overwrite/read/clear), corrupt-file tolerance, no-temp-residue, plus `formatCountdownMessage` pluralization and `getNotificationConfig` defaults/overrides/legacy-fallback.

Coverage ratchet raised to 13 / 5 / 7 / 14 (overall now 14.2% / 15.9% lines; `steamcmd-lock.js` 100%).

---

## 10. Request-validation layer + RCON/revocation polish  *(P1)*

- **Centralized request validator** (new `lib/request-validator.js`) — a dependency-free declarative validator + Express middleware. Schemas describe `type` (string/number/integer/boolean/array/object), `required`, `default` (value or fn), `min`/`max`, `minLength`/`maxLength`, `enum`, `pattern`, and `custom`. It coerces query-style strings to numbers/booleans, accumulates all errors, and returns a consistent envelope `{ error: 'Validation failed', details: [...] }`. Validated/coerced values are attached to `req.validated[source]` **without** mutating the original `req.body`, so existing handlers keep working. This replaces the ad-hoc per-route `if (!req.body.x) return 400` checks and is the foundation for a future OpenAPI spec.
- **Proof-of-concept rollout** — applied to `POST /api/servers/:id/message`, which previously had no validation (an absent `message` would broadcast the string "undefined" to all players). It now requires a 1–1024-char string. The rest of the 40+ route files can adopt the same one-line middleware incrementally.
- **RCON allowed-commands API** — *ground-truthed as already implemented*: `GET /api/servers/:id/rcon/commands` (auth-gated via `authForServer('server.rcon')`) already returns the whitelist with descriptions. No change needed.
- **Token-revocation reason codes** — added a frozen `REVOCATION_REASONS` enum (`user.deleted`, `user.disabled`, `password.changed`, `logout`, `security.incident`, `manual`) to `token-revocation.js` so audit/forensics can group revocations by a stable set instead of ad-hoc strings.

---

## 11. Tests for security-critical validators  *(P1)*

Coverage for two previously-untested, security/reliability-critical modules (purely additive — no source changes):

- **`rcon-validator.js`** (the RCON command whitelist/blacklist that prevents command injection) — now ~72%: accepts every whitelisted command, blocks dangerous ones (`shutdown`, `#exec`, `quit`, …), rejects unknown commands, enforces per-command argument rules (`kick` slot must be numeric, `maxplayers` 1–100, `say` needs a body), and hardens input (empty/non-string/over-length/control-character/case-insensitive). Also covers `sanitizeCommand` and `getAllowedCommands`.
- **`port-checker.js`** (pre-start port-conflict detection) — now ~86%: managed-server conflict detection across game/query/rcon ports, current-server exclusion, ignoring stopped/crashed servers, and merging/deduping the system-level (PowerShell, mocked) layer.

Coverage ratchet raised to 14 / 6 / 9 / 16 (overall now 14.9% / 16.6% lines).

---

## 12. Request-validator rollout (batch 1)  *(P1)*

- **Error envelope refined** — `validate()` now returns `{ error: <joined human message>, details: [...] }` instead of a generic `'Validation failed'`, so `error` matches the codebase's existing `{ error: <message> }` convention (frontend-compatible) while `details` keeps the structured per-field list.
- **Applied to three more endpoints across three route files**, each a genuine defensive improvement, each verified to load and pass:
  - `POST /api/servers/:id/update` — `updateType` constrained to `['game','mod']`; `modId`/`modName` length-bounded (previously accepted any `updateType`).
  - `POST /api/priority-queue` — `steamId` required + length-bounded (replaces the inline `if (!steamId)` check).
  - (`POST /api/servers/:id/message` from §10.)
- The remaining ~37 body-taking endpoints can adopt the same one-line `validate({...})` middleware incrementally; each should be reviewed individually because a few accept polymorphic fields (e.g. timestamp-or-string) that need a loose schema. Rollout is deliberately staged rather than a risky big-bang.

---

## Test summary

New suites under `backend/tests/` (140 tests, all passing):

| File | Covers |
|---|---|
| `tests/xml-escape.test.js` | the shared escaping helper |
| `tests/parser-xml-escaping.test.js` | regression — every mission-file serializer escapes correctly (round-trips through a real parser) |
| `tests/credential-encryption.test.js` | key validation branches + encrypt/decrypt round-trip |
| `tests/backup-filename.test.js` | path-traversal guard |
| `tests/rcon-multipart.test.js` | multi-part RCON response re-assembly + CRC32 validation |
| `tests/backoff.test.js` | exponential-backoff schedule, clamp, cooldown reset, per-key state |
| `tests/crash-circuit-breaker.test.js` | auto-restart circuit breaker (rolling-hour window) |
| `tests/data-store.test.js` | atomic JSON persistence, coalescing, temp cleanup, symlink refusal |
| `tests/process-detect-cache.test.js` | process-detection TTL cache (spawn mocked) |
| `tests/steamcmd-lock.test.js` | SteamCMD serialization mutex |
| `tests/auto-updater-journal.test.js` | update write-ahead journal + countdown/notification config helpers |
| `tests/request-validator.test.js` | declarative request validation (types, coercion, bounds, enum, pattern, custom, middleware) |
| `tests/rcon-validator.test.js` | RCON command whitelist/blacklist/arg-rules/sanitization (security) |
| `tests/port-checker.test.js` | pre-start port-conflict detection (managed + system layers) |

**Pre-existing failures (not introduced here):** `test_api.test.js` has 3 failing tests caused by `server.js` starting `setInterval` timers at require-time (open-handle timeouts). These are unrelated to these changes and are documented as a P1 testability fix (the server should expose an injectable/disable-timers test mode).

---

## Files changed

```
backend/lib/xml-escape.js                 (new)
backend/lib/globals-xml-parser.js
backend/lib/types-xml-parser.js
backend/lib/events-xml-parser.js
backend/lib/limits-parser.js
backend/lib/cfgeventspawns-parser.js
backend/lib/economycore-parser.js
backend/lib/spawnabletypes-parser.js
backend/lib/backup-engine.js
backend/lib/credential-encryption.js
backend/lib/server-init.js
backend/.eslintrc.json
backend/jest.config.js
backend/tests/xml-escape.test.js          (new)
backend/tests/parser-xml-escaping.test.js (new)
backend/tests/credential-encryption.test.js (new)
backend/tests/backup-filename.test.js     (new)
```

## Not done (and why)

- **Multi-part RCON assembly, metrics persistence, request-validation layer, OpenAPI, config hot-reload, Linux/Docker** — all P1/P2; larger and/or riskier than an unattended overnight pass should attempt. See the [roadmap](README.md#prioritized-roadmap).
- **Full TypeScript / DI migration, CommandMap flattening** — explicitly rejected as regressions for a working commercial product (see "Where Citadel already leads").
- **Graceful shutdown, sidecar stale-file cleanup** — already implemented in the current code; the domain agents' recommendations to add them were ground-truthed and dropped.
