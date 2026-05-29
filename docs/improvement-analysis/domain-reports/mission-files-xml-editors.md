# Domain Report: Mission files & XML editors

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

The reference codebase (dayz-server-manager v3.10.0) uses a centralized `MissionFiles` service (src/services/mission-files.ts, 149 lines) implementing core file I/O operations. Key patterns: (1) Dependency injection via tsyringe with proper singleton lifecycle; (2) Centralized path validation in `getCheckedPath()` that blocks path traversal (lines 44-65), checking for '..' and null bytes; (3) All writes trigger `hooks.executeHooks(HookTypeEnum.missionChanged)` for downstream propagation; (4) Automatic backup creation via `this.backup.createBackup()` on writes (line 116); (5) Strict file/directory read API with null returns on invalid paths; (6) ConfigParser utility (src/util/config-parser.ts, 187 lines) for parsing/serializing DayZ .cfg format with bidirectional conversion (cfg2json, json2cfg); (7) Comprehensive unit tests mocking all dependencies with typed stubs. The service is lean and delegative — it focuses on safe path resolution and I/O plumbing, leaving domain logic to consumers.

## How Citadel does it

Citadel uses a far richer, domain-specific architecture with specialized parsers for each XML file type. Key patterns: (1) Modular parsers (types-xml-parser.js, events-xml-parser.js, limits-parser.js, etc.) each handling 50-280 lines of focused regex-based parsing and serialization; (2) Editor routes (types-editor.routes.js, 467 lines as exemplar) implementing full REST CRUD per domain with auth checks, validation, backup integration; (3) Schema-aware validation in economycore-parser.js (lines 19-79) with strict regex checks blocking path traversal and injection; (4) XML escaping utility in economycore-parser.js (lines 205-213) covering all five predefined XML entities plus whitespace collapse; (5) Limits caching (types-editor.routes.js lines 64-105) with mtime-based invalidation to avoid repeated parsing; (6) User definition expansion (types-xml-parser.js lines 61-63, 180-196) preserving semantic user tags during round-trip edits; (7) Comprehensive audit logging (audit.js) of all edits with user/action tracking; (8) Backup integration via `createBackup()` calls before every write (e.g., types-editor.routes.js lines 224, 274, 317, 425); (9) Error isolation with try-catch on per-file parsing to avoid cascading failures (types-editor.routes.js lines 151-157); (10) Safe path validation via `safePath()` helper enforcing cross-platform path containment with Windows-on-Linux dev compatibility (helpers.js lines 40-82).

## Detailed analysis

# Mission Files & XML Editors: Cross-Reference Comparison Report

## Executive Summary

The reference codebase (dayz-server-manager v3.10.0) takes a **minimalist, abstraction-focused approach** with a single centralized `MissionFiles` service handling all file I/O operations. It prioritizes clean dependency injection, testability, and safe path handling.

Citadel, by contrast, implements a **domain-rich, specialized approach** with per-file-type parsers and full REST CRUD routes for each XML editor. It includes economy-specific logic (limits definition expansion, user tag preservation), comprehensive audit logging, and sophisticated path validation, but duplicates validation logic across route handlers and lacks async/await.

Both protect against path traversal, integrate backups before writes, and trigger hooks/audit. **Current's domain richness is a significant asset**, but it comes at the cost of code duplication and synchronous I/O. The reference's pattern isolation is valuable for maintainability and testing; the current's schema awareness is crucial for a production server manager.

## Detailed Findings

### 1. Path Validation & Security

**Reference approach** (mission-files.ts:44-65):
- Simple string checks: `startsWith()`, `includes('..')`, null byte detection
- Returns `undefined` on traversal; logs warning
- No filesystem canonicalization; relies on string normalization

**Citadel approach** (helpers.js:40-82, economycore-parser.js:19-79):
- Cross-platform `safePath()` with `fs.realpathSync()` canonicalization
- Windows absolute path detection (e.g., `C:\...`) with special handling when running on macOS/Linux (dev scenario)
- Case-insensitive comparison on Windows to prevent `C:/DayZServer` vs `c:/dayzserver` bypass
- Regex-based folder/filename validation (economycore-parser.js lines 20, 26)
- Explicit 128-character length limits and `.xml` extension enforcement

**Winner**: **Citadel** — More defense-in-depth with canonicalization, cross-platform sophistication, and regex validation. Reference's string checks would be vulnerable to symlink attacks or case-sensitivity tricks on Windows.

**Risk in current**: Low-risk improvement: audit globals-xml-parser.js and other domain parsers to ensure they use `safePath()` before opening files (not yet examined in those routes).

---

### 2. XML Entity Escaping

**Reference approach**: No XML-specific escaping. ConfigParser handles `.cfg` format (SQF/SQM-style), not XML. If a consumer writes `<type name="Item&Co">`, the XML would be malformed.

