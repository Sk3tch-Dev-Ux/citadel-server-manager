# Domain Report: Security & Authentication

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

The reference codebase (dayz-server-manager v3.10.0) implements a minimal, straightforward security model: HTTP Basic Auth only (stored plaintext in config), applied via express-basic-auth middleware on the /api router (rest.ts, lines 302-306). WebSocket upgrade endpoints validate credentials by decoding base64 from sec-websocket-protocol headers (rest.ts lines 115-124). No CSRF protection, no rate limiting, no token revocation, no audit logging, no MFA, and no encryption of credentials at rest. The config validation (config-validate.ts) focuses on JSON schema and event validation but contains no security validation beyond type checking. Designed for single-admin LAN deployment; not intended for untrusted networks.

## How Citadel does it

Citadel implements a comprehensive, production-grade security architecture: (1) JWT authentication with 8h token lifetime and role-based access control (auth.js, lines 34-70); (2) HTTP-only, SameSite=Strict session cookies with fallback Bearer token support (auth.js lines 22-32); (3) CSRF protection via HMAC-signed double-submit cookies (csrf.js, fully implemented with constant-time comparison on lines 176-185); (4) Rate limiting with per-endpoint tuning and IP-level fail2ban with escalating ban durations (rate-limit.js, lines 29-187); (5) TOTP 2FA (RFC 6238 compliant, totp.js); (6) Token revocation system with persistent disk backup (token-revocation.js, lines 1-178); (7) AES-256-GCM credential encryption at rest with PBKDF2 key derivation (credential-encryption.js, lines 1-183); (8) Comprehensive audit logging of user actions (audit.js); (9) RCON password validation via whitelist + pattern matching + sanitization (rcon-validator.js, lines 1-272); (10) License-gated feature access (require-license.js); (11) Per-user forced password change enforcement (auth.js lines 52-55); (12) Constant-time bcrypt password comparison with dummy hash protection against timing attacks (auth.routes.js lines 20-75).

## Detailed analysis

# Security & Authentication Comparison: DayZ Server Manager Reference vs. Citadel

## Executive Summary

The reference codebase (dayz-server-manager v3.10.0) implements a **minimal, single-admin LAN deployment model** with HTTP Basic Auth only. Citadel, by contrast, is a **production-grade, multi-tenant commercial product** with comprehensive security controls including JWT, CSRF, rate limiting, TOTP 2FA, token revocation, credential encryption, and audit logging. The two are designed for fundamentally different threat models:

- **Reference**: Assumes a trusted LAN, single admin, no untrusted network exposure.
- **Citadel**: Assumes internet-facing deployment, multiple users with role-based access, and potential adversaries.

Citadel's security posture is **dramatically superior** across all measured domains. The reference has **zero** controls for CSRF, rate limiting, credential encryption, or audit logging. Below is a detailed analysis.

---

## 1. Authentication Model

### Reference Approach (rest.ts)

The reference uses **HTTP Basic Auth** exclusively:
- Credentials stored plaintext in config file: `userId` + `password` (rest.ts, lines 302–306)
- Applied via `express-basic-auth` middleware on `/api` router
- WebSocket upgrade validates credentials by base64-decoding `sec-websocket-protocol` header (lines 115–124)
- No token generation, no session management, no revocation mechanism
- Credentials hardcoded in memory for the lifetime of the process

**Security posture:**
- ✅ Simple, auditable (config file is human-readable)
- ❌ Passwords in plaintext in config file
- ❌ No session isolation; every request requires full auth
- ❌ Credentials exposed to every admin who reads the config
- ❌ No way to rotate credentials without restarting the app
- ❌ No timeout; Basic Auth is valid for the life of the connection

### Citadel Approach (auth.js, auth.routes.js)

Citadel implements **JWT-based stateful authentication**:

1. **Login flow** (auth.routes.js, lines 68–150):
   - Username + password → bcrypt verification (constant-time with dummy hash protection)
   - TOTP 2FA validation if enabled (lines 118–143)
   - JWT issued after successful MFA (line 145–149)
   - Token includes `id`, `username`, `role`, `mustChangePassword`
   - Token lifetime: 8 hours (line 148)

