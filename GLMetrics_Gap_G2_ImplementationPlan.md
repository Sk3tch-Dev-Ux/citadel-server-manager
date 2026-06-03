# Implementation Plan — G2: Mod self-sufficiency (direct mod→cloud)

> Companion to `GLMetrics_vs_Citadel_GapAnalysis.md` (gap **G2**) and the capability matrix
> (§F2). The strategic item: let `@CitadelAdmin` talk to the Citadel cloud **directly over HTTP**,
> with no local Agent — so Citadel reaches the **rented-host** market (Nitrado/GPORTAL) the way
> GLMetrics does. Spans mod (Enforce, unverifiable here), cloud (TypeScript), and onboarding.
>
> Status: **Decisions LOCKED 2026-06-02. Building cloud Phase 1.** (See *Decisions* below.)

## Why

Both products run a server-side mod. The difference is reach: **GLMetrics' mod POSTs straight to
their cloud** (`ApiConnection.c` → `GetRestApi().GetRestContext()`), so it installs via the host's
workshop manager on a rented box with **no extra process**. Citadel's mod writes files that the
**Agent** (a separate Windows process) bridges to the cloud — which can't run on a managed host.
G2 gives the mod an optional direct path so the largest segment of DayZ owners (renters) can use
Citadel for telemetry + remote admin. The full Agent stays the premium tier for self-hosters
(it's the only thing that can also start/stop/back-up/patch the server).

## Architecture

```
 AGENT MODE (today, self-host):   mod → $profile files → Citadel Agent → WebSocket → cloud sink
 DIRECT MODE (G2, rented host):   mod → HTTP POST (RestApi) ───────────────────────→ cloud HTTP ingest
                                  mod ← commands in the POST response ←──────────────── cloud command queue
```

Enforce Script's `RestApi` is **HTTP request/response only** (no WebSocket), so direct mode needs
a **new HTTP ingestion surface** on the cloud, parallel to the existing plugin-WS. The mod batches
telemetry and POSTs it; the **POST response carries any pending commands** (one round-trip, like
GLMetrics' action-in-response); the mod executes them via the existing `CitadelCommandRunner` and
POSTs results.

## Decisions (LOCKED 2026-06-02)

- **D2 = commands in the ingest response** (1 round-trip; results via `POST /commands/:id/result`).
- **D4 = auto + cloud guard** (mod direct-mode iff `cloud.json` present; cloud refuses HTTP ingest
  while a live WS exists for that server).
- **D1, D3, D5, D6 = as recommended below.**

## Decisions detail (with recommendations)

- **D1 — Ingestion transport:** new **HTTP batch-ingest** endpoint that accepts an array of the
  same `PluginToCloudMessage` shapes and reuses `sinkPluginMessage`. *(Recommended; one endpoint,
  zero new persistence code.)*
- **D2 — Command delivery:** the **ingest POST response returns queued commands** (1 round-trip);
  results go back via a small `POST /commands/:id/result`. *(Recommended over a separate poll loop
  or long-poll — fewer requests, simplest in Enforce.)*
- **D3 — Auth:** reuse the existing per-server **plugin API key** (issued by `plugin-servers`).
  Operator pastes it into the mod's `$profile:Citadel/cloud.json` (`{ endpoint, apiKey }`); the mod
  sends it as a Bearer header; the cloud resolves key→server exactly like the WS `auth` does today.
- **D4 — Mode selection (no double-ingest):** the mod runs **direct mode iff `cloud.json` is
  present**, otherwise file-IPC/agent mode (unchanged). Don't run both for one server. Cloud-side
  guard: reject HTTP ingest for a server that currently has a live WS (and vice-versa) to be safe.
- **D5 — Telemetry scope:** same topics as the agent forwards (metrics, positions, kills, hits,
  chat, connect/disconnect, playerStats, vehicles, world_events) — the mod already produces all of
  it; direct mode just serializes + POSTs instead of writing files.
- **D6 — Commands scope:** reuse `CitadelCommandRunner` to execute; reuse the cloud command queue +
  `command_result` path. No new command semantics.

## Phased build

### Phase 1 — Cloud HTTP ingest surface  `[cloud, TypeScript]` — ✅ DONE 2026-06-02
- [x] `POST /api/v1/plugin/ingest` — Bearer plugin-key auth (reuses `authenticatePlugin`) → resolve
      server. Body `{ messages }`; loops `sinkPluginMessage`. Response `{ ok, commands }` drained
      from the server's queue (D2). (`plugin-ingest.routes.ts`)
- [x] `POST /api/v1/plugin/commands/:id/result` — Bearer auth; body `{ success, message }` →
      `resolveHttpCommand(id, …)`. (`plugin-ingest.routes.ts`)
- [x] **HTTP command queue** (`plugin-http-queue.ts`) — per-server queue + id→promise correlation +
      an HTTP-active registry; `enqueueHttpCommand` / `drainHttpCommands` / `resolveHttpCommand` /
      `markHttpActive` / `isHttpActive`. `dispatchCommand` now routes to the queue for direct-mode
      servers (no WS but recently-ingested), WS otherwise.
- [x] Coexistence guard (D4): ingest returns **409 Conflict** while a live WS owns the server.
- [x] Registered a `/plugin` scope in `app.ts` (120/min); all cloud packages type-check.

> **Build status:** Phase 1 verified by `tsc --noEmit` (shared/api/web all clean). In-process /
> single-node, same assumption as the existing WS dispatcher (documented). **Single-node caveat:**
> if the API is sharded, the HTTP queue + WS registry must be made sticky-by-serverId or fanned out
> via Redis — same limitation the WS path already has. Phases 2–3 (mod client + onboarding) need a
> real DayZ host to validate.

### Phase 2 — Mod direct-mode client  `[mod, Enforce]` — ✅ WRITTEN 2026-06-02 (needs host validation)
**Design refinement:** to minimise unverifiable Enforce, the **mod posts its RAW telemetry files**
(already valid JSON) and the **cloud translates** (`mod-telemetry-translate.ts`, ported from the
agent forwarder, **type-checked**). The mod does no per-topic serialization.
- [x] **Cloud (verifiable):** `mod-telemetry-translate.ts` (events + metrics/positions/vehicles/
      world snapshots → wire messages); `/ingest` now accepts the raw mod payload, translates, sinks,
      returns queued commands; **API key in the body** (Enforce can't set headers) or Bearer. All
      cloud packages type-check.
- [x] **Mod:** `CitadelCloudClient.c` — reads `cloud.json`; `RestContext` POST to `/ingest` on a timer
      with events (drained from a new `CitadelEventLogger` direct buffer) + snapshot files; parses
      `commands` from the response and **writes them as `commands/<id>.cmd.json` so the existing
      `CitadelCommandRunner` executes them unchanged** (all 40+ actions reused); posts each
      `responses/<id>.res.json` back to `/commands/<id>/result`.
- [x] Mode gate: `CitadelCloudClient` is a **no-op unless `cloud.json` exists**; wired into
      `CitadelMissionServer.OnInit` next to the other subsystems. `CitadelEventLogger` gains a capped
      direct-egress buffer (`SetDirectMode`/`DrainDirectBuffer`).
- [ ] **Validate on a live rented host** (compile + a real POST round-trip + a command execute). The
      `.c` can't compile outside the DayZ toolchain.

### Phase 3 — Onboarding + hardening
- [ ] Dashboard: "Add server (no-agent / RCON+mod)" flow that issues a key and shows the
      `cloud.json` snippet to paste on the host.
- [ ] Docs for Nitrado/GPORTAL (install `@CitadelAdmin` via workshop, drop `cloud.json`).
- [ ] Live test on a real rented host; backpressure/retry on POST failures (offline buffer in the
      mod, like GLMetrics' killfeed store).

## Risks / notes
- **Double-ingest** is the main correctness risk — D4 mode gate + cloud guard handle it.
- **Command latency** = the ingest cadence (~3–5s). Fine for admin actions; document it.
- **Mod offline buffering**: POST failures should buffer (the mod already has the events.jsonl
  pattern); mirror the G1 durability mindset on the mod side.
- Phase 1 is fully verifiable (type-check). Phases 2–3 need a real DayZ host to validate.

## Status log
- 2026-06-02 — Plan drafted. Decisions D1–D6 proposed with recommendations.
- 2026-06-02 — Decisions locked (D2 = command-in-response, D4 = auto + cloud guard, build Phase 1 now).
  **Phase 1 (cloud HTTP ingest) built + type-checks clean:** `plugin-http-queue.ts`,
  `plugin-ingest.routes.ts`, `dispatchCommand` HTTP routing, `/plugin` scope in `app.ts`.
- 2026-06-02 — **Phase 2 built.** Cloud (verifiable): `mod-telemetry-translate.ts` (raw mod → wire,
  ported from the agent forwarder) + `/ingest` translates raw payloads + key-in-body auth — all cloud
  packages type-check. Mod (Enforce, needs host validation): `CitadelCloudClient.c` (read cloud.json →
  POST raw telemetry + bridge commands through the existing `CitadelCommandRunner` via `.cmd.json`/
  `.res.json`), `CitadelEventLogger` direct buffer, wired into `MissionServer.OnInit`. Next: **Phase 3
  onboarding** (issue key → cloud.json snippet, host docs, mod offline buffering) + live validation.