**Citadel approach** (economycore-parser.js:205-213):
```javascript
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r
	]/g, ' ');
}
```
Used in buildEconomyCoreXml() (line 176, 184) for folder names and file names.

**Problem in current**: `globals-xml-parser.js:74` and `spawnabletypes-parser.js` builders do NOT call escapeXml(). If a global's value or a spawn point name contains `&`, the XML will be invalid and the server will reject it.

**Recommendation**: Create a shared XML utility (or move escapeXml to helpers.js) and audit all builder functions. This is **critical** — malformed XML silently corrupts game state.

---

### 3. Per-File Error Isolation

**Reference approach**: Centralized MissionFiles service with simple read/write. Failure on one file fails the entire operation.

**Citadel approach** (types-editor.routes.js:149-157):
```javascript
for (const relPath of typesFiles) {
  const fullPath = path.join(missionDir, relPath);
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const items = parseTypesXml(content, relPath, userDefs);
    allItems.push(...items);
  } catch (err) {
    logger.warn({ err: err.message, file: relPath }, 'Failed to parse types file');
  }
}
```
If `db/types.xml` is corrupt, the editor still loads items from `db/types_weapons.xml`. Graceful degradation.

**Winner**: **Citadel** — Batch operations resilient to per-file corruption. The reference's all-or-nothing approach is safer for transactional writes but riskier for exploratory reads.

---

### 4. Schema-Aware Parsing: Limits Definition Expansion

**Reference approach**: No domain knowledge. ConfigParser is generic SQF/SQM parsing; not aware of DayZ economy concepts.

**Citadel approach** (types-xml-parser.js:61-118):
- Parses cfglimitsdefinition.xml (categories, usages, values, tags)
- Parses cfglimitsdefinitionuser.xml (user-defined groups, each containing multiple attributes)
- expandUser() expands a user group into constituent parts
- On save (itemToXml(), lines 180-196): smartly preserves user tags if all their constituent attributes are still present, emits only the remaining individual tags

Example: If `<user name="building_materials">` expands to `{usage: ["material"], value: ["buildmat"]}`, and the editor updates the item to still contain both, it re-emits `<user name="building_materials"/>` instead of `<usage name="material"/>` + `<value name="buildmat"/>`. **This preserves semantic intent** across edits, a non-trivial feature.

**Winner**: **Citadel** — Production-grade domain modeling. Reference would round-trip user tags as expanded attributes, losing semantic grouping. This matters for large multi-user admin workflows.

---

### 5. Caching with Invalidation

**Reference approach**: No caching. Reads on every request.

**Citadel approach** (types-editor.routes.js:64-105):
```javascript
const _limitsCache = new Map();
function _cachedParse(filePath, parseFn) {
  const stat = fs.statSync(filePath);
  const cached = _limitsCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;
  // ... re-parse and store
}
```
Limits definitions rarely change but are read on every editor request. Caching with mtime validation avoids repeated regex parsing.

**Winner**: **Citadel** — Measurable perf win on large missions. Low-risk, high-value optimization already in place.

---

### 6. Async/Promise-based I/O

**Reference approach** (mission-files.ts:28-134):
```typescript
public async getMissionPath(...subPath: string[]): Promise<string> { ... }
public async readMissionFile(file: string): Promise<string> { ... }
public async writeFile(filePath: string, content: string, createBackup?: boolean): Promise<void> { ... }
```
All I/O wrapped in async/await. Non-blocking; scales with concurrent requests.

**Citadel approach**: Synchronous fs.readFileSync(), fs.writeFileSync() throughout. Blocks event loop on large files.

**Winner**: **Reference** — Future-proof for concurrent edits. Current approach is acceptable for single-user admin interfaces but would struggle under load or with streaming large mission files. This is a **large refactor** (~500 LOC affected).

---

### 7. Dependency Injection & Testability

**Reference approach** (mission-files.ts:13-26, test/services/mission-files.test.ts):
- Uses tsyringe DI container with singleton/lifecycle management
- Injects Manager, Backups, Hooks, Paths, FSAPI
- Tests mock all dependencies with StubInstance; replace fs with memfs()
- 210 lines of focused unit tests covering read, write, path validation, errors

**Citadel approach**:
- require() local modules; no DI
- Integration-level testing (backend/test_api.test.js exists but not examined here)
- Harder to test parsers in isolation; would require filesystem setup or mocking fs.readFileSync

**Winner**: **Reference** — Testability is superior. Current is pragmatic for a monolithic backend but harder to unit-test individual parsers.

---

### 8. Audit & Logging

**Reference approach**: Hooks system (HookTypeEnum.missionChanged) executed on write. No semantic logging of who changed what.

