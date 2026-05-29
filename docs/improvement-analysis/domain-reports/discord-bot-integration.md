# Domain Report: Discord bot integration

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

The reference (DayZ Server Manager v3.10.0) uses a TypeScript-based architecture with dependency injection (tsyringe), centralized event bus, and type-safe command routing. Key components: **DiscordBot** (src/services/discord.ts) manages lifecycle and message queuing with readiness checks; **DiscordMessageHandler** (src/interface/discord-message-handler.ts) parses text commands (PREFIX `!`), validates against a configurable command map, and returns Request/Response objects; **DiscordEventConverter** (src/services/discord-event-converter.ts) subscribes to internal events (MOD_UPDATED, GAME_UPDATED, MONITOR_STATE_CHANGE) and emits formatted Discord messages with MessageEmbed objects. Uses discord.js v13.17.1. Config-based channel typing (admin/notification) with mode matching. Features: automatic message queueing on bot startup, graceful error handling with structured logging, and event-driven architecture. Tests exist for command handling with parameter parsing and channel validation.

## How Citadel does it

Citadel (discord-bot/ directory) uses vanilla JavaScript with modular file structure and dispatch maps. Key components: **bot.js** (entry point) handles lifecycle, slash commands, and button/modal/select-menu routing; **api.js** provides fetch wrapper with timeout, retry logic (5xx), and HMAC-SHA256 signing for audit attribution; **commands/** folder has individual slash-command modules; **handlers/** (buttons.js, selectMenus.js, modals.js) use dispatch maps instead of if/else chains; **utils/** (permissions.js, cooldowns.js, sanitize.js) provide permissions, tiered cooldowns, and input validation; **ui/** (embeds.js, components.js) centralize embed and component building. Uses discord.js v14.16.3. No explicit event bus or dependency injection. Direct panelAction() calls for API communication with per-guild server selection. Cooldown system is per-user per-action with three tiers (query/admin/control). Comprehensive input validation and error handling in handlers.

## Detailed analysis

# Discord Integration: Cross-Reference Analysis

## Executive Summary

The **reference codebase** (DayZ Server Manager v3.10.0) and **Citadel** represent two different architectural philosophies for Discord integration. The reference uses TypeScript, dependency injection, and an event-driven architecture (DiscordBot + DiscordEventConverter + event bus), designed for long-running, production-grade server management. Citadel uses vanilla JavaScript with modular dispatch maps, comprehensive interactive components (buttons, modals, select menus), and audit-layer HMAC signing, designed for a modern slash-command-driven control panel.

**Citadel is strictly more feature-rich and modern** (discord.js v14 vs v13, slash commands vs text commands, full UI component suite). The reference offers better testability, type safety, and event-driven architecture for autonomous notifications. The two codebases have minimal overlap in their gaps—most "missing" features in each direction represent deliberate architectural choices rather than oversights.

---

## Key Differences

### Architecture & Lifecycle

**Reference (DiscordBot.ts):**
- Singleton service with dependency injection (tsyringe)
- Explicit state: `private ready = false`, `private msgQueue: DiscordMessage[] = []`
- Lifecycle: `start()` → login → `onReady()` → buffer queued messages
- Message queueing with 1000ms delay after ready event prevents startup race conditions
- Centralized through EventBus: internal services emit `InternalEventTypes.DISCORD_MESSAGE`, DiscordBot listens and relays to Discord

**Current (bot.js):**
- Direct module with global client instance
- No explicit ready-state buffering; sends messages immediately
- Slash command registration happens at startup via REST API
- Lifecycle: login → register commands → ready → serve interactions
- No event bus; handlers call `panelAction()` directly; no inbound-event listening

**Winner:** Reference for reliability (queueing), Current for simplicity (fewer abstractions).

---

### Command Handling

**Reference (DiscordMessageHandler.ts):**
- Text command syntax (`!help`, `!command arg1 arg2`)
- Command map from eventInterface.commandMap
- Parameter parsing with custom validators (per RequestTemplate)
- Response is Request/Response object, suitable for REST APIs
- One-liner help text generation (formatCommandUsage)
- Channel mode validation (`isDiscordChannelType`)

**Current (commands/ + handlers/):**
- Slash commands (ChatInputCommandBuilder)
- Per-command module with `data` (command definition) and `execute(interaction)` handler
- No formal command registry; auto-loaded from filesystem
- Modals, buttons, select menus for rich interaction flows
- Comprehensive input validation (Steam64 format, coordinates, item classes)
- Contextual help via embed messages, not inline text

**Winner:** Current (slash commands are the modern Discord standard; buttons/modals are far superior UX).

---

### Event Handling & Notifications

**Reference (DiscordEventConverter.ts):**
- Subscribes to internal events: `MOD_UPDATED`, `GAME_UPDATED`, `MONITOR_STATE_CHANGE`
- Emits formatted Discord messages with MessageEmbed objects
- Automatically notifies of crashes, updates, server state changes
- **Citadel has no equivalent:** status/feeds are query-based (user clicks a button)

**Current:**
- All data retrieval is pull-based (user presses button)
- No event listener for async backend events
- Suitable for on-demand queries, not for autonomous alerts

**Gap:** Current lacks crash-detection alerts, update-completion notifications. Adding a simple event listener (WebSocket or polling) would be medium effort but high value.

---

### Permissions & Rate Limiting

**Reference:**
- No visible rate limiting in the provided code
- Channel mode validation only (admin vs notification)
- No per-user cooldowns

**Current:**
- Three-tier cooldown system: query (3s), admin (10s), control (30s)
- Per-user, per-action cooldown tracking (in-memory Map with auto-expiry)
- isAdmin() permission check (requires DISCORD_ADMIN_ROLE_ID)
- Admin gate pattern: `if (!await adminGate(interaction, action)) return;`
- Tiered constants allow easy adjustment

**Winner:** Current (much more sophisticated and necessary for a public bot).

---

### Audit & Security

**Reference:**
- No audit layer visible; relies on Discord's audit logs

**Current:**
- HMAC-SHA256 signing (signCall) of backend calls
- Payload: `${ts}.${action}.${discordUserId}`
- Headers: X-Discord-Ts, X-Discord-Sig
- Replay window checked on backend (5-minute window mentioned in comments)
- Legacy callers without signatures still work (backward compatible)

**Winner:** Current (audit L2 is critical for a backend-integrated bot).

---

### Message Formatting & UI

**Reference:**
- MessageEmbed with basic fields (color, title, fields, footer)
- Mod update embeds with Steam metadata, preview URLs
- Static format; no interactive components

**Current:**
- Comprehensive EmbedBuilder (colors, progress bars, formatted uptime/playtime)
- Status indicator emojis (🎮 running, ⚠️ warning, etc.)
- Multiple embed builders: buildStatusEmbed, buildPlayerListEmbed, buildLeaderboardEmbed, buildPlayerInfoEmbed
- Button-driven navigation (category select → subcategory buttons)
- Modal-based input (broadcast, RCON, player queries, teleport coordinates)
- Select menus for player selection (kick, heal, kill, teleport, etc.)
- Rich components.js with reusable builders

**Winner:** Current by a wide margin (interactive components, polish, UX).

---

### Error Handling & Resilience

**Reference:**
- Try-catch in onMessage, start(), sendMessage()
- Logs errors with structured logger
- Silent failures on channel lookup misses

**Current:**
- fetchWithTimeout + fetchWithRetry (1 initial + 1 retry on 5xx)
- 8-second default fetch timeout, 2-second retry delay
- safeReply() helper handles deferred/replied state gracefully
- Try-catch in handler and bot event listeners
- Detailed error messages in embeds (Error: ${result.error})
- Graceful error recovery in interaction handlers

**Winner:** Current (retry logic, timeout handling, detailed user feedback).

---

### Testing

**Reference:**
- discord-message-handler.test.ts with mocha + chai
- Tests for command parsing, parameter validation, channel mode checks
- Mocks for Manager, Interface, EventBus
- ~100 lines of test code per handler

**Current:**
- Zero tests
- No test infrastructure set up
- Manual testing only

**Gap:** Citadel lacks tests; given the complexity of multi-handler dispatch and user input validation, adding Jest tests would be medium effort but high safety ROI.

---

### Dependencies

**Reference:**
- discord.js v13.17.1 (older, text-command-era)
- tsyringe (dependency injection)
- reflect-metadata (TypeScript decorators)

**Current:**
- discord.js v14.16.3 (modern, interaction-command-era)
- dotenv (env loading)
- No DI framework

---

## Feature Gap Summary

**Current has that Reference lacks:**
1. Slash commands (v14 API)
2. Button interactions and dispatch maps
3. Modal forms (broadcast, RCON, teleport, spawn item)
4. Select menus (server switcher, player selection)
5. Per-user, per-action cooldowns (sophisticated)
6. HMAC-SHA256 audit signing for backend calls
7. Multi-server guild context awareness
8. Rich input validation (Steam64, coordinates, workshop IDs)
9. Comprehensive embed formatting (progress bars, status indicators, formatted uptime)
10. Graceful error recovery with safeReply

**Reference has that Current lacks:**
1. Event-driven notifications (crash detection, startup/shutdown, update completion)
2. Message queueing and ready-state buffering
3. Dependency injection and testability
4. Type safety (TypeScript)
5. Unit tests for handler logic
6. Legacy text-command support (not a win for modern use)

---

## Code Quality & Maintainability

**Reference strengths:**
- Type safety catches entire classes of bugs
- DI enables easy testing and mocking
- Event bus decouples services
- Tests provide confidence in refactoring

**Current strengths:**
- No build step; fast iteration
- Modular structure (commands/ handlers/ utils/ ui/) is intuitive
- Dispatch maps are clearer than if/else chains
- Comprehensive validation reduces backend load

**Current weaknesses:**
- No type hints; IDE support is weak
- Zero tests; refactoring is risky
- Magic strings (customIds) scattered throughout
- Duplication of permission/cooldown checks across handlers
- No event listening for autonomous alerts

---

## Recommendations (Prioritized)

### High Priority
1. **Event-driven notifications** (medium effort): Add a simple event listener (WebSocket or polling) to subscribe to server events (crash, startup, mod update). Broadcast to a notification channel. Dramatically improves operator awareness.
2. **Add unit tests** (medium effort): Jest + discord.js mocks for buttons, modals, commands. Current has zero tests; critical given the attack surface.
3. **Message queueing** (small effort): Buffer outbound messages until client.ready. Prevents race conditions during startup.

### Medium Priority
4. **Consolidate handler dispatch** (small effort): Extract the `adminGate()` pattern into a reusable middleware. Reduce duplication of permission + cooldown checks.
5. **JSDoc type hints** (small effort): Add @param/@returns to api.js, handlers, commands. Unlock IDE autocomplete without TypeScript.
6. **Error context & tracing** (small effort): Enrich panelAction() errors with request IDs and user context for better debugging.
7. **Audit logging** (medium effort): Persist action calls to a local log (SQLite or JSON) per guild for compliance and support.

### Low Priority
8. **Migrate to TypeScript** (large effort): Only if Citadel becomes a flagship product. Current JS is sufficient for a 1.0 product.
9. **Graceful degradation** (small effort): Allow bot to start in read-only mode if DISCORD_BOT_API_KEY is missing. Better dev experience.

---

## Conclusion

Citadel's Discord integration is **objectively more modern and feature-rich** than the reference (v14 with buttons/modals vs v13 text commands). The main architectural gap is the lack of event-driven notifications and automated alerts. The main code-quality gap is the lack of tests and type hints.

**Recommended next steps:**
1. Add a simple event listener for crash/startup/update alerts (high ROI, medium effort).
2. Add unit tests for critical handlers (high confidence, medium effort).
3. Add JSDoc and extract magic strings into constants (low risk, improves maintainability).

Both codebases are production-ready, but Citadel would benefit from better testability and autonomous alerting to match the reference's resilience patterns.



## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Event-driven server-status notifications | ref_has_current_lacks | high | medium | Reference has dedicated DiscordEventConverter that subscribes to internal events (game updates, server state changes, mod updates) and broadcasts formatted Discord messages automatically. Current codebase has no equivalent event listener; status/feeds are only query-based (on-demand button clicks). Missing automatic notifications for crash detection, startup/shutdown, update completion. |
| Message queueing and readiness buffering | ref_has_current_lacks | medium | small | Reference queues outbound Discord messages until bot is ready (sendQueuedMessage with 1000ms delay after onReady), preventing race conditions during startup. Current codebase sends immediately without ready-state buffering, risking dropped messages during rapid startup sequences. |
| Dependency injection and service lifecycle | ref_has_current_lacks | low | large | Reference uses tsyringe for dependency injection, decoupling services, enabling testability, and centralizing config. Current uses static requires and module-level state, making unit testing harder and dependency graphs implicit. |
| Type safety and TypeScript | ref_has_current_lacks | low | large | Reference is fully typed (Request, RequestTemplate, DiscordMessage interfaces). Current is untyped JavaScript. This is a tradeoff: reference catches errors at compile time but requires build step; current is faster to iterate but riskier in production. |
| Legacy text command syntax (!prefix) | current_has_ref_lacks | medium | trivial | Reference supports both legacy `!command` text commands and modern interactions. Current has migrated fully to Discord slash commands (ChatInputCommand) and button/modal interactions. Modern approach is better aligned with current Discord best practices (no longer raw message handling). |
| Slash command + button/modal/select UI | current_has_ref_lacks | high | trivial | Reference has no button or modal handlers (discord.js v13). Current has comprehensive slash-command + interactive component system (v14) with modals, select menus, buttons, and a full control panel UI. |
| Audit-layer HMAC signing | current_has_ref_lacks | high | trivial | Current includes signCall() in api.js that signs each backend call with HMAC-SHA256 (payload = `ts.action.userId`), sent as X-Discord-Ts and X-Discord-Sig headers. Backend can verify user attribution and replay-window. Reference has no equivalent audit layer. |
| Tiered rate limiting | current_has_ref_lacks | high | trivial | Current has sophisticated per-user, per-action cooldown system with three tiers (query 3s, admin 10s, control 30s) and automatic tier assignment. Reference has no visible cooldown/rate limiting. |
| Multi-server guild context | current_has_ref_lacks | medium | trivial | Current supports per-guild server selection (selectedServers map) and passes guildId to panelAction() for context-aware responses. Reference has no multi-server awareness visible in Discord integration. |
| Comprehensive input validation and sanitization | current_has_ref_lacks | medium | trivial | Current has utils/sanitize.js with escapeMarkdown(), isValidSteam64(), isValidCoordinate(), isValidWorkshopId() validators. Handlers validate before calling backend. Reference uses simpler parsing without rich validation. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Add event listener for server state changes and broadcast notifications | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/` | high | medium | medium | Create handlers/eventListener.js that subscribes to server events (via a WebSocket or polling adapter to the backend) and broadcasts formatted embeds to a configured notification channel. Useful for crash detection, startup/shutdown, update completion. Reduces user manual checks and improves transparency. |
| Implement message queueing and ready-state buffering in bot.js | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/bot.js` | medium | small | low | Add a msgQueue array and defer outbound messages until client.readyAt is set. Call a flushQueue() function after client.once(Events.ClientReady). This prevents race conditions and lost messages during startup. |
| Consolidate cooldown checking into a middleware pattern | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/handlers/buttons.js, handlers/modals.js, commands/` | medium | small | low | Extract the adminGate() pattern from buttons.js into a reusable middleware/decorator (or a checkAndEnforce() function) that can be called consistently across all handlers. Current duplication of isAdmin() + checkCooldown() + setCooldown() calls increases bugs if one spot is missed. |
| Add structured error logging with request tracing | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/api.js, lib/logger.js` | medium | small | low | Enrich panelAction() errors with request ID (UUID) and user context, logged alongside the error. Helps debug which user action caused a backend failure. Current logging is minimal. |
| Add JSDoc type hints for better IDE support without TypeScript | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/api.js, handlers/*.js, commands/*.js` | low | small | low | Add JSDoc @param and @returns comments (e.g., `@param {Interaction} interaction`, `@returns {Promise<EmbedBuilder>}`). Enables VS Code autocomplete and type checking without a build step, improving dev experience. |
| Add unit tests for critical handlers (buttons, modals, commands) | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/__tests__/` | medium | medium | low | Create simple Jest tests for buttons.js, modals.js, and a sample command. Mock discord.js interactions and panelAction(). Reference has discord-message-handler.test.ts as precedent. Current has zero tests. |
| Validate interaction.user and role existence before use | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/utils/permissions.js, bot.js` | high | small | medium | In isAdmin(), check if interaction.member exists and interaction.member.roles exists before calling cache.has(). Add null guards. Same for interaction.user in api.js signCall(). Current code will crash if user object is malformed. |
| Extract magic strings (customIds, action names) into constants | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/handlers/buttons.js, selectMenus.js, modals.js, ui/components.js` | medium | small | low | Create ui/constants.js with BUTTON_IDS, MODAL_IDS, ACTION_NAMES enums. Replace inline strings like 'panel_status', 'modal_broadcast' with constants. Reduces typo-related bugs and improves refactorability. |
| Add retry logic with exponential backoff to panelAction() | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/api.js` | low | small | low | Current fetchWithRetry() only retries on 5xx once. For better resilience, use exponential backoff (e.g., 200ms, 500ms, 1000ms) for a configurable max attempts. Helps with transient backend failures. |
| Implement graceful degradation for missing config values | `/Users/sk3tch/Documents/GitHub/DayzServerController/discord-bot/config.js, bot.js` | low | small | medium | If DISCORD_BOT_API_KEY is missing, log a warning and allow the bot to start in read-only mode (disable admin actions). Current exits immediately. This improves dev experience (can run locally without full .env). |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Implement event-driven server notifications (crash detection, startup alerts) | high | medium | medium | Reference's DiscordEventConverter shows a clean pattern: subscribe to internal events and emit Discord messages automatically. Current codebase is purely query-based (users must click buttons to see status). Adding a simple event listener (WebSocket or polling) that broadcasts to a notification channel would dramatically improve operator awareness without increasing user interaction friction. High ROI for server reliability ops. |
| Migrate to TypeScript for type safety and IDE support | low | large | low | Reference's TypeScript + tsyringe setup provides compile-time error catching, better refactoring, and self-documenting code. Current JS setup is faster to iterate but riskier at scale. If Citadel is a mission-critical product, the safety ROI justifies the build-step overhead. Can be done incrementally (new files in TS, gradual migration). |
| Add comprehensive test suite (unit + integration) | high | medium | low | Reference has discord-message-handler.test.ts. Current has zero tests. Given the number of button/modal handlers and the user-facing attack surface (untrusted input from players), tests would catch regressions and validate sanitization logic. Jest + discord.js mock is straightforward. |
| Extract handler logic into a dispatch registry with validation middleware | medium | small | low | Current buttons.js, modals.js, selectMenus.js all manually dispatch on customId. Consolidating into a single registry with composable middleware (auth, cooldown, logging) would reduce duplication and make it harder to forget permission checks. |
| Add detailed request tracing and error context to panelAction() | medium | small | low | When a user action fails, it's hard to debug without seeing the backend request/response. Adding request IDs, user context, and better error enrichment (what endpoint, what params) would make ops/support triage easier. |
| Document the HMAC audit layer and versioning strategy | low | trivial | low | Current api.js signCall() is sophisticated (audit L2 with replay window) but has no inline comments explaining the threat model. Adding clear docs (why HMAC, replay window rationale, header format) helps future maintainers and supports security audits. |
| Add JSDoc type hints and migrate toward strict mode | medium | small | low | Current code lacks type hints, making IDE support poor and refactoring risky. JSDoc comments cost little but unlock autocomplete, parameter hints, and type checking via VS Code. A step toward TypeScript without the full commitment. |
| Implement per-guild audit log subscriptions | medium | medium | low | HMAC signing proves WHO called an action, but there's no persistent record of WHAT actions were called. Storing action calls in a local audit log (SQLite or JSON file per guild) would support compliance, security reviews, and user issue triage. |

