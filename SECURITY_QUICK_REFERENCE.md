# Security Hardening - Quick Reference Guide

A quick lookup guide for all 10 security features implemented.

---

## 1. ENVIRONMENT VARIABLES & SECRETS

**Location:** Root directory

**Files:**
- `.env` - Production secrets (NOT in git)
- `.env.example` - Template for developers

**Key Point:** Never commit real secrets to git. Use .env only locally.

```bash
# Install npm dependencies first
npm install

# Then set your secrets in .env
export ADMIN_PASSWORD="StrongPassword123!"
export JWT_SECRET="your-auto-generated-secret"
```

---

## 2. FORCED PASSWORD CHANGE

**Location:** `backend/routes/auth.routes.js` + `backend/middleware/auth.js`

**Endpoints:**
- `POST /api/auth/login` - Returns `mustChangePassword: true` flag
- `POST /api/auth/change-password-forced` - User must call this first

**Test:**
```javascript
// 1. Login as admin
POST /api/auth/login
{ "username": "admin", "password": "admin" }
// Response: { "token": "...", "user": { "mustChangePassword": true } }

// 2. Try to access any other endpoint
// Response: 403 Forbidden - "Password change required"

// 3. Change password
POST /api/auth/change-password-forced
{ "newPassword": "NewPassword123!" }
// Now other endpoints work
```

---

## 3. USER INPUT VALIDATION

**Location:** `backend/routes/users.routes.js` (PATCH endpoint)

**Rules:**
```javascript
PATCH /api/users/:id
{
  "username": "john_doe",       // 3-32 chars, alphanumeric+underscore
  "password": "NewPass123!",     // 8+ chars, upper, lower, number, special
  "role": "moderator",           // Must exist in roles
  "description": "User bio"      // Max 256 chars
}
```

**Restrictions:**
- Non-admins can't change their own role
- Non-admins can't modify other users
- Root user can't be modified

---

## 4. RCON COMMAND WHITELIST

**Location:** `backend/lib/rcon-validator.js`

**Allowed Commands:**
```
#say, say                           // Messages
server, players, missions, mission  // Info
kick, kickoffline                   // Player control
bans, addban, removeban             // Ban management
restartserver, restart              // Server control
lockserver, unlockserver            // Lock control
maxplayers, monitorcpu, monitormem  // Configuration
fps, load, uptime, version          // Stats
```

**Blocked Commands:**
```
shutdown, exit, stop, killserver    // Dangerous!
#exec, exec                         // Code execution!
#login                              // Auth bypass!
```

**Usage:**
```javascript
POST /api/servers/:id/rcon
{ "command": "players" }            // ✓ Allowed

POST /api/servers/:id/rcon
{ "command": "shutdown" }           // ✗ Blocked with error
```

---

## 5. CSRF PROTECTION

**Location:** `backend/middleware/csrf.js` + `backend/server.js`

**For Frontend Developers:**

```javascript
// 1. Read token from response header
fetch('/api/users')
  .then(r => {
    const token = r.headers.get('X-CSRF-Token');
    // Store or use this token
  });

// 2. Include token in all state-changing requests
fetch('/api/users/update', {
  method: 'PATCH',
  headers: {
    'X-CSRF-Token': token,  // Required!
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ username: 'newname' })
});
```

**Automatic for GET requests:**
```javascript
// No token needed for safe methods
fetch('/api/users')              // ✓ Works
fetch('/api/users/1', {
  method: 'DELETE',
  headers: { 'X-CSRF-Token': token }  // ✓ Required for DELETE
});
```

---

## 6. FILE WRITE EXTENSION WHITELIST

**Location:** `backend/routes/files.routes.js`

**Allowed Extensions:**
```
.cfg, .config       // DayZ configs
.xml                // XML configs
.json               // JSON configs
.ini, .txt          // Text files
.bat, .cmd, .ps1    // Scripts (use carefully!)
.sh                 // Shell scripts
.md, .log           // Documentation
```

**Blocked Extensions:**
```
.exe, .dll          // Executables ✗
.html, .js          // Web/Code ✗
.zip, .rar, .7z     // Archives ✗
.png, .jpg, .gif    // Binary files ✗
```

**Test:**
```javascript
PUT /api/servers/:id/files/write
{
  "file": "serverDZ.cfg",
  "content": "..."
}
// ✓ Works - .cfg is allowed

PUT /api/servers/:id/files/write
{
  "file": "exploit.exe",
  "content": "..."
}
// ✗ Error: Extension ".exe" is not allowed
```

---

## 7. WEBSOCKET FRESH ROLES

**Location:** `backend/server.js` (io.use middleware)

**What it does:**
- WebSocket always fetches fresh role from database
- Permission changes take effect immediately
- Prevents stale JWT privilege escalation

**Impact:**
- If admin changes user's role, it takes effect on next WebSocket event
- No need to wait for token expiration (8 hours)

---

## 8. ENCRYPTED MFA SECRETS

**Location:** `backend/routes/auth.routes.js` + `backend/lib/credential-encryption.js`