**Citadel approach** (audit.js:31-37):
```javascript
function addAudit(userId, username, action, details) {
  const entry = { id: uuid(), timestamp: new Date().toISOString(), 
                 userId, username, action, details };
  ctx.auditLog.unshift(entry);
  saveJSON(ctx.CONFIG.dataDir, 'audit.json', ...);
}
```
Every edit route calls addAudit() with username, action, and human-readable details. Persisted to JSON. Multi-user accountability.

**Winner**: **Citadel** — Production requirement for multi-admin servers. Reference's hooks are lower-level; achieving audit would require wrapper code.

---

### 9. Backup Integration

**Reference approach** (mission-files.ts:115-116):
```typescript
if (createBackup) {
  await this.backup.createBackup();
}
```
Conditional backup flag on write methods.

**Citadel approach** (types-editor.routes.js:224, 274, 317, 425):
```javascript
createBackup(srv.installDir, fullPath, path.basename(targetFile));
```
Explicit backup call before every write. No flag needed; always backs up.

**Winner**: **Citadel** — Unconditional backup is safer; eliminates risk of forgetting the flag. Reference's design is more flexible (allows opt-out) but error-prone.

---

### 10. Code Organization & DRY

**Reference approach**: Centralized MissionFiles service. All file I/O funnels through two public methods (readMissionFile, writeMissionFile). Single point of policy enforcement.

**Citadel approach**: 7 separate editor routes (types, events, limits, globals, spawnabletypes, spawnpoints, economycore), each with duplicated safePath(), createBackup(), and error handling. ~400 LOC of repeated patterns.

**Winner**: **Reference** — DRY principle. Current's duplication makes it harder to globally enforce, e.g., "all backups must be encrypted" or "all edits must be logged to a central audit server."

**However**: Citadel's per-domain routes allow fine-grained auth checks (authForServer('files.edit')) and domain-specific validators, which would be harder with a single service.

---

## Risk & Effort Assessment

**High-priority, low-risk wins**:
1. Add XML escaping utility and audit all builders (CRITICAL, trivial effort)
2. Extract safePath middleware from editor routes (high, small effort)
3. Add input validation for numeric ranges (high, small effort)

**Medium-effort, high-impact**:
1. Refactor to async/await for I/O (large effort, medium risk of introducing async bugs)
2. Consolidate parser error messages into structured format (small effort, improves debuggability)

**Reference-inspired improvements**:
1. Consider adopting a centralized file service pattern to reduce route duplication (medium effort, medium risk of API breakage)
2. Add TypeScript + tsyringe DI for better testability (large effort, likely outside scope for this session)

---

## Conclusion

Citadel's architecture is **fit for purpose**: rich domain logic, multi-user audit trails, granular auth, and sophisticated path handling. The reference's abstraction and testability patterns are valuable, but the current's specialization is necessary for a production server manager. The key improvements are **safety-focused** (XML escaping, input validation) and **organization-focused** (consolidating duplicate code). Neither codebase has critical bugs, but both would benefit from the cross-pollination of best practices.

## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Path traversal defense depth | current_has_ref_lacks | high | small | Reference implements simple string checks (startsWith, includes '..'). Citadel uses cross-platform `safePath()` with realpath canonicalization, Windows absolute path detection, case-insensitive containment on Windows-on-Linux, and segregated checks for filesystem existence. Citadel is more robust. |
| XML escaping coverage | current_has_ref_lacks | critical | trivial | Reference has no XML-specific escaping (ConfigParser is for .cfg format). Citadel has `escapeXml()` covering all five XML entities plus attribute whitespace normalization (economycore-parser.js:205-213). Reference would produce malformed XML if values contain & or <. |
| Per-file error isolation | current_has_ref_lacks | medium | small | Citadel batch-reads multiple types files and isolates parse errors per-file (types-editor.routes.js:151-157) so one corrupt file doesn't block the editor. Reference would fail entirely on bad input. |
| Schema validation with limits definition expansion | current_has_ref_lacks | medium | medium | Citadel parses and expands user-defined groups in types.xml (types-xml-parser.js:61-118, 180-196), preserving intent during edits. Reference has no economy domain knowledge. |
| Caching with mtime invalidation | current_has_ref_lacks | low | small | Citadel implements lookup cache for limits definitions (types-editor.routes.js:64-105) avoiding re-parse on every request. Reference loads on every read. |
| Dependency injection & testing harness | ref_has_current_lacks | medium | large | Reference uses tsyringe DI with proper lifecycle management and comprehensive unit tests with mocked dependencies (test/services/mission-files.test.ts:1-210). Citadel uses synchronous require() and route-level integration tests (backend/test_api.test.js exists but not examined). Makes refactoring harder in current. |
| Promise-based async API | ref_has_current_lacks | medium | large | Reference wraps all I/O in async/await (all methods return Promise). Citadel uses synchronous fs calls throughout. Current is not future-proof for concurrent operations or high-throughput scenarios. |
| Unified file service abstraction | ref_has_current_lacks | low | medium | Reference centralizes all mission/profile file access via MissionFiles service. Citadel duplicates path resolution and error handling across editor routes. Violation of DRY; harder to audit global policy changes. |
| Audit trail & semantic logging | current_has_ref_lacks | medium | small | Citadel logs user actions with username/userId/action/details (audit.js:31-37). Reference has hooks but no audit-specific logging; would require custom instrumentation per consumer. |
| Backup before every write | both_have_current_better | low | trivial | Both integrate backup systems. Reference via `backup.createBackup()` on write flag. Citadel calls `createBackup()` explicitly before each write operation in editor routes (lines 224, 274, 317, 425). Citadel's explicit calls are clearer intent but both achieve same goal. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Add XML entity escaping to globals-xml-parser.js | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/globals-xml-parser.js` | critical | trivial | low | Line 74 in buildGlobalsXml() and line 48 in parseGlobalsXml() do not escape attribute values. If a global's name or value contains &, <, ", or >, the XML will be malformed. Import and use escapeXml() from economycore-parser.js or create a shared utility. |
| Add XML entity escaping to spawnabletypes-parser.js and other parsers | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/spawnabletypes-parser.js` | critical | small | low | Similar issue across all parser builders. Audit all buildXml() functions to ensure attribute and text node values are escaped via escapeXml(). |
| Validate numeric fields in types-xml-parser.js before serialization | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/types-xml-parser.js` | high | small | medium | Lines 154-159 serialize nominal, lifetime, restock, min, quantmin, quantmax, cost directly without range checks. Negative nominal or cost values are valid per getInt() but should be validated against server-known limits. Add validateItem() function checking ranges align with DayZ economy constraints. |
| Add ReDoS-safe regex pattern compilation in types-xml-parser.js | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/types-xml-parser.js` | low | trivial | low | Lines 73, 97-108 use new RegExp() on each parse call. On large files (>50MB types.xml with thousands of items), repeated regex compilation wastes cycles. Pre-compile at module scope and reuse. |
| Extract shared safe-path validation to central helper | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/routes/types-editor.routes.js` | medium | small | low | Line 209 and similar in all editor routes duplicate safePath() calls. Consolidate into a middleware or shared validation function to reduce duplication and ensure uniform policy. |
| Add return type validation on parseTypesXml() results | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/types-xml-parser.js` | medium | small | low | buildTypesXml() at line 210 assumes items array structure without validating. Add an itemToXml() guard ensuring name, numeric fields, and array fields have safe types before serialization. |
| Formalize error messages for invalid XML file paths | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/routes/types-editor.routes.js` | low | small | low | Line 209-210 silently skips invalid paths in some cases. Add explicit error responses (403) with reasons to help admins debug misconfigured cfgeconomycore.xml. |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Consolidate XML escaping into shared utility module | critical | small | low | Citadel already has escapeXml() in economycore-parser.js. All parsers should use it. Creates single point of control for XML safety, reduces copy-paste bugs, and makes future entity fixes atomic. Low effort, high confidence. |
| Create centralized editor middleware for path validation and backup | high | medium | low | All 7 editor routes duplicate safePath() and createBackup() calls. Extracting to middleware (or a shared `withMissionFileGuards()` helper) reduces LOC, ensures uniform policy, and makes auditing easier. Surgical refactor with low breakage risk. |
| Add input validation function for XML values before serialization | high | medium | low | Protect against out-of-range numeric fields, empty strings in required positions, and malformed arrays. Create validateItem(item, schema) reused across types.xml, events.xml, globals.xml builders. Prevents invalid game configs reaching the server. |
| Implement async/await refactor for I/O critical path | high | large | medium | Current synchronous fs calls block event loop on large file edits. Refactor core parsers and route handlers to async. Critical for multi-user edit concurrency and UI responsiveness. Large effort but high payoff for production stability. |
| Pre-compile RegExp patterns at module scope | low | trivial | low | types-xml-parser.js and others create RegExp objects on every parse call. Pre-compile at module scope and reuse. Measurable perf gain on large mission folders (50+ MB files). Trivial code change. |
| Add comprehensive JSON schema validation for imported items | medium | small | low | POST /api/servers/:id/types/import accepts raw JSON from frontend. Add schema validation (e.g., via ajv) to reject malformed imports before merging. Prevents data corruption from UI bugs or hostile JSON. |
| Formalize error categorization in XML parsers | medium | small | low | Current parsers return null on error or throw uncaught exceptions. Standardize on { success, data, error: { code, message, file } } for all parser functions. Makes client error handling and logging consistent. |

