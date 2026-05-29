# Domain Report: RCON / BattlEye integration

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

The reference implementation (dayz-server-manager v3.10.0) in TypeScript uses a sophisticated packet-oriented architecture with:

1. **Packet Structure** (`src/types/rcon.ts`, `src/services/rcon.ts` lines 22-173): Enum-based packet types (LOGIN=0, COMMAND=1, MESSAGE=2) with bidirectional packet direction tracking (REQUEST, RESPONSE, MULTI_PART_RESPONSE). Serialization includes CRC32 verification (using `buffer-crc32`), packet composition with 0xFF flag markers, and deserialization validation.

2. **Sequence Management** (lines 206-209): Array-indexed request tracking using 255-element arrays (`requests` and `multipart`) keyed by sequence number (0-255). Sequence numbers are deterministically managed (line 566). Multi-part responses are assembled via index-based lookup with completion detection (lines 675-712).

3. **Connection Lifecycle** (lines 285-312, 314-370): Explicit socket setup, login timeout enforcement (line 610-613), login packet validation. Reset logic (lines 314-370) cleans up all pending requests, intervals, and timeouts. Reconnection uses setTimeout with configurable `reconnectDelay` (default 1000ms).

4. **Keep-Alive** (lines 587-606): Dual timeout mechanism—monitors `lastResponse` time (30s timeout) and `lastCommand` time (10s interval). Empty command keepalive with acknowledgment tracking.

5. **Robustness**: Error handling on packet parsing (lines 656-667), checksum validation (line 78), duplicate message cache (lines 221-222, 761-769) with size-limited FIFO (3 entries). Commands fail gracefully if not connected (lines 627-629).

## How Citadel does it

The current implementation (Citadel) in JavaScript uses a connection-pooling approach in `backend/lib/rcon-client.js` with:

1. **Packet Structure** (lines 33-48): Simpler, imperative packet building. Manual CRC32 computation via lookup table (lines 11-21). Packet types are numeric (0x00=LOGIN, 0x01=COMMAND, 0x02=MESSAGE). No packet direction enum; handling is inline in message router (lines 59-91).

2. **Sequence Management** (lines 28, 44): Single `sequenceNum` counter with Map-based pending command tracking (`pendingCommands`). No multi-part response assembly—responses are expected single-packet (line 74 assumes `payload.slice(1).toString()`). No array indexing by sequence.

3. **Connection Lifecycle** (lines 50-109, 111-120): Promise-based connect() with early rejection via `settled` flag. Disconnect() clears pending commands and socket. Keepalive-triggered auto-reconnect (lines 131-146) on no-response or error.

4. **Keep-Alive** (lines 122-149): Single interval (15s, from constants) with reconnect logic. Checks for '[No response]' or '[Error]' string responses; triggers disconnect + 3s delay + reconnect.

5. **Robustness**: Inline error handling, try/catch guards around socket operations. Command timeout (5s) with promise resolution to '[No response]'. No checksum validation of received packets. Simpler but less defensive.

## Detailed analysis

# RCON / BattlEye Integration: Detailed Cross-Codebase Analysis

## Executive Summary

The reference implementation (dayz-server-manager v3.10.0) and Citadel's RCON client have fundamentally different architectural approaches. The reference uses a sophisticated packet-oriented state machine with defensive validation at every layer; Citadel uses a simpler connection-pooling model optimized for rapid development. The comparison reveals **one critical gap** (multi-part response assembly), **two high-priority improvements** (CRC validation, timeout monitoring), and one **strength in Citadel** (command validation whitelist).

## Architecture & Design Patterns

### Packet Handling

**Reference (rcon.ts, ~930 lines)**: Uses a formal `Packet` class (lines 49-173) with serialize/deserialize methods. Packet types are enums (`PacketType.LOGIN/COMMAND/MESSAGE`), directions are enums (`PacketDirection.REQUEST/RESPONSE/MULTI_PART_RESPONSE`). Each packet is validated, checksummed, and tracked with metadata (timestamp, sequence, sent count). Serialization is factory-like; deserialization throws on any protocol violation.

