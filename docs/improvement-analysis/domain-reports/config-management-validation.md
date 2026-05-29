# Domain Report: Config Management & Validation

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

The reference (dayz-server-manager v3.10.0) uses a TypeScript-based architecture with several key components:

**Config Schema & Defaults**: Uses TypeScript classes (ServerCfg, Config) with reflect-metadata decorators for schema definition and field-level annotations (@config-required, @config-range). Config defaults are defined in class properties.

**Validation**: Implemented in config-validate.ts with dedicated validateConfig() that checks required fields using reflect-metadata, performs type-checking, validates numeric ranges, and specific validation for event cron expressions (cron-parser library).

**Parsing**: Uses comment-json library (src/util/config-parser.ts) for JSON-with-comments support. Also includes a dedicated ConfigParser class that converts DayZ's serverDZ.cfg format (Arma config format) to/from JSON via regex parsing and json2cfg().

**File Management**: ConfigFileHelper (src/config/config-file-helper.ts) handles:
  - Reading config from disk with error reporting
  - Merging defaults + file + validation
  - Writing validated configs back
  - Auto-generating default config with safe secrets (randomUUID for passwords)

**Hot Reload/Watching**: ConfigWatcher service (src/services/config-watcher.ts) uses chokidar to watch the config file, MD5 hashing to detect actual changes, and callbacks for config-changed events. Debounce mechanism to avoid race conditions on file writes.

**Template/Schema Output**: generateConfigTemplate() in config-template.ts creates formatted JSON with comments/spacers, preserving inline documentation. Uses propertyOrder array to control output order.

**Testing**: Comprehensive test coverage for parsing, validation, and config-watcher with mocked chokidar.

## How Citadel does it

Citadel takes a more pragmatic, hybrid Node.js approach designed for a larger commercial product:

**Config Schema & Defaults** (config-schema.js): Plain JavaScript object defining nested sections (server, auth, steam, directories, logging, backups, polling, bans). Each field has type, default, validation constraints (min/max/enum/pattern), sensitivity markers, and envKey for env var overrides. No decorators or reflect-metadata.

**Validation** (config-schema.js validateConfig()): Validates config structure with non-throwing approach (mutates in-place, returns warnings). Checks types, numeric ranges, enum values, regex patterns. Gentle coercion (strings → numbers/booleans) rather than strict type checks.

**Three-Layer Config Loading** (config.js):
  1. Schema defaults
  2. citadel.config.json (deep merge, only known keys)
  3. Environment variables (always win, with intelligent coercion)

**Secrets Management** (credential-encryption.js): AES-256-GCM encryption for credentials at rest. Derives key from CREDENTIAL_ENCRYPTION_KEY (or JWT_SECRET in dev) using PBKDF2. Stores encrypted values with ENC: prefix in .env. Supports legacy plaintext for migration.

**JWT Secret Persistence**: Auto-generates and persists JWT_SECRET to data/.jwt-secret with restrictive permissions (0o600) if not in env.

**DayZ serverDZ.cfg Handling** (dayz-config.js):
  - Whitelist-based key validation (ALLOWED_CONFIG_KEYS set)
  - Simple regex-based parsing (not full Arma config format support)
  - String sanitization to prevent grammar injection
  - Regex-based in-place updates or append for new keys
  - Backup mechanism (appends .bak file before write)

**Mod Config Schemas** (mod-config-schema.js): Manifest-based registry. Each mod directory has manifest.json + optional schema.json files. Lazy-loads and caches schemas. Supports both raw JSON editing and schema-based form editing.

**No Hot Reload Yet**: Config changes require API write (no file watcher). Has _applyUpdate() method for hot-reloadable sections (logging, backups, polling) with env-override locking.

**Backward Compatibility**: Preserves legacy CONFIG object shape for existing code. Adds _structured, _envOverrides, _configFileLoaded metadata for new features.

## Detailed analysis

# Config Management & Validation: Cross-Reference Comparison

## Executive Summary

Citadel and the reference (dayz-server-manager v3.10.0) take different architectural approaches to config management, each with strengths:

**Reference strengths**: Full Arma config format parsing, TypeScript type safety, structured config watcher with hot reload, inline documentation via comments, event scheduling with cron validation.

