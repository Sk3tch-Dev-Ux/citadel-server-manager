# Domain Report: Architecture, Code Quality & Testing

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

The reference (DZSM 3.10.0) is a TypeScript application using enterprise patterns: (1) **Dependency Injection via tsyringe** — all services are decorated with @injectable/@singleton, registered in a central container, resolved with container.resolve() (manager-controller.ts lines 7-114); (2) **Event-driven architecture** — EventBus (event-bus.ts) using eventemitter2 with strongly-typed emit/on overloads for type safety; (3) **Service composition** — ManagerController bootstraps ~15 singleton services (Monitor, Events, LogReader, Hooks, MissionFiles, SystemReporter, DiscordBot, REST, etc.); (4) **Comprehensive testing** — 35 test files using Mocha + Chai + Sinon, with @types/sinon-chai for assertions, ts-mock-imports for mocking, NYC coverage enforcement (85% lines, 100% functions); (5) **Strong linting** — .eslintrc with TypeScript plugins, explicit return types, member accessibility, naming conventions, floating promises detection (@typescript-eslint rules); (6) **Build pipeline** — tsc compilation, sourceMap enabled, emitDecoratorMetadata for tsyringe reflection. Modules are well-separated: services/, control/, config/, interface/, types/, util/.

## How Citadel does it

Citadel (backend, Node.js/JavaScript ~4979 lines of code) uses manual dependency management: (1) **Singleton context pattern** — context.js is a bare CommonJS module exporting a flat object; server.js directly assigns services and state into ctx (ctx.CONFIG, ctx.servers, ctx.users, ctx.io); (2) **Direct file requires** — every module does require('./lib/context') to access shared state; circular dependency patterns are possible; (3) **Data persistence** — data-store.js implements custom debounced async write queues with atomic temp-file+rename pattern, detailed symlink/permission handling; (4) **Minimal testing** — only 1 test file (test_api.test.js, 451 lines), covering utility functions (safePath, checkPasswordPolicy, sanitizeString, validateFields) and a few supertest API endpoints; jest with minimal coverage config (no thresholds); (5) **Looser linting** — .eslintrc.json uses eslint:recommended, warns on no-unused-vars, no type checking; (6) **Route-based structure** — routes/ folder with 30+ route files directly mutating ctx; lib/ folder for utilities (audit, auto-updater, backup-engine, ban-engine, config, etc.). No event bus abstraction.

## Detailed analysis

# Architecture, Code Quality & Testing: Citadel vs. DZSM Reference

## Executive Summary

Citadel (backend, ~4979 JS lines) and the reference DayZ Server Manager (DZSM, TypeScript, ~9868 lines) represent different architectural approaches to server management software. The reference prioritizes type safety, dependency injection, and comprehensive testing; Citadel prioritizes pragmatism, multi-server instance management, and sophisticated data persistence. This comparison focuses on high-leverage improvements for Citadel without recommending a costly rewrite.

**Key Findings:**
- Reference has 35 test files with 85% line / 100% function coverage enforcement; Citadel has 1 test file with no thresholds.
- Reference uses tsyringe DI and strongly-typed event buses; Citadel uses a global context singleton with direct requires.
- Citadel's data persistence layer (atomic writes, symlink checks, permission modes) exceeds the reference's simplicity.
- Citadel manages multiple server instances (harder problem); reference appears single-server.
- Both have process-level error handling, but Citadel's context object is a centralized bottleneck.

---

## Architecture Comparison

### Dependency Injection & Service Composition

**Reference (DZSM):**
The reference uses tsyringe, a TypeScript-first DI container. Key files:
- `src/index.ts` (lines 1-72): Imports 'reflect-metadata', resolves ManagerController from container.
- `src/control/manager-controller.ts` (lines 34-114): @singleton() @registry() decorator wires 15+ services (Monitor, Events, LogReader, Hooks, MissionFiles, SystemReporter, DiscordBot, REST, etc.) with explicit lifecycle control (Lifecycle.Singleton).
- `src/control/manager.ts` (lines 11-38): @singleton() @injectable() with constructor-injected LoggerFactory and Paths, no global state.
- `src/services/loggerfactory.ts`: Simple @singleton() factory creating Logger instances.

**Benefits:** Loose coupling, testable via mock containers, explicit service graph, no global state pollution.

