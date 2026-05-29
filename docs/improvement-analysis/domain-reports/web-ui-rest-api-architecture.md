# Domain Report: Web UI & REST API Architecture

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

**Reference (dayz-server-manager 3.10.0, TypeScript):**

The reference uses an **interface-driven, command-map pattern** for API design:
- **src/interface/interface.ts (line 50-377)**: Central `CommandMap` registry where each endpoint is a `RequestTemplate` with declarative metadata (HTTP method, required permission level, parameter definitions with optional parsing, response handling).
- **src/interface/rest.ts (line 21-378)**: REST server that dynamically registers routes from the CommandMap at startup (lines 300-326). Each route is auto-wired from the template's `method`, `action`, and handler.
- **src/middleware/logger.ts**: Simple request/response logging middleware.
- **WebSocket implementation (rest.ts lines 84-255)**: Handles WebSocket upgrades with auth-token extraction from `sec-websocket-protocol` header, registers listeners to internal EventBus, streams responses back over WS.
- **Auth**: Uses `express-basic-auth` (line 3) + custom hardcoded username/password validation in manager config (lines 120-124).
- **Frontend**: Angular-based (ui/src/modules/* - feature-module routing with lazy loading).
- **Swagger/OpenAPI**: Uses `swagger-ui-express` in package.json but not evident in the interface.ts design; seems to be static documentation rather than auto-generated from request templates.

**Key strengths:**
1. Request template metadata allows param extraction, optional flags, custom parsing, and permission RBAC in one declarative place.
2. Single request/response model (`Request` / `Response` / `ResponsePart`) handles both REST and WebSocket uniformly.
3. Interceptor pattern (lines 507-518) chains validation, RBAC, and init checks before action execution.
4. Streaming response support via `ResponsePartHandler` for long-running ops.

## How Citadel does it

**Current (Citadel, Node.js/JavaScript):**

Citadel uses a **traditional Express route-per-handler pattern** with distributed validation:
- **backend/server.js (lines 192-243)**: Routes imported as separate modules (auth.routes, servers.routes, mods.routes, etc.). No central registry or metadata.
- **backend/routes/*.routes.js**: Each file exports a function that directly calls `app.get/post/delete` with inline handler logic.
- **Authentication (backend/middleware/auth.js)**: Factory middleware `auth(requiredPermission)` and `authForServer(requiredPermission)` that extract JWT from cookie or Bearer header, verify with `jsonwebtoken`, check role permissions, and enforce server scope.
- **Request validation**: Ad-hoc per route — no centralized schema validation. Examples: `/api/servers/:id/mods/install` (mods.routes.js line 23-25) manually checks `workshopId && name` in req.body; `/api/servers/:id/mission-folder` (servers.routes.js) checks `req.params.id` and calls `detectMissionFolder()`.
- **WebSocket (server.js lines 286-375)**: Socket.io with JWT auth via `extractTokenFromHandshake()` (reads cookie first, falls back to `auth.token`). Rate limiting via per-user bucket (`WS_RATE_MAX_MESSAGES = 120`). Events like `serverStatus`, `players` emitted directly on connection.
- **Frontend**: React/Vite SPA (web/frontend/src/pages, components, hooks, contexts). API client class (api.js lines 28-300) with timeout, event recording, CSRF token handling.
- **Error handling**: Custom `safeError()` (http-errors.js) and `clientError()` helpers for consistent error responses.
- **OpenAPI/Swagger**: No documented API spec; package.json has no swagger-ui or openapi dependencies.

**Key characteristics:**
1. Each route owns its validation — highly decentralized.
2. Larger, more complex product (40+ route files vs. one CommandMap).
3. Rich auth model: role-based permissions + server scope (scope array per role).
4. Webhook system for events (notifications.js, fireWebhooks).
5. Ring-buffered API event logging for diagnostics.

## Detailed analysis

# Web UI & REST API Architecture Comparison

## Executive Summary

The reference codebase (dayz-server-manager 3.10.0) uses a **declarative, command-map-driven API design** where endpoints are registered via a central `RequestTemplate` registry, enabling consistent request validation, permission checks, and streaming responses across REST and WebSocket. Citadel uses a **traditional Express route-per-file pattern** with distributed validation and more sophisticated authentication (JWT + MFA + brute-force lockout + role-based server scope). 

Both approaches have merit. The reference's centralized metadata enables better introspection and documentation, while Citadel's modular route structure and advanced auth model scale better to a larger product (40+ route files vs. ~30 CommandMap entries). The key improvement for Citadel is adding a lightweight request validation schema layer and generating OpenAPI documentation to unlock SDK generation and third-party integrations.

---

## Architecture Comparison

### API Design Pattern

**Reference (CommandMap pattern):**
- All endpoints registered in `src/interface/interface.ts` (lines 50–377) as a `Map<string, RequestTemplate>`.
- Each `RequestTemplate` declares: HTTP method, permission level, param definitions (with location, optional flag, custom parser), response handling (streaming or single-shot).
- The REST server (rest.ts lines 300–326) dynamically registers Express routes from the CommandMap at startup: `this.router[method]('/' + resource, handler)`.
- Single `execute()` method applies interceptors (init check, RBAC, param validation) before invoking the action handler.

**Citadel (Route-per-file):**
- Routes imported into server.js (lines 192–243) as separate modules: `require('./routes/auth.routes')(app)`, `require('./routes/servers.routes')(app)`, etc.
- Each route file directly calls `app.get()`, `app.post()`, etc. with inline handlers.
- Validation is embedded in each handler: `if (!workshopId || !name) return res.status(400)...`.
- Middleware for auth and rate-limiting applied globally or selectively.

**Trade-offs:**
- The CommandMap approach centralizes metadata, making it easy to generate documentation or enforce patterns. Downside: less flexible for complex route hierarchies (Citadel's `/api/servers/:id/mods/install` vs. generic `/:resource` naming).
- Citadel's modular approach scales well to 200+ endpoints across diverse domains. Downside: no single place to see the full API surface or enforce consistency.

### Request Validation

**Reference:**
- RequestTemplate.params defines each parameter with `name`, `location` ('body' or 'query'), `optional`, and `parse` (custom type conversion).
- Interface.execute() (lines 487–495) validates all params before invoking the action.
- Parser functions allow type coercion: `parseBoolean` (line 21) converts 'true' → true; `parseNumber` (line 24) converts '10' → 10.

**Citadel:**
- Ad-hoc validation in each route handler.
- Example (mods.routes.js line 23): `const { workshopId, name } = req.body; if (!workshopId || !name) return res.status(400)...`
- Some routes check `req.params.id` directly; others extract from req.body.
- No centralized schema validation — each developer chooses their own pattern.

**Impact:**
- Reference: consistent validation, easier to add new rules (e.g., regex length checks) in one place.
- Citadel: higher code duplication, inconsistent error messages, harder to enforce minimum standards.

### Error Handling

**Reference:**
- Response class (interface.ts line 18) wraps `status`, `body`, and optional `uuid` (for request tracking).
- Errors thrown as Response objects (e.g., line 399: `throw new Response(HTTP.HTTP_STATUS_NOT_FOUND, ...)`) and caught at the execute() boundary (line 546).
- handleExecutionError() (lines 380–390) formats unknown errors into a standard Response.

**Citadel:**
- Errors returned via two helpers: `clientError(res, status, message, details)` and `safeError(res, error, context)` (http-errors.js).
- No global error handler — each route must remember to call clientError()/safeError().
- Errors occasionally logged and returned as JSON (e.g., auth.routes.js line 90–93: `clientError(res, 429, 'Too many failed login attempts.', { code: 'LOGIN_LOCKED', ... })`).
- Many routes simply do `res.status(400).json({ error: 'msg' })` without a helper.

**Impact:**
- Reference: consistent error shape and global boundary for unexpected errors.
- Citadel: error messages and codes vary per route. Some include `code` and `suggestion`, others just `error`. Frontend must be defensive.

### Authentication & Authorization

**Reference:**
- express-basic-auth middleware (line 306 in rest.ts) with inline password lookup from manager.config.admins.
- Permission checks in RequestTemplate.level field (e.g., 'view', 'moderate', 'admin').
- Interceptor chain applies RBAC at execute() time (interface.ts lines 441–473).

**Citadel:**
- JWT with HttpOnly cookie (set by /api/auth/login) + optional Bearer fallback.
- Middleware factories: `auth(requiredPermission)` and `authForServer(requiredPermission)` (auth.js).
- Permission checks via role.permissions array (wildcard '*' or specific permissions like 'server.view').
- Server-scoped permissions: roles have optional `serverScope` array for multi-tenant isolation (auth.js line 114).
- Advanced: brute-force lockout (auth.routes.js lines 35–103), MFA with TOTP (lines 187–245), token revocation (isTokenRevoked call), force-password-change flow.

**Impact:**
- Reference: simpler (single static password), unsuitable for multi-user.
- Citadel: production-grade auth with session management, MFA, and scoped access. Superior for a larger product.

### WebSocket Implementation

**Reference:**
- Upgrade handler intercepts HTTP upgrade requests (rest.ts lines 106–137).
- Extracts auth token from `sec-websocket-protocol` header.
- Registers socket listener for internal EventBus events (lines 143–184).
- Responds via websocketRespond() which sends JSON-wrapped `{ cmd, data }` back over WS (lines 207–219).
- Supports streaming via ResponsePartHandler for long-running operations.

**Citadel:**
- Socket.io with auto-reconnect logic.
- Auth via io.use middleware (server.js lines 286–304) that reads cookie first, falls back to `auth.token`.
- Rate limiting per-user (lines 311–323) with per-socket message bucket.
- Events emitted directly: `socket.emit('serverStatus', {...})`, `socket.emit('mods', {...})`.
- No standard request/response envelope — each event type has its own shape.

**Impact:**
- Reference: unified request/response model (REST and WS both use Request/Response), supports streaming.
- Citadel: more familiar socket.io pattern, familiar to Node.js developers, but no request/response tracking across WS.

### Frontend Architecture

**Reference:**
- Angular with feature modules (ui/src/modules/* e.g., auth, dashboard, players, settings).
- Lazy-loaded routing (module-per-feature).
- HTTP requests to dynamically generated API endpoints.

**Citadel:**
- React/Vite SPA (web/frontend/src/pages, components, hooks, contexts).
- API class (api.js) with static methods for HTTP requests; socket.io for real-time events.
- Ring-buffered API event logging for diagnostics (api.js lines 38–94: `API.getRecentEvents()` used by error boundaries).
- Auth via custom hook (contexts/AuthContext) that manages cookie and logout.

**Impact:**
- Both are modern SPAs. Citadel's API class and event logging are nice additions for debugging.

---

## Feature Gaps

### Citadel Lacks (Reference Has)

1. **OpenAPI/Swagger documentation** — Reference includes swagger-ui-express; Citadel has zero API spec. Blocks SDK generation, third-party integrations, and automated testing.

2. **Centralized request schema validation** — Reference's RequestTemplate.params pattern is declarative and reusable; Citadel's inline validation is repetitive and inconsistent.

3. **Programmatic endpoint introspection** — Reference's CommandMap is a runtime registry (can be queried/iterated); Citadel's routes are scattered — no way to list endpoints or enforce that all have auth checks.

4. **Unified request/response model** — Reference uses same Request/Response classes for REST and WS, enabling single error handling; Citadel uses fetch + socket.io events (different abstractions).

### Citadel Has (Reference Lacks)

1. **Server-scoped role permissions** — Citadel's `role.serverScope` array enables multi-tenant isolation (admin can manage subset of servers). Reference has no per-role resource restriction.

2. **Advanced authentication** — Citadel: JWT + HttpOnly cookie + MFA (TOTP) + brute-force lockout + token revocation + force-password-change. Reference: static basic auth.

3. **Webhook event system** — Citadel fires webhooks on mod install, bans, session events, etc. Reference only has Discord command handler.

4. **API diagnostic event ring** — Citadel logs recent API calls (method, status, duration, URL) to a ring buffer for support debugging. Reference has no equivalent.

---

## Code Quality & Security Observations

### Positive

1. **Citadel's CSRF double-submit pattern** — Reads X-CSRF-Token header, validates against csrf-nonce cookie (middleware/csrf.js). Symmetric and stateless.

2. **Citadel's WebSocket rate limiting** — Per-user bucket (not per-socket), survives reconnects, sweeps stale entries (server.js lines 311–323). Reference has no WS rate limiting.

3. **Citadel's token revocation** — When user password is forced-changed or deleted, all existing tokens are revoked (auth-routes.js line 266, token-revocation.js). Reference has no session invalidation.

4. **Reference's interceptor chain** — Clean separation of concerns: init check, RBAC, param validation each as a separate function (interface.ts line 507–518).

### Risks

1. **Citadel: CSRF check after rate limit** — Rate limiting counts requests before CSRF validation (middleware order in server.js). Attacker can flood with invalid tokens and consume rate-limit quota. **Fix:** Move CSRF validation to earlier middleware, or exempt invalid-token requests.

2. **Citadel: WebSocket permissions not enforced on all messages** — Rate limiting checks pass through, but some socket.io events (e.g., diagnostics emitted on first connection) may not be gated by permission. Review citadel-socket.js for unguarded emissions.

3. **Reference: no token revocation** — If a user is deleted or compromised, their JWT (with 8hr lifetime in Citadel) remains valid. Reference doesn't address this.

---

## Recommendations (Prioritized)

### Phase 1: Validation & Documentation (2–3 weeks)

1. **Implement request validation schema layer** (effort: medium, impact: high).
   - Create lib/request-validator.js with simple schema API: required, optional, type, length, regex, enum, custom.
   - Refactor 10–15 high-traffic routes (auth, servers, mods) to use it; measure code reduction.
   - Success metric: eliminate 50+ lines of boilerplate validation per route.

2. **Standardize error response envelope** (effort: small, impact: high).
   - Define: `{ error, code?, suggestion?, details? }`.
   - Add global error handler middleware.
   - Update all route error returns to use the shape.

3. **Generate OpenAPI spec** (effort: large, impact: high).
   - Write lib/openapi-generator.js that introspects routes, middleware, and auth.
   - Output /api/docs/openapi.json.
   - Expose swagger-ui-express at /api/docs.
   - Start with 5–10 core endpoints; iterate to full coverage.

### Phase 2: Rate Limiting & WebSocket (1–2 weeks)

4. **Fix CSRF validation ordering** — Move CSRF check before rate-limit count.

5. **Normalize WebSocket event structure** — Wrap payloads in `{ type, data, requestId?, error? }` for better correlation and error handling.

### Phase 3: API Audit & Observability (1 week)

6. **Create API audit matrix** — Document all endpoints, permissions, and server scope behavior to prevent regressions.

7. **Add per-route timeout configuration** — Allow long-running ops (Steam updates, file operations) to override the 30s default.

### Phase 4: Not Recommended

8. **Do NOT flatten routes into a CommandMap** — Citadel's 200+ endpoints across 40 files are better organized by domain than a flat map. The reference's pattern scales to ~100 endpoints; beyond that, maintainability suffers. Instead, extract validation schema and OpenAPI generation ideas without restructuring.

---

## Summary

Citadel's architecture is appropriate for its scale and complexity. The modular route structure, advanced auth model, and webhook system are significant advantages over the reference. The main gap is **API documentation and validation consistency**, which are lower-risk improvements that unlock SDK generation and reduce bugs. Adopting a lightweight validation schema (without full restructuring) and generating OpenAPI spec from route metadata are high-value, low-risk wins.

## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Centralized request schema/validation | ref_has_current_lacks | high | medium | Reference has RequestTemplate with declarative param definitions (location, optional, parse function). Current lacks schema validation framework — every route manually validates its inputs with inline if-checks. No single source of truth for API contract. |
| OpenAPI/Swagger documentation | ref_has_current_lacks | high | large | Reference integrates swagger-ui-express (though design is not fully auto-generated). Current has zero API documentation — developers must read route handlers to understand endpoints. No ability for clients to auto-generate SDKs. |
| Declarative command/endpoint registry | ref_has_current_lacks | medium | large | Reference's CommandMap allows introspection of all endpoints, their methods, permissions, and parameters at runtime. Current routes are scattered across files — no programmatic way to list/inspect the API surface. Makes it hard to auto-generate docs or validate coverage. |
| Server-scoped permissions with role scope arrays | current_has_ref_lacks | high | small | Current has serverScope array on roles for multi-tenant isolation (authForServer middleware, auth.js line 114-118). Reference uses simple permission string checks — no concept of per-role server access lists. |
| WebSocket streaming responses | both_have_current_weaker | low | medium | Reference's websocketRespond() and ResponsePartHandler support chunked streaming over WS for long-running operations. Current WebSocket uses point-to-point socket.io events. Not directly comparable but useful pattern for large data transfers. |
| Unified request/response model across transports | ref_has_current_lacks | low | large | Reference uses same Request/Response classes for REST and WebSocket. Current uses fetch/REST for HTTP and socket.io events for WS — different abstractions. |
| Basic auth vs. JWT | current_has_ref_lacks | high | small | Reference uses express-basic-auth (stateless). Current uses JWT with token revocation, MFA support (TOTP), brute-force lockout, and session tracking. Current auth is significantly more sophisticated. |
| API diagnostic event logging | current_has_ref_lacks | low | small | Current records recent API calls to a ring buffer for support diagnostics (api.js line 38, downloadDiagnostics). Reference has no equivalent. |
| Webhook event system | current_has_ref_lacks | low | small | Current has fireWebhooks() that triggers on mod install, ban, session events, etc. Reference has no visible webhook layer (only Discord message handler for commands). |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Introduce request validation schema layer | `backend/routes/*.routes.js` | high | medium | low | Replace ad-hoc manual validation (e.g., `if (!workshopId \|\| !name) return res.status(400)...`) with a declarative schema validator. Create a lightweight lib/request-validator.js that supports common patterns: required/optional fields, type checking, string length, regex, enum, and custom validators. Use it at route entry to fail fast with consistent error messages. Reduces code duplication across 40+ route files and improves consistency. |
| Centralize error response format | `backend/lib/http-errors.js` | high | small | low | Errors are currently returned via clientError() and safeError() helpers — inconsistently applied. Establish a single error response shape: `{ error, code?, suggestion?, details? }`. Create middleware to catch unhandled exceptions and format them uniformly. Document error codes (e.g., 'INVALID_CREDENTIALS', 'LOGIN_LOCKED', 'ACCESS_DENIED') so frontend can localize messages. |
| Add request/response logging with correlation IDs | `backend/middleware/logging.js` | medium | small | low | Current logging is pino-based but ad-hoc (individual route logs). Create a logging middleware that assigns a `requestId` (UUID) on entry and includes it in all logs for the duration of that request. Log request envelope (method, path, status, durationMs) to make diagnostics easier. Already partially done in frontend (api.js event ring), extend to backend. |
| Generate OpenAPI spec from route metadata | `backend/lib/openapi-generator.js` | high | large | low | Create a low-code OpenAPI generator that inspects routes and middleware, then produces a spec.json. Start minimal (just endpoints, methods, auth requirements, basic param docs) and iterate. Expose via /api/docs/openapi.json + /api/docs/swagger-ui endpoint. Use swagger-ui-express. This unblocks SDK generation, API doc site, and third-party integrations. |
| Normalize WebSocket message structure | `backend/lib/citadel-socket.js` | medium | small | medium | WebSocket events are point-to-point socket.io emissions (e.g., `socket.emit('mods', {...})`). Define a standard message envelope like `{ type, requestId?, data, error? }` to match REST response patterns. Allows frontend to unify request/response tracking and error handling across REST and WS. |
| Audit and document all permission checks | `backend/routes/auth.routes.js, backend/middleware/auth.js` | medium | small | low | Permission checks are scattered: some use `auth('permission')` middleware, some check `req.user.role` directly. Create a permission audit matrix (e.g., CSV or JSON) listing every endpoint, required permission, and server scope logic. Ensures no endpoints bypass checks and helps operators understand the permission model. |
| Validate CSRF token in rate-limit middleware | `backend/middleware/csrf.js, backend/middleware/rate-limit.js` | medium | small | medium | CSRF protection runs per route, but rate-limiting counts requests before CSRF validation. A malicious actor flooding with invalid CSRF tokens can still burn through the rate limit. Move CSRF check before rate-limit count (or exempt valid tokens). |
| Frontend: consolidate API client patterns | `web/frontend/src/api.js` | low | small | low | The API class uses static methods (API.get(), API.post()). Each component typically wraps these in custom hooks. Define a higher-order hook abstraction (useAPI) that handles loading/error/retry so each component isn't reinventing it. This is more of a React pattern improvement than API design, but improves robustness. |
| Add request timeout configuration per endpoint | `backend/routes/*.routes.js` | low | small | low | Some operations are long-running (file operations, Steam updates). Currently, all requests timeout after `REQUEST_TIMEOUT_MS = 30000` (api.js). Add per-endpoint timeout override (e.g., file download = 2 min, SteamCMD = 10 min) to avoid premature client-side timeouts on slow operations. |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Implement lightweight request validation schema layer (phase 1) | high | medium | low | Citadel has 40+ route files with repeated boilerplate validation. A centralized schema layer (similar to RequestTemplate.params in reference) reduces code duplication by 20-30% and catches bugs earlier. Start with a simple validation function that takes a schema object and returns middleware. No external libraries needed — keep it minimal to avoid dependency bloat. |
| Document existing API surface with OpenAPI spec (phase 2) | high | large | low | Current codebase has zero API documentation. Writing an OpenAPI spec forces a review of all endpoints, parameters, and error codes. This unblocks: (1) SDK generation for desktop/mobile clients, (2) third-party integrations (Discord bot, Cloud bridge), (3) automated API testing. Start by documenting 5-10 critical endpoints (auth, servers, mods) as a proof-of-concept; iterate to full coverage. |
| Standardize error response envelope | high | small | low | Errors return various shapes — sometimes `{ error }`, sometimes `{ error, code, suggestion }`. A single shape (e.g., `{ error, code?, suggestion?, details? }`) means the frontend can reliably parse errors and show localized messages. Add a global error handler middleware that catches unhandled exceptions and reformats them. |
| Add per-route timeout configuration | medium | small | low | 30-second default timeout is too tight for Steam update operations that can run 5-10 minutes. Add a route-level `timeout` option (e.g., `auth('permission', { timeout: 600000 })`) so long-running ops don't fail prematurely. Frontend's 30s timeout was likely chosen conservatively to avoid hanging UI. |
| Normalize WebSocket event structure | medium | small | medium | WebSocket currently uses point-to-point socket.io events with no standard envelope. Wrapping payloads in `{ type, data, requestId?, error? }` allows frontend to correlate requests/responses (useful for streaming long operations) and apply uniform error handling. Non-breaking: add new event names alongside old ones, deprecate over time. |
| Create API audit matrix | medium | small | low | Citadel has complex permission/scope logic (global, per-server, Discord bot synthetic role, etc.). Document it in a matrix format (CSV/JSON): endpoint → method → permission → server scope → DCB role behavior. Helps operators understand what each role can do and prevents permission-check regressions during refactoring. |
| Move CSRF validation before rate-limit accounting | medium | small | medium | Rate limiting currently counts requests before CSRF validation. An attacker can flood with invalid tokens and burn the rate limit for legitimate users. Low-effort fix: check CSRF in an early middleware (after cookie parsing, before rate-limit) so invalid tokens don't consume quota. |
| Do not flatten the current route structure into a CommandMap | high | small | low | Reference's CommandMap pattern is elegant for a small manager (50-100 endpoints). Citadel has 40+ route files and 200+ endpoints spanning diverse domains (auth, servers, mods, files, roles, webhooks, etc.). Flattening into a single map would be harder to navigate and parallelize than the current modular approach. Instead, extract lessons (validation schema, OpenAPI generation) without restructuring. |