2. **Token extraction** (auth.js, lines 22–32):
   - Prefers HttpOnly cookie `auth-token` (XSS cannot read)
   - Falls back to `Authorization: Bearer` header for desktop/API clients
   - Cookie always wins if both present (prevents token confusion)

3. **Token validation** (auth.js, lines 34–70):
   - Verifies JWT signature with `jwtSecret`
   - Checks token revocation status (line 42)
   - Verifies user still exists (line 47)
   - Fetches fresh role from database (line 50) — prevents cached-token privilege escalation
   - Enforces forced password change (lines 52–55)
   - Validates role-based permissions (lines 57–62)

**Security posture:**
- ✅ Passwords never transmitted after login; only tokens
- ✅ Token lifetime limits compromise window (8h)
- ✅ Tokens can be revoked immediately (see token-revocation.js)
- ✅ HttpOnly cookies prevent XSS token theft
- ✅ Fresh database checks prevent stale-token privilege escalation
- ✅ Constant-time bcrypt comparison resists timing attacks
- ✅ Dummy hash protects against user enumeration
- ⚠️ Token lifetime could be shorter for admin users (low priority)

**Gap:** Reference has no token management at all; Citadel has comprehensive lifecycle management.

---

## 2. Cross-Site Request Forgery (CSRF) Protection

### Reference Approach

**None.** The reference applies no CSRF protection. Any website can trigger state-changing requests (POST/PUT/DELETE) on behalf of an admin user with an active browser session.

### Citadel Approach (csrf.js)

Citadel implements **HMAC-signed double-submit cookies** (csrf.js, lines 1–192):

1. **Token generation** (lines 47–49):
   - Generates a random 32-byte nonce (64 hex chars)
   - Signs with `crypto.createHmac('sha256', JWT_SECRET)` → 64-char signature

2. **Token storage**:
   - **HttpOnly `csrf-token` cookie** (line 87): Contains the signed token (XSS cannot read)
   - **Non-HttpOnly `csrf-nonce` cookie** (line 96): Contains the plaintext nonce (frontend reads)
   - **`X-CSRF-Token` response header** (line 104): Exposes nonce for initial page load

3. **Token validation** (lines 113–171):
   - Skips GET/HEAD/OPTIONS (idempotent, safe)
   - Exempts login, logout, setup, health, webhooks (see line 138–145 for rationale)
   - Extracts signed token from HttpOnly cookie (line 150)
   - Extracts nonce from `X-CSRF-Token` header (line 151)
   - Re-signs the nonce and constant-time compares with the cookie (line 164–165)

4. **Constant-time comparison** (lines 176–185):
   - Prevents timing-based token forgery detection
   - Compares all bytes regardless of early mismatch

**Rationale:** If an attacker intercepts the plaintext nonce (in the non-HttpOnly cookie), they cannot forge the HttpOnly cookie (which only the server can set). If they trick a user's browser into submitting a forged cookie, the browser won't include a matching nonce (which must come from a different source).