**Current (rcon-client.js, ~186 lines)**: Builds and parses packets imperatively. No packet class; packets are byte sequences. Message handler is a large switch on numeric type (lines 59-91). Simpler, more procedural, harder to extend.

**Impact**: Reference is more maintainable and testable (separate concerns); current is more compact but less explicit.

---

### Sequence & Queueing

**Reference**: Maintains two 255-element arrays indexed by sequence number (0-255, lines 208-209):
```typescript
private requests: (Packet | undefined)[] = new Array(255).fill(undefined);
private multipart: (Packet[] | undefined)[] = new Array(255).fill(undefined);
```
Each command packet reserves a slot. Multi-part responses buffer parts by index, detect completion when all slots filled. Sequence wraps at 256 (line 566).

**Current**: Uses a `Map` for pending commands (line 28):
```javascript
this.pendingCommands = new Map();
```
No multi-part support. Each command awaits a single-packet response.

**Critical Gap**: Large responses (e.g., `players` command with 50+ connected players, or `bans` with 100+ entries) are fragmented by BattlEye across multiple packets with a multi-part marker (bytes 3-5 = `[0x00, total, index]`). Reference reassembles; current truncates or loses data. **This is a silent data loss bug on large player/ban queries.**

---

### Connection Lifecycle

**Reference**:
1. `start()` checks if BattlEye is enabled in server config
2. Finds a free UDP port for listening
3. `setupConnection()` binds socket, emits 'listening'
4. Login packet sent, login timeout set (30s, line 610-613)
5. On login response, clear timeout, start keepalive
6. `reset()` cleans all state (requests, multipart, intervals, timeouts)
7. `reconnectTimeout` reschedules `setupConnection()` after delay (1000ms default)

**Current**:
1. `connect()` creates socket, returns Promise
2. Sends login packet on bind
3. Sets `settled` flag to avoid race conditions
4. Promise resolves on login or rejects on timeout/error
5. `disconnect()` clears pending commands and closes socket
6. Keepalive triggers `disconnect() + setTimeout(connect, 3000)` on no-response

**Difference**: Reference uses explicit state machine (started, connected, loggedIn); current uses Promise-based flow. Reference's reset is more thorough (cleans 255 request slots); current's disconnect clears the Map. Both work, but reference is more robust to edge cases (e.g., login timeout while commands pending).

---

### Keep-Alive & Health Monitoring

**Reference**:
```typescript
if ((new Date().getTime() - this.lastResponse) > this.serverTimeoutTime) { // 30s
  this.reset();
  return;
}
if ((new Date().getTime() - this.lastCommand) > this.keepAliveIntervalTime) { // 10s
  void this.command('').then(...)
}
```
Two independent timers. Detects stale server (no response in 30s) and proactively sends keepalive (if no command in 10s). Keepalive is an empty command; server responds if alive.

**Current**:
```javascript
this.keepAliveInterval = setInterval(async () => {
  if (this.loggedIn && this.socket) {
    const result = await this.send('');
    if (result === '[No response]' || result.startsWith('[Error]')) {
      // reconnect...
    }
  }
}, RCON_KEEPALIVE_INTERVAL_MS); // 15s
```
Single interval. Sends empty command, checks for '[No response]' string. On fail, reconnects after 3s.

**Gap**: Current's keepalive only triggers if command sent in last 15s. If server goes silent but socket is open, it takes 15s + 5s (command timeout) + 3s (delay) = 23s to detect. Reference detects in 30s. More critically, current may miss a server that stops responding between keepalives—it only checks when keepalive times out.

---

### Validation & Robustness