**Citadel:**
Global context singleton pattern:
- `backend/lib/context.js` (28 lines): Bare exports object with servers, users, roles, webhooks, auditLog, watchList, priorityQueue, banDatabase, serverStates, activeInstalls, steamCredentials, etc.
- `backend/server.js` (lines 26-100): Directly assigns ctx.CONFIG, loads JSONs, mutates ctx.roles, ctx.webhooks, ctx.auditLog, etc.
- Every route and utility does `const ctx = require('./lib/context')` and directly reads/writes ctx properties.

**Coupling:** Tight global dependency, circular require patterns possible, no constructor injection, difficult to test in isolation.

**Verdict:** Reference's DI is superior for maintainability. Citadel's context works but doesn't scale; improvements can be incremental (add service facades, avoid bare ctx access in new code).

---

### Event-Driven Architecture

**Reference:**
- `src/control/event-bus.ts` (64 lines): EventBus wraps EventEmitter2 with strongly-typed emit/on overloads:
  ```typescript
  public emit(name: InternalEventTypes.DISCORD_MESSAGE, message: DiscordMessage): void;
  public emit(name: InternalEventTypes.MONITOR_STATE_CHANGE, newState: ServerState, previousState: ServerState): void;
  // ... multiple overloads for type safety
  ```
- Services subscribe with `.on(EventType, handler)` and publish with `.emit(EventType, data)`.
- Async request/response via `request(name, data)` → Promise<any>[].

**Citadel:**
No event bus abstraction. Routes and services directly call each other:
- Route calls `ctx.serverManager.startServer(id)` directly.
- Service mutates ctx.serverStates[id].
- No publish-subscribe pattern; everything is imperative.

**Verdict:** Reference's event bus reduces coupling and enables cross-cutting concerns (logging, metrics, replay). Citadel's direct coupling works but limits extensibility. Low priority to retrofit; new features should use events if possible.

---

### Data Persistence

**Citadel (Clear Win):**
`backend/lib/data-store.js` (203 lines) implements sophisticated persistence:
- **Debounced async writes:** Multiple saveJSON() calls within DEBOUNCE_MS (default 300ms) coalesce into one write, preventing I/O storms.
- **Atomic writes:** Write to `.tmp.RANDOM`, then atomic rename, preventing corruption on crash.
- **Symlink safety (Audit M16):** `fsp.lstat(filePath)` to detect symlinks before rename; refuses to write if link exists.
- **Permission modes (Audit M17):** Sensitive files (users.json, webhooks.json, audit.json) written with 0o600 (owner-readable only); public data as 0o644.
- **Graceful shutdown:** `flushAll()` synchronously forces pending writes before exit.
- **Crash recovery:** `cleanupStaleTempFiles()` removes stale .tmp.* files on startup.

**Reference:**
Uses SQLite via better-sqlite3 (package.json line 148). Simpler persistence model, trade-off: schema enforcement vs. flexibility.

**Verdict:** Citadel's persistence is more sophisticated and security-conscious. However, it lacks unit tests (see Testing section).

---

### Service Composition & Module Organization

**Reference:**
- `src/control/manager-controller.ts` (lines 34-114): Explicit service registry. Each service is registered with token, useClass/useValue, and lifecycle. Clear startup order, no implicit dependencies.
- `src/services/` folder: Each service (Monitor, Events, LogReader, etc.) is a separate file with clear responsibility.
- `src/interface/`: REST, Discord, Ingame REST interfaces separate from services.

**Citadel:**
- `backend/lib/`: 30+ utility modules (audit.js, auto-updater.js, ban-engine.js, backup-engine.js, bot-manager.js, citadel-bridge.js, config.js, etc.). No clear service boundaries.
- `backend/routes/`: 30+ route files directly require utilities and mutate ctx. Example: `routes/discord.routes.js` calls `citadelBridge.performAction()`, which updates ctx.serverStates, which is read by `routes/servers.routes.js`.
- No ManagerController equivalent to wire everything at startup.

**Verdict:** Reference's approach is cleaner. Citadel's sprawl is manageable but benefits from a thin service facade (see Recommendations).

---

## Test Coverage & Quality

### Test Suite Size

**Reference:**
- 35 test files (Mocha + Chai + Sinon)
- Files span: middleware, interface, types, util, services, control
- Example: `test/middleware/logger.test.ts` (32 lines) tests loggerMiddleware with mocked req/res/next
- NYC coverage enforcement: 85% lines, 100% functions (package.json lines 67-87)

**Citadel:**
- 1 test file: `backend/test_api.test.js` (451 lines)
- Covers: sanitizeString, checkPasswordPolicy, safePath, validateFields (utility functions)
- Also tests: 3 supertest endpoints (GET /api/auth/whoami, GET /api/config/meta-info, etc.)
- jest.config.js: collectCoverageFrom ['lib/**/*.js', 'routes/**/*.js'] but no coverage threshold