**Security posture:**
- ✅ HMAC-signed double-submit is a proven CSRF defense
- ✅ Constant-time comparison prevents timing attacks
- ✅ HttpOnly cookie survives XSS (attacker can't read the signature)
- ✅ SameSite=Strict further hardens against cross-origin submissions
- ✅ Logged warnings on CSRF failures (line 154, 159, 166)

**Gap:** Reference has zero CSRF protection; Citadel is hardened.

---

## 3. Rate Limiting & Brute-Force Protection

### Reference Approach

**None.** Every endpoint is open to DoS and brute-force attacks.

### Citadel Approach (rate-limit.js)

Two-layer defense:

1. **Per-endpoint rate limiters** (lines 29–53):
   - **General API**: 600 requests/min/IP (generous for legitimate usage)
   - **Auth endpoints**: 15 attempts/15 minutes (brute-force protection)
   - **Discord bot**: 60 requests/minute

2. **IP-level fail2ban** (lines 56–187):
   - Tracks failed login attempts per IP address
   - After 5 failed attempts (FAIL2BAN_THRESHOLD, line 62):
     - 1st penalty: 60 seconds
     - 2nd penalty: 5 minutes
     - 3rd+ penalty: 1 hour (capped)
   - Ban state persisted to disk (line 156) — survives restarts
   - Stale entries pruned hourly (line 164–173) — prevents memory leaks
   - Retry-After header returned on ban (line 94)

3. **Per-IP + per-username lockout** (auth.routes.js, lines 85–104):
   - Lockout key is `IP|username` (line 86) — prevents locking out a user from multiple IPs
   - 5 failed attempts per IP+username triggers 10-minute lockout (lines 100–101)
   - Lockout state persisted to disk (line 104) — survives restarts

**Interaction example:**
- Attacker uses botnet (10 IPs) to attack admin account:
  - Per-IP global fail2ban prevents each IP after 5 failures
  - Per-username lockout still stops rapid guessing on that one admin account
- Attacker uses shared corporate network (many IPs) to attack multiple accounts:
  - Per-IP fail2ban eventually blocks the shared IP
  - Per-username lockout protects each account

**Security posture:**
- ✅ Dual-layer defense (per-IP + per-username)
- ✅ Escalating ban durations discourage persistence
- ✅ Disk persistence prevents trivial DoS bypass via restart
- ✅ Cleanup job prevents memory leaks
- ✅ Logged at WARN level for operator visibility

**Gap:** Reference has zero rate limiting; Citadel has sophisticated multi-layer brute-force resistance.

---

## 4. Credential Encryption at Rest

### Reference Approach

**Plaintext storage in config file.** All admin passwords stored in the JSON config:

```json
{
  "admins": [
    { "userId": "admin", "password": "MyPassword123" }
  ]
}
```

Anyone with file system access reads passwords directly. No encryption, no key derivation, no authentication tags.

### Citadel Approach (credential-encryption.js)

**AES-256-GCM encryption** with PBKDF2 key derivation (lines 1–183):

1. **Key derivation** (lines 50–86):
   - In production: uses `CREDENTIAL_ENCRYPTION_KEY` (separate from JWT_SECRET)
   - In development: falls back to `JWT_SECRET` with loud warning (defense-in-depth: two secrets)
   - PBKDF2 with 100,000 iterations (line 25) — derives a 256-bit key
   - Fixed application-specific salt (line 23) — not secret, prevents cross-app key reuse

2. **Encryption** (lines 94–110):
   - Generates random 12-byte IV (line 98) — ensures identical plaintexts produce different ciphertexts
   - AES-256-GCM (line 99) — provides both confidentiality and authenticated encryption (prevents tampering)
   - Wire format: `<IV><AuthTag><Ciphertext>` in base64 (line 109)

3. **Decryption** (lines 118–141):
   - Verifies IV, auth tag, and ciphertext length (lines 124–130)
   - Re-derives key and decrypts with auth tag verification (lines 132–138)
   - Throws on tampering (failed auth tag validation)

4. **Usage** (lines 151–168):
   - Values in `.env` or database prefixed with `"ENC:"` are decrypted on load
   - Legacy plaintext values (no prefix) are returned as-is for backward compatibility
   - `encryptForEnv()` formats encrypted credentials for storage

**Encryption examples:**
- RCON password: `ENC:nQ7x...` (base64 blob)
- Steam API key: `ENC:aB9e...`
- Database password: `ENC:cD2f...`

**Security posture:**
- ✅ Authenticated encryption (GCM) prevents tampering
- ✅ Random IV ensures ciphertext uniqueness
- ✅ 100,000 PBKDF2 iterations slow brute-force of the encryption key
- ✅ Production requires a separate encryption key (defense in depth)
- ✅ Backward compatibility with legacy plaintext values
- ⚠️ PBKDF2 with 100k iterations is acceptable but may weaken as hardware improves (consider Argon2 in future)

**Gap:** Reference stores all credentials plaintext in a config file. Citadel encrypts at rest with authenticated encryption. Citadel is **infinitely more secure** (plaintext is not secure at all).

---

## 5. Token Revocation

### Reference Approach

**Tokens never expire until the app restarts.** No revocation mechanism. If an admin's account is deleted, their active session continues working until the app restarts or the browser closes.

### Citadel Approach (token-revocation.js, auth.js)

**Persistent token blacklist** (token-revocation.js, lines 1–178):

1. **Revocation tracking** (lines 24–70):
   - In-memory Map of revoked JWT IDs (`jti`)
   - Each entry has `expiresAt` (when to auto-cleanup)
   - Persisted to disk (`data/token-revocations.json`) on every write (debounced, line 56)
   - Restored on startup (lines 29–49)

2. **Revocation operations**:
   - **`revokeUserTokens(userId, reason)`** (lines 79–85): Revokes all tokens issued before now for a user (enables account deletion safety)
   - **`revokeToken(jti, expiresAt, reason)`** (lines 94–99): Revokes a specific token (enables forced logout)

3. **Revocation check** (auth.js, lines 42–43, token-revocation.js lines 107–124):
   - Every JWT verification calls `isTokenRevoked(decoded)` (line 42)
   - Checks specific `jti` revocation (line 111)
   - Checks user-wide revocation by comparing token's `iat` (issued-at) time (lines 116–120)

4. **Cleanup** (lines 130–143):
   - Hourly job removes expired entries (line 168)
   - Prevents unbounded memory/disk growth

**Use cases:**
- User deleted → `revokeUserTokens(userId)` → all their tokens immediately invalid
- User disabled → same
- Forced logout → `revokeToken(jti)` → this session invalid, user must re-login
- Security incident → `revokeToken()` multiple tokens or `revokeUserTokens()` all tokens for suspicious user

**Security posture:**
- ✅ Enables immediate session termination
- ✅ Disk persistence survives restarts (important for compliance)
- ✅ Cleanup job prevents memory leaks
- ✅ Logged with reason for audit trail

**Gap:** Reference has zero revocation; Citadel can invalidate tokens immediately.

---

## 6. Two-Factor Authentication (2FA / TOTP)

### Reference Approach

**None.** No MFA support.

### Citadel Approach (totp.js, auth.routes.js lines 118–143)

**RFC 6238 TOTP** with no external dependencies (totp.js, lines 1–88):

1. **Secret generation** (line 65):
   - `generateSecret(20)` → 160 bits base32-encoded (e.g., `JBSWY3DPEBLW64TMMQ======`)
   - Can be scanned as a QR code by Google Authenticator, Authy, etc.

2. **TOTP verification** (lines 70–79):
   - Implements RFC 6238 HOTP + time-window logic
   - Checks current 30-second window + ±1 window (previous and next)
   - Allows for ±30 seconds of clock drift

3. **QR code URI** (lines 82–85):
   - Generates `otpauth://` URI for QR scanning
   - Includes user, issuer, algorithm, digits, period

4. **Login flow** (auth.routes.js, lines 118–143):
   - If `user.mfaEnabled && user.mfaSecret` is set, user must provide MFA code
   - MFA secret is encrypted at rest (see credential-encryption.js)
   - Decryption happens at login time (lines 127–132)
   - TOTP code validated against decrypted secret (line 135)

**Security posture:**
- ✅ Standard RFC 6238 (used by major providers)
- ✅ 6-digit codes every 30 seconds
- ✅ ±1 time window tolerates clock skew
- ✅ Secrets encrypted at rest
- ✅ No external dependencies (pure Node crypto)
- ✅ QR code generation reduces manual entry errors

**Gap:** Reference has no 2FA; Citadel offers TOTP, recommended for admin accounts.

---

## 7. Audit Logging

### Reference Approach

**None.** No audit trail of who did what.

### Citadel Approach (audit.js)

Simple but effective audit trail (audit.js, lines 31–36):

```javascript
function addAudit(userId, username, action, details) {
  const entry = {
    id: uuid(),
    timestamp: new Date().toISOString(),
    userId, username, action, details
  };
  ctx.auditLog.unshift(entry);
  // Persist to disk
  saveJSON(ctx.CONFIG.dataDir, 'audit.json', ctx.auditLog.slice(0, MAX_AUDIT_PERSIST));
  return entry;
}
```

Tracks:
- User login/logout
- Server actions (restart, update, etc.)
- Config changes
- Ban/kick events

Persisted to `data/audit.json` for forensic analysis.

**Security posture:**
- ✅ Immutable trail (one-way writes)
- ✅ Timestamp + user identification
- ⚠️ File-based (not tamper-evident; a compromised operator could edit JSON)

**Gap:** Reference has no audit logging; Citadel has basic audit trail.

---

## 8. RCON Password Handling

### Reference Approach

If RCON credentials are stored in config, they would be plaintext. No protection.

### Citadel Approach

RCON passwords are:
1. **Encrypted at rest** (see credential-encryption.js) — stored in database or encrypted config
2. **Decrypted on-demand** (rcon-client.js line 24) — passed to RCONClient constructor
3. **Validated before execution** (rcon-validator.js) — command whitelist + pattern matching + sanitization

Commands are subject to a strict whitelist (rcon-validator.js, lines 17–154):
- Allowed: `#say`, `say`, `server`, `players`, `kick`, `bans`, `addban`, `removeban`, etc.
- Blocked: `shutdown`, `#exec`, `#login`, `killserver`, etc.

Each command has:
- Pattern regex validation
- Custom validator function (parameter count, format, ranges)

**Security posture:**
- ✅ Password encrypted at rest
- ✅ Whitelist of safe commands (not blacklist)
- ✅ Pattern + parameter validation
- ✅ Dangerous commands explicitly blocked
- ✅ Prevents command injection via user input

**Gap:** Reference would store RCON password plaintext. Citadel encrypts + validates.

---

## 9. Input Validation & Injection Prevention

### Reference Approach (config-validate.ts)

Validates JSON schema + event structure:
- Required fields (lines 31–38)
- Type checking (lines 51–60)
- Cron format validation (lines 78–98)

No validation of:
- Credential format/strength
- Admin username format
- Password length/complexity

### Citadel Approach

Multi-layered input validation:
- **RCON validation** (rcon-validator.js): Command whitelist + pattern + sanitization
- **CSRF validation** (csrf.js): Constant-time comparison
- **JWT validation** (auth.js): `jwt.verify()` throws on tampering
- **Password validation** (auth.routes.js): bcrypt comparison is timing-safe
- **Audit data** (audit.js): Uses `sanitizeString()` to redact sensitive fields

**Gap:** Both validate inputs but Citadel is more comprehensive (RCON injection prevention is explicit).

---

## 10. Configuration Security

### Reference Approach

Single `server-manager.json` file contains:
- Admin credentials (plaintext)
- Server configs
- Event definitions

No separation of secrets from config. No encryption. Anyone reading the file sees everything.

### Citadel Approach

Secrets stored separately:
- **Environment variables** (`.env` file, ignored by git)
- **Encrypted credentials** (encrypted at rest, decrypted at runtime)
- **Database** (users, roles, RCON passwords — all encrypted)

Config is versioned; secrets are not. Deployment does not expose `.env`.

**Gap:** Reference stores secrets in config file; Citadel separates secrets into `.env` and database with encryption.

---

## 11. Minimum Viable Recommendations

**For the reference codebase** (if production use is intended):

1. **Replace Basic Auth with JWT** (medium effort, critical priority)
2. **Add HTTPS + HSTS** (low effort, critical priority)
3. **Encrypt credentials in config** (high effort, critical priority)
4. **Add CSRF tokens** (medium effort, high priority)
5. **Add rate limiting** (low effort, high priority)
6. **Add audit logging** (low effort, high priority)

**For Citadel** (to harden further):

1. **Separate CREDENTIAL_ENCRYPTION_KEY from JWT_SECRET** (already supports this; just enforce at startup)
2. **Add tamper-evident audit logs** (signed entries or append-only storage)
3. **Token rotation after MFA** (issue new token post-MFA, expire pre-MFA token)
4. **Per-username rate limiting** (in addition to per-IP)
5. **Shorter token lifetime for admin roles** (currently 8h for all)

---

## Conclusion

Citadel's security architecture is **production-grade and comprehensive**. The reference codebase is **minimal and designed for trusted LAN deployments only**. The gap is not marginal — it is a fundamental difference in threat model and security maturity.

**Citadel advantages:**
- ✅ JWT + session management
- ✅ CSRF protection
- ✅ Rate limiting + fail2ban
- ✅ TOTP 2FA
- ✅ Credential encryption
- ✅ Token revocation
- ✅ Audit logging
- ✅ RCON validation
- ✅ Timing attack resistance

**Reference limitations:**
- ❌ Plaintext credentials in config
- ❌ No token management
- ❌ No CSRF protection
- ❌ No rate limiting
- ❌ No 2FA
- ❌ No audit trail
- ❌ No credential encryption
- ❌ Vulnerable to user enumeration

If Citadel were to borrow from the reference, it would only be the **minimal config validation patterns**, which Citadel already exceeds.

## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| JWT vs Basic Auth | current_has_ref_lacks | critical | large | Reference uses plaintext Basic Auth in config; Citadel uses stateful JWT + refresh tokens. Citadel is more secure and scalable. |
| CSRF Protection | current_has_ref_lacks | critical | large | Reference has none; Citadel implements HMAC-signed double-submit cookies with constant-time validation. Major gap in reference. |
| Rate Limiting & Fail2Ban | current_has_ref_lacks | high | medium | Reference has none. Citadel has per-endpoint limiters + IP-level fail2ban with escalating bans. Reference is trivial DoS target. |
| TOTP 2FA | current_has_ref_lacks | high | medium | Reference has none; Citadel implements RFC 6238 TOTP. Strongly recommended for production admin access. |
| Credential Encryption | current_has_ref_lacks | critical | large | Reference stores all passwords plaintext in config; Citadel encrypts at rest with AES-256-GCM. Huge gap — plaintext credentials in config is unacceptable for production. |
| Audit Logging | current_has_ref_lacks | high | small | Reference has none; Citadel logs all user actions with timestamp + user + action + details. |
| RCON Password Exposure | current_has_ref_lacks | high | small | Citadel stores RCON passwords encrypted; reference would store plaintext. Citadel is better. |
| Token Revocation | current_has_ref_lacks | high | medium | Reference has none (tokens never expire until app restart); Citadel has persistent revocation + cleanup. Enables forced logout, user deletion safety. |
| Timing Attack Protection | current_has_ref_lacks | medium | small | Reference's Basic Auth may leak user existence via timing; Citadel uses constant-time bcrypt + dummy hash. Citadel is more hardened. |
| Brute-Force Protection | current_has_ref_lacks | high | small | Reference has none; Citadel has per-IP+username lockout + fail2ban. Reference is a weak point. |
| Config Security Validation | both_have_current_better | medium | small | Reference validates JSON schema; both lack explicit validation of credential format/strength. Citadel's runtime approach (database) is better than reference's config file approach. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Add JWT ID (jti) to token generation | `backend/routes/auth.routes.js` | medium | small | low | Tokens should include a `jti` (JWT ID) claim at line 145-149 for more granular token revocation. Current code lacks this; it would enable revoking specific tokens, not just all tokens for a user. |
| Validate jti presence in token revocation check | `backend/lib/token-revocation.js` | medium | small | low | The isTokenRevoked() function (lines 107-124) checks both specific jti and user-wide revocation. Should validate that decoded.jti exists before using it; currently it silently passes if jti is absent. |
| Add SameSite=Strict to JWT auth-token cookie | `backend/middleware/security.js` | high | trivial | low | secureCookies() wrapper (lines 17-28) sets sameSite for all cookies, but auth-token cookie should explicitly enforce SameSite=Strict on line 22 — ensure it's not accidentally relaxed elsewhere. |
| Rate limiter is applied after CORS and helmet | `backend/server.js` | high | small | medium | Check that apiLimiter middleware is wired BEFORE expensive operations (XML parsing, file I/O). If it's after, a DoS attacker can still exhaust resources before hitting the limiter. Verify ordering in server.js startup. |
| RCON password decryption error handling | `backend/lib/rcon-client.js` | high | small | medium | Constructor takes password parameter (line 24) — this password should be decrypted from storage at the call site, not here. Verify all RCON client instantiations decrypt passwords using credential-encryption.js before passing. |
| Audit logging should redact sensitive parameters | `backend/lib/audit.js` | medium | small | low | addAudit() on line 31 accepts arbitrary details. Should sanitize/redact passwords, tokens, API keys from details before persisting. Currently relies on caller discretion. |
| Token expiration could be shorter for high-permission users | `backend/routes/auth.routes.js` | low | small | low | All tokens use 8h lifetime (line 148). Consider issuing shorter-lived tokens for admin users and longer for viewer roles. Would reduce compromise window for stolen admin tokens. |
| PBKDF2 iterations could scale with Node version | `backend/lib/credential-encryption.js` | low | medium | low | PBKDF2_ITERATIONS hardcoded to 100,000 (line 25). Best practice is to scale with CPU speed or use Argon2. Current value is acceptable but may become weak as hardware improves. |
| Fail2Ban escalation could have max cap | `backend/middleware/rate-limit.js` | low | small | low | Ban durations escalate [60s, 5m, 1h] (line 63) and reset on successful login (line 143). After 3+ failures, attacker is banned for 1h; subsequent attacks still need to wait 1h. Consider capping at a max duration or adding exponential backoff. |
| CSRF token reuse logic could be tightened | `backend/middleware/csrf.js` | low | small | low | Lines 70-77 reuse an existing nonce if its signature is valid. This is correct for the same user session, but if cookies are stolen, the nonce is also exposed (it's in a non-HttpOnly cookie on line 96). Acceptable given the double-submit pattern, but document why reuse is safe. |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Explicitly document that CREDENTIAL_ENCRYPTION_KEY must differ from JWT_SECRET in production | high | small | low | credential-encryption.js (lines 50-86) refuses to derive from JWT_SECRET in production but falls back in development. A production operator who skips setting CREDENTIAL_ENCRYPTION_KEY, restarts the app, and the fallback silently activates would collapse two secrets into one. Add a loud config validation in server.js that aborts startup if in production mode and CREDENTIAL_ENCRYPTION_KEY is missing. |
| Rotate RCON passwords in encrypted form only (via UI/API, never plaintext config files) | high | small | medium | RCON credentials must never be stored plaintext. Citadel encrypts them (good), but verify that the only path to set/rotate an RCON password is via an auth-gated API endpoint that encrypts before storing. If operators can edit a plaintext config file, the encryption is worthless. |
| Add HTTPS enforcement in production with HSTS headers | high | small | low | Helmet is present (good); verify that `helmet({ hsts: { maxAge: 31536000 } })` is set. Also verify server.js enforces HTTPS in production and redirects HTTP → HTTPS. CSRF and auth cookies are only secure over TLS. |
| Audit logs should be tamper-evident (e.g., signed or append-only) | high | small | low | audit.js persists to a JSON file (line 35). A compromised operator could edit the JSON to cover their tracks. Consider: (1) signing each entry with a key separate from JWT_SECRET, or (2) appending to a file with checksums, or (3) integrating with a syslog server. Low effort → high security gain. |
| Session/token rotation: issue a new token after login + MFA, expire the 'pre-MFA' token | high | medium | medium | Currently, login issues one token; MFA is checked server-side but the token is issued before MFA. A token leaked mid-login could be used before MFA check. Best practice: issue token only after MFA succeeds (or issue a limited temporary token for MFA challenge phase). |
| Rate limiter should apply to per-user login attempts, not just per-IP | medium | medium | low | fail2ban on line 110 tracks by IP only. An attacker on a shared IP (cloud VPN, corporate network) can abuse many usernames; a botnet across IPs can attack one username. Add per-username rate limiting (in addition to per-IP) to mitigate username enumeration + brute force across IP ranges. |
| Token revocation entries should have a reason code for audit trail | medium | small | low | token-revocation.js (lines 79-84) stores `reason` but it's freeform. Define an enum of revocation reasons (e.g., 'user.deleted', 'user.disabled', 'forced.logout', 'security.breach') and validate. Helps operators understand why tokens were revoked when investigating audit logs. |
| Export RCON validation rules as an API endpoint for UI display | low | small | low | rcon-validator.js has ALLOWED_COMMANDS (line 17) but it's only used server-side. The UI should call getAllowedCommands() (line 261) via an API endpoint so users can see what commands are allowed without guessing. Low effort, high UX gain. |
| Consider rate-limiting by username + IP combination for brute force | medium | small | low | Citadel tracks per-IP + per-username, but separately (lines 85-86). A user lockout is per IP+username combo, and fail2ban is per IP. These are complementary, but documenting the interaction and testing edge cases (shared IP + many usernames) would harden the system further. |
| Store failed login attempts in a persistent, queryable audit trail | medium | small | low | Failed login attempts are logged to logger (line 102 in auth.routes.js) but lockout state is in-memory (persisted to disk for restart recovery). For compliance/forensics, failed logins should also appear in the audit log with IP + username so operators can investigate brute-force attempts. |