**Reference**:
- Checksum validation on inbound: `if (checksum !== crc) throw Error` (line 78)
- Packet structure validation: 0xFF flag, packet type enum checks (lines 82-114)
- Sequence bounds: `readUInt8()` ensures 0-255 (line 96)
- Duplicate message deduplication with FIFO cache (lines 761-769)
- Graceful fail-safe if not connected: returns `null` immediately (line 629)

**Current**:
- No checksum validation on inbound packets
- Assumes packet structure; does not validate 0xFF marker or packet type range
- No deduplication
- Auto-reconnect on `send()` if not logged in (line 154), which can hide transient issues

**Implication**: Current is more lenient (fewer validation errors, but can hide corruption). Reference is more defensive (fail fast on bad data).

---

## Security Considerations

**Reference**: No input validation. Trusts caller to send safe commands. Would require application-layer validation (e.g., in API route handlers).

**Current**: Comprehensive whitelist in `rcon-validator.js` (67+ allowed commands, pattern matching, custom validators). Routes use `validateCommand()` before calling RCON. Discord bot should also validate. **This is a significant security advantage over reference.** Whitelist approach prevents command injection (e.g., `say -1 ; #shutdown`).

---

## Code Quality & Test Coverage

**Reference**: 
- Includes unit tests (rcon.test.ts, ~150 lines, testing packet serialization, socket lifecycle, login flow)
- TypeScript with strict typing
- Dependency injection (tsyringe) for testability
- Logging with levels (DEBUG, WARN, ERROR, IMPORTANT)

**Current**:
- No dedicated RCON tests
- Plain JavaScript, dynamic typing
- No DI; depends on context globals
- Logging via pino (structured logs with metadata)

**Implication**: Reference is more maintainable for changes; current is easier to understand at a glance but harder to refactor safely.

---

## Citadel-Specific Strengths

1. **Command validation whitelist**: Citadel's rcon-validator.js is superior to reference for security. Whitelist + pattern matching + custom validators is production-grade defense.

2. **FPS/metrics extraction**: Citadel extracts "Server FPS" from messages (rcon-client.js line 86-87) and emits via Socket.io. Reference doesn't expose this metric.

3. **Audit trail**: Routes layer (rcon-players.routes.js lines 35, 43) log all RCON commands to audit log with user/action/timestamp. Reference has no audit integration.

4. **Per-server configuration**: Routes layer checks server state before executing commands (line 27). Reference assumes single server.

5. **Ban engine integration**: Citadel's ban system (banPlayer, listBans, removeBan) is global and orchestrates RCON + local persistence. Reference only does RCON.

---

## Critical Findings

### 1. Multi-Part Response Assembly (CRITICAL BUG)

**Symptom**: Large `players` or `bans` commands may fail silently or return truncated data.

**Root Cause** (rcon-client.js): No support for multi-part packets. When BattlEye sends a response larger than ~512 bytes, it fragments it:
- Part 1: `[BE][CRC][0xFF][0x01][seq][0x00][total=3][index=0][data...]`
- Part 2: `[BE][CRC][0xFF][0x01][seq][0x00][total=3][index=1][data...]`
- Part 3: `[BE][CRC][0xFF][0x01][seq][0x00][total=3][index=2][data...]`

Current code sees `msg[6] === 0x01` (COMMAND) and tries to read `payload.slice(1).toString()` (line 74), which is only the first fragment. Subsequent fragments are either dropped or mishandled.

**Evidence**: Reference has 38 lines of assembly logic (lines 675-712). Current has zero.

**Fix**: Add a `_multipartBuffer` Map or object to buffer incomplete parts. On receipt of a packet with `payload[3] === 0x00` (multi-part flag), extract total and index, buffer the part, and reassemble when all parts arrive.

### 2. No CRC32 Validation on Inbound (HIGH PRIORITY)

**Impact**: Corrupted packets are accepted silently.

**Current** (rcon-client.js): No validation of CRC32 header field against payload.