**Citadel strengths**: AES-256-GCM credential encryption at rest, three-layer config loading with environment variable override system, modular mod-config schema registry, careful attention to secrets management (separate CREDENTIAL_ENCRYPTION_KEY, auto-persist JWT_SECRET with file permissions).

Both codebases demonstrate professional config design, but serve different use cases. Citadel is a larger commercial product supporting multi-tenant deployments and external integrations, while the reference is a focused single-server manager.

---

## Detailed Findings

### 1. Schema Definition & Defaults

**Reference Approach** (`src/config/config.ts`, lines 1–1174):
- Uses TypeScript classes (`ServerCfg`, `Config`) as the schema
- Field-level inline documentation via JSDoc comments
- Decorator-based metadata: `@Reflect.metadata('config-required', true)` marks required fields
- Numeric constraints via `@Reflect.metadata('config-range', [min, max])`
- Defaults set as class property initializers
- Example: `public maxPlayers: number = 60` with `@Reflect.metadata('config-required', true)`

**Citadel Approach** (`backend/lib/config-schema.js`, lines 10–53):
- Plain JavaScript nested objects: `CONFIG_SCHEMA = { server: { port: { ... } }, ... }`
- Each field defined with `{ type, default, min, max, enum, pattern, sensitive, envKey, description }`
- No decorators or metadata; all constraints in one place
- More explicit and editable by non-TypeScript developers
- Example: `port: { type: 'number', default: 3001, min: 1, max: 65535, envKey: 'PORT', description: '...' }`

**Assessment**: Citadel's approach is more extensible for dynamic schema generation (e.g., for API forms) and easier to modify without recompilation. Reference's decorator approach is more type-safe at compile time. Neither is objectively better; trade-off between type safety (ref) vs. runtime flexibility (citadel).

---

### 2. Validation Architecture

**Reference** (`src/config/config-validate.ts`, lines 26–104):
- Throws on parse errors, returns error array from validation
- Validates required fields using reflect-metadata introspection (lines 32–38)
- Type checking with simple `typeof` comparison (lines 52–61)
- Specific validation for event cron expressions (lines 78–101):
  - Uses `cron-parser` library to parse and validate cron syntax
  - Checks `hasNext()` to ensure cron will actually trigger
  - Domain-specific validation (event types enum, required name/type/cron fields)

**Citadel** (`backend/lib/config-schema.js`, lines 80–155):
- Non-throwing approach: mutates config in place, returns warnings array (line 80)
- Type checking with coercion: `Number(value)`, `String(value)`, `Boolean(value)` (lines 101–140)
- Supports enum validation (lines 123–126)
- Regex pattern validation (lines 128–131)
- Array parsing from comma-separated strings (lines 142–150)