**Gap:** Reference has 35x more test files. Citadel's 30+ routes are untested.

### Linting & Code Quality

**Reference (.eslintrc, 115 lines):**
- @typescript-eslint/parser with project: tsconfig.json (enables type-aware rules)
- @typescript-eslint/indent: enforce 4-space indentation
- @typescript-eslint/explicit-function-return-type: error (required explicit returns)
- @typescript-eslint/explicit-member-accessibility: error (public/private required)
- @typescript-eslint/naming-convention: enforce camelCase, UPPER_CASE for consts, PascalCase for types
- **@typescript-eslint/no-floating-promises: error** (critical for async safety)
- **@typescript-eslint/no-misused-promises: error** with checksVoidReturn: false
- accessor-pairs, no-shadow, no-use-before-define: error

**Citadel (.eslintrc.json, 21 lines):**
- eslint:recommended base
- no-unused-vars: warn (with argsIgnorePattern, varsIgnorePattern)
- no-console: off
- semi: error
- **Missing:** no-floating-promises, no-misused-promises, explicit return types, accessibility enforcement

**Gap:** Citadel lacks async/promise safety rules. With 4979 JS lines, unawaited promises are a blind spot.

---

## Type Safety

**Reference:**
- Full TypeScript with @types/* for all dependencies
- Explicit return types on all methods (enforced by ESLint)
- Explicit member accessibility (public/private)
- Compile-time error checking

**Citadel:**
- Plain JavaScript, JSDoc comments for hints (e.g., `/** @type {ServerDefinition[]} */`)
- No compile-time checking; typos and type mismatches only caught at runtime

**Verdict:** Reference's TypeScript is superior, but retrofitting JSDoc to Citadel's core modules (context.js, config.js, data-store.js) would improve IDE hints and catch some errors without a rewrite.

---

## Data Model & Configuration

**Citadel (Strength):**
- `backend/lib/context.js`: Manages multiple servers (ctx.servers array), per-server states (ctx.serverStates), roles, users, webhooks, audit logs, watch lists, priority queues, ban databases.
- `backend/lib/config.js`: Loads config from environment & files, schema validation, defaults.
- Sophisticated multi-instance support (harder problem than reference's single-server assumption).

**Reference:**
- Config via JSON schema and file parsing
- Single-server focused

---

## Error Handling

**Both have process-level handlers:**

**Reference (src/index.ts, lines 28-55):**
```typescript
process.on('uncaughtException', (reason) => {
    console.error('Unhandled Exception:', reason);
    fs.writeFileSync(`manager-exception-dump-${new Date().valueOf()}.log`, ...);
    process.exit(1)
});
process.on('unhandledRejection', (reason) => { ... });
```

**Citadel:** Similar patterns in server.js (not shown in excerpt, but standard practice).

**Gap:** Neither has comprehensive error boundary middleware in Express/HTTP layer. Reference would benefit from error middleware; Citadel also lacks it.

---

## Recommendations (Prioritized)

### Tier 1 (Critical, <1 day each)

1. **Add ESLint promise safety rules** (`eslint-plugin-promise` or migrate to strict mode):
   - Detect floating promises
   - Citadel's 4979 JS lines + 30+ async routes = high risk.

2. **Set jest.config.js coverage thresholds** (collectCoverageFrom already set; add coverageThreshold):
   - Prevents test suite from regressing.

3. **Unit tests for data-store.js** (3-5 test cases):
   - Atomic write logic is critical; currently untested.

### Tier 2 (High Value, 1-2 weeks)

4. **Expand API test suite** (15-20 supertest tests for critical routes):
   - Focus on: server status, start/stop/restart, user auth, webhook dispatch.

5. **JSDoc type hints for ctx and core modules** (4-6 hours):
   - `/** @type {ServerDefinition[]} */`, `/** @returns {Promise<ServerInfo>} */`.
   - Non-breaking, improves IDE support.

6. **Service layer facade** (1-2 weeks, incremental):
   - Create `backend/lib/services/index.js` exporting `{ getServerState, startServer, ... }`.
   - Refactor 3-5 routes to use it.
   - Reduces ctx coupling over time.

### Tier 3 (Nice-to-Have, >2 weeks, Not Recommended)

7. **Full TypeScript migration:**
   - Not recommended for a 2+ year commercial product.
   - Cost: weeks of work, risk of breaking deployments.
   - Better ROI: incremental ESLint + test improvements.

---

## Conclusion

Citadel is a more complex product (multi-server, sophisticated persistence, 30+ routes). Reference is cleaner from an architectural standpoint (DI, event bus, 35 test files). The path forward is **not** a full rewrite, but targeted improvements:

1. Strengthen linting (promise safety, return types via JSDoc).
2. Expand test coverage (routes, data-store, config validation).
3. Gradually introduce service layer boundaries (non-breaking refactors).

These changes deliver significant ROI—catching async bugs, preventing regressions, improving testability—without the risk or cost of a TypeScript migration.


## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Dependency Injection & Inversion of Control | ref_has_current_lacks | high | large | Reference uses tsyringe with @injectable/@singleton decorators and container.resolve() for testability and loose coupling. Citadel uses a global context singleton with direct require() coupling throughout 4979 lines of code. |
| Event Bus Abstraction | ref_has_current_lacks | medium | large | Reference has EventBus (event-bus.ts) with strongly-typed overloaded emit/on methods and async request/response. Citadel has no event bus; services directly mutate ctx and call each other's functions. |
| Test Coverage & Test Suite Size | ref_has_current_lacks | high | large | Reference: 35 test files with Mocha+Chai, NYC enforcement of 85% lines / 100% functions. Citadel: 1 test file with 451 lines, jest with no coverage thresholds, missing tests for most routes and services. |
| Type Safety (TypeScript vs JavaScript) | ref_has_current_lacks | high | large | Reference is compiled TypeScript with explicit return types and member accessibility enforcement. Citadel is plain JavaScript with only JSDoc comments for type hints, no compile-time checking. |
| Linting & Code Quality Standards | ref_has_current_lacks | medium | small | Reference: 115-line .eslintrc enforcing TypeScript-specific rules (explicit return types, no-floating-promises, no-misused-promises, naming conventions). Citadel: minimal .eslintrc.json with eslint:recommended and loose rules, no async/promise enforcement. |
| Data Persistence with Atomic Writes | current_has_ref_lacks | high | large | Citadel's data-store.js has sophisticated debounced write queues with atomic temp-file+rename, symlink refusal, permission modes (0o600 for sensitive files), and crash-recovery cleanup. Reference uses SQLite via better-sqlite3, simpler persistence model. |
| Error Handling & Process Resilience | both_have_current_weaker | low | small | Citadel explicitly handles uncaughtException, unhandledRejection at process level with logging. Reference's index.ts has similar handlers. Both are comparable here, but Citadel's context.js forces explicit error boundaries. |
| Modular Service Composition | ref_has_current_lacks | high | medium | Reference: ManagerController explicitly wires 15+ services with clear dependencies. Citadel: sprawling 30+ route files that implicitly depend on ctx, no clear service boundaries or startup order guarantees. |
| Multi-Server Instance Complexity | current_has_ref_lacks | high | large | Citadel manages multiple DayZ server instances (ctx.servers array) with sophisticated state tracking (ctx.serverStates, activeInstalls). Reference appears single-server focused. Citadel handles a harder problem set. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Strengthen ESLint Config for Async/Promise Safety | `backend/.eslintrc.json` | high | trivial | low | Add @typescript-eslint/no-floating-promises and @typescript-eslint/no-misused-promises rules (as in reference). Currently no detection of unawaited promises or .then()/.catch() on voids. With 4979 lines of JS, this is a silent bug vector. |
| Add JSDoc Type Annotations to Context & Core Modules | `backend/lib/context.js, backend/lib/config.js, backend/lib/data-store.js` | medium | small | low | Retrofit comprehensive /** @type {} */ JSDoc to the main ctx object and exported functions. This enables IDE autocomplete and catches some type errors in plain JS. Example: ctx.servers becomes /** @type {ServerDefinition[]} */. |
| Establish Service Layer Boundaries | `backend/lib/, backend/routes/` | medium | medium | medium | Routes currently directly mutate ctx and call internal functions. Create a thin service facade (e.g., backend/lib/services/index.js exporting { getServerState, startServer, ... }) so routes depend on services, not raw ctx. Reduces coupling, aids testability. |
| Expand Test Suite with Jest Snapshots for API Responses | `backend/test_api.test.js` | high | medium | low | Current 1 test file covers only helpers. Add supertest tests for at least 10 high-value routes (e.g., GET /api/servers, POST /api/servers/{id}/restart, POST /api/users) with Jest snapshots to catch unintended API response changes. Aim for 20+ test cases. |
| Add jest.config.js Coverage Thresholds | `backend/jest.config.js` | medium | trivial | low | Reference enforces 85% lines, 100% functions. Set collectCoverage: true and coverageThreshold: { global: { lines: 50, functions: 60 } } as a minimum. Gradually raise it as tests improve. |
| Document Data Model with Schema Comments | `backend/lib/context.js` | low | small | low | ctx.servers, ctx.users, ctx.roles, ctx.auditLog, ctx.webhooks are bare arrays. Add JSDoc comments describing shape: /** @typedef {object} ServerDefinition @property {string} id @property {string} name ... */. Makes intent clear and improves IDE hints. |
| Isolate Context Initialization from Bootstrap | `backend/server.js (lines 23-100)` | low | small | low | Move ctx initialization into a separate module (e.g., backend/lib/bootstrap.js) that returns a fully-initialized ctx. server.js becomes cleaner (load bootstrap, then wire express). Easier to test context setup without starting the server. |
| Add Graceful Shutdown Tests for data-store.js | `backend/test_api.test.js (or new file backend/lib/data-store.test.js)` | high | medium | low | Test flushAll() and forceFlush() under various scenarios: pending write, concurrent writes, temp file cleanup. Currently no unit tests for the atomic write logic—highest-risk persistence code deserves coverage. |
| Extract Configuration Validation into a Testable Module | `backend/lib/config.js, backend/lib/config-schema.js` | medium | small | medium | config.js loads and applies defaults. Add unit tests for validation logic (e.g., schema enforcement, bad port numbers, missing required fields). Currently config errors may slip into runtime. |
| Add Error Boundary Middleware to Express | `backend/server.js (bottom of route setup)` | medium | trivial | low | Add catch-all error handler middleware after all routes to log unhandled errors and return 500 JSON. Currently missing; would prevent silent failures and edge-case 500s being returned as html. |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Upgrade ESLint Config to Catch Floating Promises | critical | trivial | low | With 4979 lines of async JavaScript and 30+ route files, unhandled promise rejections are a high-risk blind spot. The reference enforces @typescript-eslint/no-floating-promises; Citadel should add similar rules in plain ESLint (via eslint-plugin-promise) for minimal friction. |
| Expand Test Suite to Cover Routes & Services (15-20 high-value tests) | high | medium | low | Citadel's 1 test file covers only helpers. The 30+ route files (actions.routes.js, discord.routes.js, deploy.routes.js, etc.) are untested. Start with 2-3 critical routes (server status, auth, restart) with supertest to catch regressions. Reference has 35 test files; aim for 10+ within 6 months. |
| Document & Enforce Service Layer Boundaries (Low-Risk Refactor) | high | medium | medium | Routes directly mutate ctx and call internal helpers, creating implicit contracts. Add a simple services/ facade (e.g., services.startServer(serverId), services.getServerState(serverId)) and refactor routes to use it. Improves testability without breaking architecture. Can be done incrementally per route. |
| Add Jest Coverage Thresholds & Baseline Measurement | medium | small | low | Reference enforces 85% lines / 100% functions via NYC. Citadel has no thresholds. Running `npm test -- --coverage` will show current baseline; set a 50% lines threshold initially, then raise by 10-20% every sprint. |
| Retrofit JSDoc Type Hints to Core Modules (Quick Win) | medium | small | low | No compile-time type checking in JavaScript. Adding /** @type {ServerDefinition[]} */ to ctx.servers and /** @returns {Promise<ServerInfo>} */ to functions improves IDE autocomplete and catches typos. Does not require refactoring; does not break anything. |
| Add Automated Graceful Shutdown Test for data-store.js | high | small | low | data-store.js has 200+ lines of sophisticated atomic-write logic (temp files, symlink checks, permission modes, crash recovery). This is the most critical persistence code; currently 0 unit tests. Add 3-5 test cases to catch regressions. |
| DO NOT Convert to TypeScript or Adopt tsyringe (Large Refactor, Not Recommended) | low | large | high | Reference uses TypeScript + tsyringe (full DI). Citadel is a 2+ year old commercial product with 4979 JS lines. Full migration would introduce weeks of risk, break existing deployments, and strain testing. Instead, focus on: (1) stronger ESLint, (2) JSDoc hints, (3) test coverage, (4) service layer clarity. Incremental wins without big rewrites. |
| Extract & Unit Test Critical Helpers (config, auth, data-store) | medium | small | low | config.js (schema validation), lib/helpers.js (safePath, checkPasswordPolicy), data-store.js (atomic writes) are foundation. Unit tests for these prevent cascading bugs. Reference tests all utilities (test/util/*). Aim for 100% coverage of helpers within 2 sprints. |