**Reference** (rcon.ts line 75-80):
```typescript
const checksum = buffer.readInt32BE(2);
const crc = crc32(payload).readInt32LE(0);
if (checksum !== crc) throw new Error('Packet checksum verification failed.')
```

**Fix**: On message receipt (line 59), extract header CRC (bytes 2-5), compute CRC of payload (bytes 7+), compare. Reject if mismatch.

### 3. Response Timeout Independent of Keepalive (HIGH PRIORITY)

**Gap**: Current code only reconnects if keepalive times out (15s) AND times out again (5s). Reference detects server stall in 30s flat.

**Fix**: Track `this.lastResponse = Date.now()` on each inbound message (line 59). In keepalive loop, check `(now - this.lastResponse) > 30000` and reconnect if true. Catches stuck servers faster.

---

## Recommendations Prioritized

| Rank | Item | Effort | Risk | Impact |
|------|------|--------|------|--------|
| 1 | **Multi-part assembly** | Medium | Medium | Critical—fixes silent data loss |
| 2 | **CRC validation** | Small | Low | High—prevents corruption |
| 3 | **Response timeout** | Small | Low | High—faster stale detection |
| 4 | **Deduplication** | Trivial | Low | Low—reduces log spam |
| 5 | **Refactor validator consistency** | Small | Low | Medium—security hardening |

All recommendations are backwards-compatible and carry low to medium risk.

## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Multi-part packet assembly | ref_has_current_lacks | high | medium | Reference implements full multi-part response handling with packet buffering by index and completion detection (lines 675-712 in rcon.ts). Current implementation has no multi-part support—assumes all responses fit in a single packet. BattlEye can fragment large responses (e.g. player lists, ban lists) across multiple packets. |
| Inbound packet validation (CRC32) | ref_has_current_lacks | medium | small | Reference validates CRC32 on inbound packets (rcon.ts line 78, comparing checksum to crc32(payload)). Current implementation does not validate packet checksums—it assumes received packets are valid. This could hide corruption or spoofed packets. |
| Duplicate message deduplication | ref_has_current_lacks | low | trivial | Reference tracks last 3 server messages (rcon.ts lines 221-222, 761-769) to filter duplicates. Current does not. Server may emit the same message multiple times; deduplication reduces noise. |
| Timeout-based connection monitoring | ref_has_current_lacks | medium | small | Reference uses two-tier timeout: server response timeout (30s, line 199) and command interval (10s, line 198) with keepalive. Current uses only keepalive interval (15s). Reference detects stale connections faster if server stops responding. |
| Explicit login timeout handling | ref_has_current_lacks | low | trivial | Reference sets a dedicated login timeout (30s, line 610-613) that clears on successful login. Current has a general RCON_LOGIN_TIMEOUT_MS but relies on overall connect promise rejection. Reference is more surgical. |
| Packet direction enums | both_have_current_weaker | low | trivial | Reference uses PacketDirection enum (lines 29-33) for explicit control flow (REQUEST, RESPONSE, MULTI_PART_RESPONSE). Current infers direction from numeric type in message handler. Enum-based is self-documenting. |
| Command validation whitelist (security) | current_has_ref_lacks | high | large | Current has comprehensive whitelist in rcon-validator.js (67-154) with pattern matching and custom validators. Reference does NOT validate commands—trusts the caller. Citadel's approach is more secure for untrusted input. |
| RCON message routing to WebSocket/EventBus | both_have_current_better | low | trivial | Current emits server messages (FPS, etc.) via Socket.io (rcon-client.js line 88). Reference emits via EventBus to Discord (rcon.ts line 772). Both have event systems but Citadel's is more direct; reference's is more decoupled. |
| Array-indexed request queueing vs Map | both_have_current_weaker | low | trivial | Reference uses 255-element arrays indexed by sequence (rcon.ts line 208). Current uses a Map. Array is O(1) lookup; Map is O(1) with overhead. Both work, array is slightly more efficient for 0-255 key space. |
| Graceful command failure on not-logged-in | both_have_current_weaker | low | trivial | Reference returns null immediately if not connected (rcon.ts line 627-629). Current auto-reconnects on send() if not logged in (rcon-client.js line 154), which can hide transient disconnects. Reference's eager fail is more transparent. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Add multi-part response assembly for large commands | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/rcon-client.js` | high | medium | medium | Current code assumes all responses fit in one packet. Large outputs (player lists, ban lists) may arrive fragmented. Add a `_multipartBuffer` Map keyed by sequence to buffer incomplete parts. On receipt of multi-part marker (0x00 flag in bytes 3-5), store part, check if all received, and concatenate. |
| Validate CRC32 on inbound packets | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/rcon-client.js` | medium | small | low | Add checksum validation on received packets (similar to reference rcon.ts line 75-80). Read CRC from header bytes 2-6, compute CRC of payload (bytes 7+), compare. Reject packet if mismatch. Current code trusts all received data. |
| Add duplicate message deduplication cache | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/rcon-client.js` | low | trivial | low | Implement a small FIFO cache (3-5 messages) to filter repeated server messages (e.g. FPS reports). Skip emitting/logging if message is in cache. Reference rcon.ts lines 221-222, 761-769 for pattern. Reduces log spam. |
| Add explicit server response timeout (separate from keepalive) | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/rcon-client.js` | medium | small | low | Track `lastResponse` timestamp. In keepalive interval, check if (now - lastResponse) > threshold (e.g. 30s). If so, force disconnect + reconnect. Current relies only on command timeout. This catches stuck servers faster. |
| Refactor socket message handler to use packet type enums | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/rcon-client.js` | low | trivial | low | Replace numeric switch on `type = msg[6]` with enum-based constants (PACKET_TYPE_LOGIN=0, etc.) for readability. Not a bug fix, but matches reference's pattern and is self-documenting. |
| Add defensive checks for null/undefined sequence in pending lookup | `/Users/sk3tch/Documents/GitHub/DayzServerController/backend/lib/rcon-client.js` | low | trivial | low | Line 75 does `this.pendingCommands.get(seq)` without validating seq is in range [0, 255]. Add guard to ensure seq is a valid integer before lookup, similar to reference line 568 check. |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Implement multi-part response assembly for large player/ban lists | critical | medium | medium | BattlEye fragments responses > ~512 bytes across multiple packets. Current code will corrupt or lose data on large player/ban list queries. Reference demonstrates working assembly (rcon.ts lines 675-712). This is a correctness bug with high user impact (silent data loss). |
| Add inbound packet CRC32 validation | high | small | low | Current code trusts all received packets without validation. Network glitches or spoofing could corrupt RCON data. Reference validates every inbound packet (rcon.ts line 78). Low cost, high confidence fix. |
| Implement response timeout independent of keepalive | high | small | low | Current code only checks for command-level timeout (5s). If server hangs but keeps sending keepalive acks, connection stays 'alive' indefinitely. Reference tracks `lastResponse` time (30s threshold, rcon.ts line 590-593). Detects stuck servers faster and triggers reconnect. |
| Refactor command validation to be consistent across routes | medium | small | low | Current rcon-validator.js is solid but only applied at routes layer. Reference applies packet-level validation. Ensure all RCON commands (via routes, Discord bot, internal) go through validateCommand() before sending. Reduce duplication between rcon-players.routes.js and rcon-validator.js. |
| Add sequence number wraparound test coverage | medium | small | low | Both codebases use sequence % 256. Current code (line 44) and reference (line 566) both handle wraparound, but there are no tests for edge cases (e.g. seq 254->255->0 transitions, collision during rapid commands). Add test cases. |
| Document RCON protocol version and compatibility | low | trivial | low | No comments in either codebase explaining which BattlEye RCON version is supported. Reference has minimal docs (enums, no protocol notes). Citadel should document: packet format, version constraints, known protocol limits (max response size, etc.). |