**Assessment**: Reference's approach is stricter (fail-fast on parse errors). Citadel's approach is gentler (coerce + warn), which is appropriate for a system that must survive config errors without crashing. Citadel's pattern validation is a nice feature for URLs and other format-constrained fields. Reference's cron validation is more thorough but specific to event scheduling (Citadel doesn't have that feature yet).

---

### 3. File I/O & Merging

**Reference** (`src/config/config-file-helper.ts`, lines 52–78):
- Reads file with `getConfigFileContent()` (lines 37–42)
- Parses with `comment-json.assign()` to merge file over defaults (line 60–62)
- Validates and logs all errors (lines 64–68)
- Returns `null` on any error (line 76)

**Citadel** (`backend/lib/config.js`, lines 21–49):
- Three-layer merge:
  1. Schema defaults via `getDefaults()` (line 22)
  2. File via deep merge (lines 34–44)
  3. Environment variables via `getEnvMap()` (lines 51–72)
- Intelligent env coercion (lines 59–66): detects type from schema and converts string → number/boolean/array
- Tracks origin of each value (`configFileValues`, `envOverrides`) for later locking/audit (lines 26, 36, 70)

**Assessment**: Citadel's three-layer approach is essential for containerized/cloud deployments where configs come from multiple sources. Reference is single-source (file only). Citadel's origin tracking enables the "env-override lock" feature (env vars prevent API updates), which reference doesn't have.

---

### 4. Hot Reload / File Watching

**Reference** (`src/services/config-watcher.ts`):
- Watches config file with chokidar (lines 46–59)
- Debounces with 1-second delay (line 21) to avoid RBW (read-before-write) errors
- Detects changes via MD5 hash comparison (lines 42–44, 73–75)
- Returns same config if no actual change (lines 77–80)
- Calls callback only on real changes

**Citadel**:
- **No file watcher currently implemented**
- Config is loaded at startup only (config.js lines 21–49)
- API-based updates via `CONFIG._applyUpdate()` (lines 221–261) are the only way to change config at runtime
- Missing capability for external edits (e.g., ops editing citadel.config.json manually) to trigger reload

**Assessment**: This is Citadel's biggest gap. Reference's watcher + debounce is a proven pattern that would be straightforward to add. Enables operators to edit citadel.config.json by hand and have changes picked up automatically (e.g., in CI/CD pipelines or manual troubleshooting). Should be medium priority.

---

### 5. Secret & Credential Handling

**Reference** (`src/config/config.ts`, lines 651, 858–864):
- Stores passwords as plaintext in server-manager.json: `public rconPassword: string = 'rcon'` (line 651)
- Auto-generates defaults with `randomUUID()` only (line 110 in config-file-helper.ts)
- No encryption at rest; security relies entirely on file permissions

**Citadel** (`backend/lib/credential-encryption.js`):
- **AES-256-GCM encryption** with PBKDF2 key derivation (lines 77–86)
- Fixed application-specific salt (line 23) ensures domain separation
- 100,000 PBKDF2 iterations (line 25) provides resistance to brute-force
- Supports "ENC:" prefix in .env for encrypted values (line 153, 165)
- Also auto-generates and persists JWT_SECRET to `data/.jwt-secret` with 0o600 permissions (lines 74–112 in config.js)
- Separate CREDENTIAL_ENCRYPTION_KEY from JWT_SECRET (production requirement, line 56)

**Assessment**: Citadel's credential handling is significantly more secure. Reference stores plaintext passwords in a JSON file that could be exfiltrated if the server is compromised. Citadel's encryption is defense-in-depth. However, Citadel doesn't validate that CREDENTIAL_ENCRYPTION_KEY is actually a 256-bit hex string—a weakness that should be fixed.

---

### 6. Parsing DayZ serverDZ.cfg Format

**Reference** (`src/util/config-parser.ts`):
- Full Arma config format parser using regex state machine
- Handles classes: `class Missions { class DayZ { template = "..."; }; };` (lines 38–74)
- Handles arrays: `someArray[] = { "item1", "item2" };` (lines 97–121)
- Handles primitives: strings, numbers, booleans (lines 77–95)
- Bidirectional: `cfg2json()` parses file, `json2cfg()` writes back with proper syntax

**Citadel** (`backend/lib/dayz-config.js`, lines 84–109):
- Simple regex-based key=value parser: `^([a-zA-Z0-9]+)\s*=\s*(.+?)\s*;` (line 93)
- Strips comments and quotes
- Works for flat config (maxPlayers = 60; hostname = "..";)
- **Does not handle nested classes** (e.g., Missions block)
- Applies in-place regex updates or appends new keys (lines 127–146)

**Assessment**: Citadel's parser is sufficient for common configs but will silently miss nested structures. If a mod ever requires `class Missions { ... }` syntax, the parser fails silently. Reference's full Arma parser is more robust. Porting it would be medium effort but prevent future bugs. However, current DayZ server configs seem to use mostly flat key=value syntax, so risk is low for now.

---

### 7. Mod Config Schemas

**Reference**: No built-in support for per-mod schemas.

**Citadel** (`backend/lib/mod-config-schema.js`):
- Manifest-based registry: each mod has `backend/schemas/<schemaId>/manifest.json`
- Manifest lists config files and optional `.schema.json` files for JSON Schema validation
- Caching system for manifests and schemas (lines 19–21)
- Supports both schema-based (form) editing and raw JSON fallback
- `listAvailableSchemas()` discovers all registered mods (lines 77–92)
- `getModSchemaBundle()` returns manifest + all associated schemas (lines 100–113)

**Assessment**: Citadel's mod registry is a strength; it's missing from reference. This enables Citadel to support community mods with form-based config editors without hardcoding each one. Well-designed extensibility point.

---

### 8. Environment Variable Overrides

**Reference**: No environment variable support.

**Citadel** (`backend/lib/config.js`, lines 51–72):
- `getEnvMap()` builds a mapping of envKey → { section, key, def } (config-schema.js lines 186–196)
- Each schema field can declare `envKey: 'SOME_VAR'` (e.g., line 12 in config-schema.js)
- Reads env vars and coerces to correct type (number, boolean, array)
- Env vars always win over file config and schema defaults (comment on line 51)
- Env-override lock: `CONFIG._applyUpdate()` skips fields that are env-locked (lines 239–241)

**Assessment**: Essential for containerized deployments (Docker, Kubernetes) where config comes from env vars rather than files. Reference doesn't support this and would require modification for cloud-native use. Citadel's override lock prevents accidental API overwrites of env-set values.

---

### 9. Config Template Generation & Documentation

**Reference** (`src/config/config-template.ts`):
- `generateConfigTemplate()` creates formatted JSON with:
  - Section spacers for readability (lines 6–18)
  - Field descriptions as JSDoc comments (line 38)
  - Proper indentation and formatting (lines 44–47)
  - Property ordering (lines 22–28)
- Uses `propertyOrder` array to control output
- Output is valid JSON with inline comments preserved

**Citadel**:
- No template generation currently
- Plain JSON output from `CONFIG._applyUpdate()` -> `_writeConfigFile()` (lines 281–306)
- No inline documentation in generated config

**Assessment**: Reference's template approach makes hand-editing easier. Citadel should integrate comment-json library to:
  1. Preserve user comments when writing config
  2. Generate templates with field descriptions

Low effort, high UX improvement.

---

### 10. Testing & Quality

**Reference**: Comprehensive test coverage
- `test/config/config-validate.test.ts`: Tests validation logic with event types, cron validation, type coercion
- `test/config/config-file-helper.test.ts`: Tests file I/O and merging
- `test/services/config-watcher.test.ts`: Tests file watching with chokidar mocks
- `test/util/config-parser.test.ts`: Tests Arma config parsing

**Citadel**:
- Config schema tests in `backend/__tests__` (not shown in read but present in codebase)
- No file-watching tests (because no watcher yet)
- Routes have basic 404 and error handling

**Assessment**: Reference's test coverage is more comprehensive. Citadel should add tests for the three-layer merge logic, env override locking, and credential encryption.

---

## Security Considerations

**Reference vulnerabilities**:
- Plaintext password storage in server-manager.json
- No encryption of sensitive fields
- Would require file-system level protection (careful umask, ACLs)

**Citadel strengths**:
- AES-256-GCM encryption for credentials
- PBKDF2 key derivation with 100k iterations
- Separation of JWT_SECRET and CREDENTIAL_ENCRYPTION_KEY
- Auto-persisted JWT_SECRET with 0o600 file permissions

**Citadel weaknesses**:
- No validation that CREDENTIAL_ENCRYPTION_KEY is actually 256 bits
- Fallback to JWT_SECRET in dev (acceptable for dev, but could be clearer)

---

## Recommendations Summary

1. **[CRITICAL]** Add validation for CREDENTIAL_ENCRYPTION_KEY strength at startup (trivial effort)
2. **[HIGH]** Implement config file watcher with chokidar + MD5 change detection (small effort)
3. **[MEDIUM]** Enhance serverDZ.cfg parser to handle nested classes (medium effort, low risk)
4. **[MEDIUM]** Add audit logging for env-override blocks (trivial effort)
5. **[MEDIUM]** Expand ALLOWED_CONFIG_KEYS with type/range metadata (small effort)
6. **[LOW]** Add comment preservation and schema docs to citadel.config.json (small effort)
7. **[LOW]** Consider TypeScript migration for config layers (large, long-term)

---

## Conclusion

Citadel's config system is more mature in areas that matter for production (credential encryption, multi-source merging, mod extensibility) but lacks some conveniences from the reference (hot reload, comment preservation, full Arma format support). The recommended improvements focus on closing the gaps without major rewrites, yielding better security, observability, and operator experience.

## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| No Config File Watcher/Hot Reload | ref_has_current_lacks | medium | small | Reference has chokidar-based ConfigWatcher with MD5 change detection and debounce. Citadel config.js loads at startup only; changes via API write or .env restart required. Missing capability for external config edits to be detected and reloaded. |
| Limited DayZ serverDZ.cfg Parsing | ref_has_current_lacks | low | medium | Reference has full ConfigParser supporting Arma config class syntax (nested classes, arrays, comments). Citadel uses simple regex parsing that handles key=value pairs but not nested class structures (e.g., 'class Missions { class DayZ { template = ...; }}'). Works for current use but brittle if config format becomes more complex. |
| No Reflect-Metadata Schema Introspection | ref_has_current_lacks | low | trivial | Reference uses TypeScript decorators (@Reflect.metadata) for field-level constraints. Citadel uses plain JS objects. Means Citadel cannot programmatically discover field-level requirements at runtime without reimplementing schema lookup logic. |
| Citadel Has Production Credential Encryption, Reference Does Not | current_has_ref_lacks | high | large | Reference stores passwords (admin, steam, rcon) as plaintext in server-manager.json. Citadel implements AES-256-GCM with key derivation (PBKDF2). Much stronger security posture. Reference only has randomUUID generation for defaults, not encryption at rest. |
| Citadel Has Environment Variable Override System | current_has_ref_lacks | high | large | Reference only supports JSON file. Citadel has intelligent env var parsing with type coercion, section/key mapping, and env-override locking (prevents API from overriding env-set values). Essential for containerized deployments. |
| Citadel Has Mod Config Schema Registry | current_has_ref_lacks | medium | large | Manifest-based system for defining schemas per mod (backend/schemas/<schemaId>/). Supports both raw JSON editing and form-based editing via JSON Schema. Reference has no modular schema extension point. |
| Reference Has Comment-JSON Support & Structured Comments | ref_has_current_lacks | low | small | Reference uses comment-json library to preserve comments in server-manager.json. generateConfigTemplate() also embeds JSDoc-style comments for each field. Citadel uses plain JSON (no inline docs). Makes hand-editing harder. |
| Citadel Has Safe-Default Auto-Generation | both_have_current_weaker | low | trivial | Citadel auto-generates JWT_SECRET, admin passwords with randomUUID. Reference also does this (createDefaultConfig). Both are good. |
| Reference Has Comprehensive Event Validation | ref_has_current_lacks | low | medium | Validates event cron expressions with cron-parser, checks event types against enum, ensures all required fields. Citadel does not have event scheduling (different feature scope). |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Add Config File Watcher (chokidar + MD5) | `backend/lib/config.js, backend/lib/config-watcher.js (new)` | medium | small | low | Implement a ConfigWatcher module similar to reference's ConfigWatcher service. Watch citadel.config.json with chokidar, compute MD5 hash of loaded config, and only trigger callback if hash differs. Include debounce (1000ms) to avoid race conditions during file writes. Expose CONFIG._watchStart(callback) and CONFIG._watchStop(). |
| Enhance serverDZ.cfg Parser to Support Nested Classes | `backend/lib/dayz-config.js` | low | medium | medium | Upgrade readServerConfig() to handle Arma config format (class Missions { class DayZ { template = ... }; };). Either port reference's ConfigParser (regex-based state machine) or use a lightweight Arma cfg parser. Current regex-only approach misses deeply nested structures and will fail on complex configs. |
| Add Comment Preservation to citadel.config.json | `backend/lib/config.js, backend/lib/config-schema.js` | low | small | low | Integrate comment-json library (already used in reference). Preserve user comments when writing config. Generate template with JSDoc-style field descriptions. Makes hand-editing citadel.config.json much friendlier. |
| Validate CREDENTIAL_ENCRYPTION_KEY Strength at Startup | `backend/lib/credential-encryption.js` | high | trivial | low | Add validation that CREDENTIAL_ENCRYPTION_KEY is a 64-char hex string (256 bits). If not, warn or fail loud. Current code doesn't validate input length or format. Weak keys defeat AES-256-GCM. |
| Add Schema-Level Sensitive Field Audit Logging | `backend/lib/config.js, backend/routes/system.routes.js` | medium | trivial | low | When CONFIG._applyUpdate() or config API endpoint writes sensitive fields, log an audit entry even if write is rejected (env override). Currently silent when env-locked. Should be 'config.update.blocked' with reason 'env override'. |
| Normalize DayZ Config Keys to Preserve Case | `backend/lib/dayz-config.js` | medium | small | low | serverDZ.cfg keys are case-sensitive (maxPlayers vs maxplayers). Current regex in readServerConfig() uses case-insensitive match [a-zA-Z0-9]+ but doesn't normalize output. Should preserve exact key case when updating. Add a key-case cache or normalize all keys to camelCase consistently. |
| Implement Config Validation for Enum Values | `backend/lib/dayz-config.js` | medium | small | low | Some serverDZ.cfg keys have restricted values (e.g., verifySignatures: 0\|1\|2, lightingConfig: 0\|1). ALLOWED_CONFIG_KEYS set doesn't track constraints. sanitizeUpdates() should check enum constraints before write. Reference's validateConfig() does this for cron event types. |
| Add Numeric Range Validation to serverDZ.cfg Updates | `backend/lib/dayz-config.js` | medium | small | low | Keys like maxPlayers (1–500), maxPing (0–10000), serverTimeAcceleration (0–24) have valid ranges. Current sanitizeUpdates() only checks for NaN. Should add optional range metadata to ALLOWED_CONFIG_KEYS (e.g., { name: 'maxPlayers', type: 'number', min: 1, max: 500 }) and validate before write. |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Implement Config File Watcher for Hot Reload | high | small | low | Reference demonstrates that watching config files with MD5 change detection is a proven pattern. Citadel currently requires API writes or restarts to pick up config changes, making it harder for ops to edit citadel.config.json manually. A small, low-risk addition of chokidar + debounce would enable live config reloads without restart. Improves developer and operator experience. |
| Enhance serverDZ.cfg Parser for Nested Classes | medium | medium | low | Current regex-based parser works for simple key=value pairs but fails on Arma config's nested class structures. If a mod introduces a complex serverDZ.cfg with class hierarchies (e.g., Missions, Difficulty), the parser will silently miss those sections. Porting reference's ConfigParser (which handles full Arma syntax) is low-effort and prevents future bugs. Medium priority because risk is low-probability (most configs are flat) but impact is high (silent data loss). |
| Validate CREDENTIAL_ENCRYPTION_KEY at Startup | critical | trivial | low | Citadel's credential encryption is a security win over reference, but only if the key is actually strong. Current code never validates that CREDENTIAL_ENCRYPTION_KEY is a 64-hex-char 256-bit string. A typo or short key defeats AES-256-GCM. Add a startup check that validates format and length, fails hard in production. Trivial effort, high security impact. |
| Add Comment Preservation & Schema Docs to citadel.config.json | low | small | low | Reference's generateConfigTemplate() embeds field docs inline as comments, making hand-editing friendlier. Citadel's plain JSON is harder to understand. Integrate comment-json library to preserve user edits + generate templates with descriptions. Lower priority (UI nicety) but easy win. Helps ops understand what each field does. |
| Audit Log Config Overrides (Env-Locked Fields) | medium | trivial | low | CONFIG._applyUpdate() silently skips env-locked fields (e.g., if RCON_PASSWORD is set in .env, API cannot change it). Should log an audit entry with reason 'env override' when this happens, so admins know why a config change was rejected. Helps with debugging + compliance. Trivial effort. |
| Expand ALLOWED_CONFIG_KEYS with Type & Range Metadata | medium | small | low | Currently ALLOWED_CONFIG_KEYS is a flat set—no constraints. Should extend to include type (number/string/boolean), numeric ranges (min/max), and enum values. This mirrors reference's validate approach and prevents invalid values from being written to serverDZ.cfg. Improves robustness without breaking changes. |
| Consider TypeScript Migration for Config/Schema Layers | low | large | medium | Reference's TypeScript + reflect-metadata approach is more discoverable and type-safe than Citadel's plain JS objects. Given Citadel is a large product with many developers, a gradual migration of config.js, config-schema.js, dayz-config.js to TypeScript (with JSDoc types as interim step) would improve maintainability and catch schema errors at compile time. Larger effort, deferred as a long-term architectural improvement. |