**What it does:**
- MFA secrets encrypted with AES-256-GCM
- Key derived from JWT_SECRET
- Stored in users.json but unreadable without correct key

**For Users:**
```javascript
// 1. Enable MFA
POST /api/auth/mfa/setup
// Response: { "secret": "...", "otpauthUrl": "..." }

// 2. Scan QR code with authenticator app

// 3. Verify code
POST /api/auth/mfa/verify
{ "code": "123456" }
// Now MFA is enabled

// 4. On login, MFA is required
POST /api/auth/login
{
  "username": "admin",
  "password": "password",
  "mfa": "123456"  // Required if enabled
}
```

---

## 9. TOKEN REVOCATION ON DELETE

**Location:** `backend/lib/token-revocation.js` + `backend/routes/users.routes.js`

**What it does:**
- When user is deleted, all their active tokens are immediately revoked
- Old tokens can't be used (checked on every API call)
- Happens automatically on DELETE /api/users/:id

**For Admins:**
```javascript
DELETE /api/users/user-id-123
// Response: { "message": "User deleted" }

// Now any token issued by that user is invalid
// They can't use old tokens even if they have them
```

---

## 10. AUTO-GENERATED JWT_SECRET

**Location:** `backend/lib/config.js` + `.gitignore`

**What it does:**
- On first run, generates random 64-byte secret
- Persists to `data/.jwt-secret` (not in git)
- Reuses same secret on restarts

**Process:**
```
1. Server starts
2. Checks for JWT_SECRET in .env
3. If not found, checks data/.jwt-secret file
4. If file doesn't exist, generates new secret
5. Saves to data/.jwt-secret
6. Uses for all JWT operations
```

**For Deployment:**
```bash
# Copy entire data/ directory between servers
cp -r data/ /backup/data-backup-2026-03-07

# Shared secret across instances (single-server setup)
# For distributed systems, use Redis for token revocation
```

---

## AUDIT LOGGING

All security events logged to `data/audit.json`:

```javascript
// Blocked RCON command
{ "action": "rcon.rejected", "reason": "Command not allowed" }

// Blocked file write
{ "action": "file.write-blocked", "reason": "Unsafe extension" }

// Forced password change
{ "action": "password.force-change", "description": "User changed forced password" }

// User deleted
{ "action": "user.delete", "description": "Deleted user: admin" }

// Token revoked
// Logged with logger.warn() to server logs
```

**View audit log:**
```bash
cat data/audit.json | jq '.[-10:]'  # Last 10 entries
```

---

## DEBUGGING

**Enable debug logging:**
```bash
export DEBUG="citadel:*"
npm start
```

**Check token revocation status:**
```javascript
// In route handler
const { getStats } = require('./lib/token-revocation');
console.log(getStats());

// Output:
// { revokedCount: 3, entries: [...] }
```

**Test CSRF:**
```bash
# Should work (has valid token)
curl -X POST http://localhost:3001/api/users \
  -H "X-CSRF-Token: <token-from-cookie>" \
  -H "Cookie: csrf-token=<token>" \
  -d '{"username":"test"}'

# Should fail (missing token)
curl -X POST http://localhost:3001/api/users \
  -d '{"username":"test"}'
```

---

## COMMON ERRORS & FIXES

| Error | Cause | Fix |
|-------|-------|-----|
| "JWT_SECRET is not set" | Missing JWT secret | Run server again - auto-generates |
| "Password change required" | Admin hasn't set password | Use `/api/auth/change-password-forced` |
| "CSRF token invalid" | Token mismatch | Ensure header matches cookie |
| "Unknown command: admin" | Command not whitelisted | Use allowed commands only |
| "Extension .exe not allowed" | Dangerous file type | Use .cfg, .json, .xml, .txt instead |
| "Token has been revoked" | User was deleted | User must log in again |

---

## PERFORMANCE TIPS

1. **Minimize RCON calls:**
   - Validate before sending to avoid repeated failed attempts
   - Cache player list locally when possible

2. **Batch file operations:**
   - Write multiple config changes in one request
   - Size limit is 10MB per file

3. **Monitor token revocation:**
   - Cleanup runs every hour automatically
   - ~0.1ms overhead per request for revocation check

4. **Cache CSRF tokens:**
   - Read once from response header
   - Reuse for multiple requests in same session

---

## SECURITY CHECKLIST FOR PRODUCTION

- [ ] All real secrets removed from `.env` in git
- [ ] `.env.example` committed with placeholder values
- [ ] Admin password changed from default on first login
- [ ] JWT_SECRET persisted in `data/.jwt-secret`
- [ ] HTTPS enabled (for secure cookies)
- [ ] Rate limiting enabled (already configured)
- [ ] Audit logging reviewed monthly
- [ ] Backups of `data/` directory stored securely
- [ ] MFA enabled for all admin accounts
- [ ] Regular password rotation enforced

---

**Last Updated:** March 7, 2026
**Version:** 2.0.0
**Status:** Production Ready
