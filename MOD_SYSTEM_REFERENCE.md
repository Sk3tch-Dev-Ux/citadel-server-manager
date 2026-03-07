# MOD SYSTEM API REFERENCE

Quick reference for using the hardened MOD system APIs.

## Mod Manager (`backend/lib/mod-manager.js`)

### `installModToServer(workshopContentPath, modName, workshopId, installDir)`

Atomically installs a mod with validation and rollback.

**Parameters:**
- `workshopContentPath` (string): Path to downloaded mod content
- `modName` (string): Human-readable mod name
- `workshopId` (string): Steam Workshop ID
- `installDir` (string): Server installation directory

**Returns:**
```javascript
{
  safeName: string,  // Sanitized folder name used
  error?: string     // Error message if failed
}
```

**Example:**
```javascript
const { installModToServer } = require('./mod-manager');

const result = installModToServer(
  '/tmp/workshop-123456',
  'CommunityFramework',
  '123456',
  'C:\\DayZServer\\mods'
);

if (result.error) {
  console.error('Install failed:', result.error);
} else {
  console.log('Installed as:', result.safeName); // @CommunityFramework
}
```

**Behavior:**
- Creates staging directory
- Validates mod completeness
- Backs up existing mod
- Atomically swaps staging to final
- Cleans up on success or restores on failure

### `validateModInstallation(modPath, workshopId)`

Validates a mod installation is healthy and complete.

**Parameters:**
- `modPath` (string): Path to mod directory
- `workshopId` (string): Steam Workshop ID

**Returns:**
```javascript
{
  valid: boolean,
  error?: string  // Error message if invalid
}
```

**Checks:**
- Directory not empty
- Contains key signature files (meta.cpp, config.cpp, or .bikey)
- File count is reasonable

---

## Workshop API (`backend/lib/workshop.js`)

### `checkRateLimit(ipAddress)`

Check if a request is allowed under rate limits.

**Parameters:**
- `ipAddress` (string): Client IP address

**Returns:**
```javascript
{
  allowed: boolean,
  retryAfterMs: number  // Milliseconds to wait before retry
}
```

**Example:**
```javascript
const { checkRateLimit } = require('./workshop');

const check = checkRateLimit('192.168.1.100');
if (!check.allowed) {
  console.log(`Rate limited. Retry after ${check.retryAfterMs}ms`);
  await sleep(check.retryAfterMs);
}
```

### `fetchWithRateLimit(url, options, ipAddress)`

Fetch with automatic rate limiting and exponential backoff.

**Parameters:**
- `url` (string): URL to fetch
- `options` (object): Fetch options (method, headers, body, etc.)
  - `maxRetries` (number): Max retry attempts (default: 5)
- `ipAddress` (string): Client IP address (default: '0.0.0.0')

**Returns:** Response object (same as fetch)

**Example:**
```javascript
const { fetchWithRateLimit } = require('./workshop');

try {
  const response = await fetchWithRateLimit(
    'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
    {
      method: 'POST',
      body: params,
      maxRetries: 3,
    },
    clientIp
  );
  const data = await response.json();
} catch (err) {
  console.error('API call failed:', err);
}
```

**Behavior:**
- Pre-flight rate limit check
- Automatic retry on 429 (Too Many Requests)
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, ...
- Respects Retry-After header
- Caps max delay at 60 seconds

---

## Mod Cache (`backend/lib/mod-cache.js`)

### `getCached(workshopId, steamTimeUpdated)`

Get cached mod if valid (not expired and not stale).

**Parameters:**
- `workshopId` (string): Steam Workshop ID
- `steamTimeUpdated` (number, optional): Unix timestamp from Steam API

**Returns:** Content directory path (string) or null if not cached/expired

**Example:**
```javascript
const { getCached } = require('./mod-cache');

const cached = getCached('123456', steamMod.time_updated);
if (cached) {
  console.log('Using cached mod from:', cached);
  return cached;
} else {
  console.log('Cache miss or expired, downloading...');
  // Download and cache new version
}
```

**Checks:**
- TTL expiration (default 30 minutes)
- Steam version comparison (time_updated)
- Directory not empty
- Auto-cleanup of expired/stale entries

### `storeInCache(workshopId, sourcePath, modName, timeUpdated)`

Store a downloaded mod in cache with TTL tracking.

**Parameters:**
- `workshopId` (string): Steam Workshop ID
- `sourcePath` (string): Path to downloaded mod content
- `modName` (string): Human-readable mod name
- `timeUpdated` (number, optional): Steam time_updated timestamp

**Returns:**
```javascript
{
  success: boolean,
  error?: string  // Error message if failed
}
```

**Example:**
```javascript
const { storeInCache } = require('./mod-cache');

const dlPath = await downloadFromSteam('123456');
const result = storeInCache('123456', dlPath, 'CommunityFramework', steam.time_updated);

if (!result.success) {
  console.error('Cache store failed:', result.error);
}
```

**Behavior:**
- Checks available disk space (warns if < 5GB)
- Performs LRU eviction if cache exceeds limits
- Stores time_updated for future comparisons
- Auto-cleanup of leftover staging/backup dirs

### `invalidateCacheEntry(workshopId)`

Force invalidation of a cache entry (ignores TTL).

**Parameters:**
- `workshopId` (string): Steam Workshop ID

**Returns:**
```javascript
{
  success: boolean,
  error?: string
}
```

**Example:**
```javascript
const { invalidateCacheEntry } = require('./mod-cache');

// User clicks "Check for Updates"
invalidateCacheEntry('123456');

// Next getCached() call will return null, forcing re-download
```

### `getCacheStats()`

Get detailed cache statistics.

**Returns:**
```javascript
{
  cacheDir: string,
  totalSize: number,
  totalSizeFormatted: string,  // "2.5 GB"
  modCount: number,
  mods: [
    {
      workshopId: string,
      name: string,
      cachedAt: string,        // ISO timestamp
      time_updated: number,    // Steam timestamp
      size: number,
      sizeFormatted: string,   // "512 MB"
      ageMs: number,
      isExpired: boolean,
    }
  ],
  ttlMs: number,
  maxSizeBytes: number,
  maxEntries: number,
  availableDiskBytes: number,  // or null if unknown
}
```

**Example:**
```javascript
const { getCacheStats } = require('./mod-cache');

const stats = getCacheStats();
console.log(`Cache: ${stats.totalSizeFormatted} / ${stats.maxSizeFormatted}`);
console.log(`Entries: ${stats.modCount} / ${stats.maxEntries}`);
console.log(`Disk Free: ${formatBytes(stats.availableDiskBytes)}`);

stats.mods.forEach(mod => {
  console.log(`${mod.name}: ${mod.sizeFormatted} (${mod.isExpired ? 'EXPIRED' : 'valid'})`);
});
```

### `clearCache()`

Manually clear entire cache.

**Returns:**
```javascript
{
  success: boolean,
  removed: number,        // Number of entries removed
  freedBytes: number,
  freedFormatted: string,
  error?: string
}
```

---

## Auto-Updater (`backend/lib/auto-updater.js`)

### Initialization

**Call once on startup:**
```javascript
const { initAutoUpdater } = require('./auto-updater');

// On application startup
initAutoUpdater(); // Scans for interrupted updates, logs recovery info
```

### `triggerAutoUpdate(serverId, updateType, updateInfo)`

Trigger automatic update (from polling.js when new version detected).

**Parameters:**
- `serverId` (string): Server ID
- `updateType` (string): 'game' or 'mod'
- `updateInfo` (object): { modId, modName } for mods; { build } for game

**Example:**
```javascript
const { triggerAutoUpdate } = require('./auto-updater');

triggerAutoUpdate('server-1', 'mod', {
  modId: '123456',
  modName: 'CommunityFramework'
});
```

**Process:**
1. Checks if autoUpdateEnabled is true
2. If server running, starts countdown phase
3. On countdown end, stops server and runs update
4. After update, starts server and verifies for 60s
5. If crash within 60s, auto-rollback triggered
6. Returns to idle on completion or failure

### `triggerManualUpdate(serverId, updateType, updateInfo)`

Trigger manual update (from API endpoint).

**Parameters:** Same as triggerAutoUpdate

**Returns:**
```javascript
{
  success: boolean,
  error?: string  // Error message if failed
}
```

**Example:**
```javascript
const { triggerManualUpdate } = require('./auto-updater');

const result = triggerManualUpdate('server-1', 'game');
if (!result.success) {
  console.error('Update trigger failed:', result.error);
  // "Update already in progress (state: countdown)"
}
```

### `getUpdateState(serverId)`

Get current update state for a server.

**Parameters:**
- `serverId` (string): Server ID

**Returns:**
```javascript
{
  state: string,        // idle, detected, countdown, stopping, updating, starting, etc.
  updateType: string,   // game or mod
  updateInfo: object,   // Type-specific info
  countdown: number,    // Seconds remaining (if in countdown)
  startedAt: string,    // ISO timestamp when update started
  error: string,        // Error message if failed
}
```

**Example:**
```javascript
const { getUpdateState } = require('./auto-updater');

const state = getUpdateState('server-1');
console.log(`State: ${state.state}`);
if (state.countdown) {
  console.log(`Countdown: ${state.countdown}s`);
}
```

### `cancelUpdate(serverId)`

Cancel a pending update (only during detected/countdown phases).

**Parameters:**
- `serverId` (string): Server ID

**Returns:**
```javascript
{
  success: boolean,
  error?: string
}
```

**Example:**
```javascript
const { cancelUpdate } = require('./auto-updater');

const result = cancelUpdate('server-1');
if (result.success) {
  console.log('Update cancelled');
} else {
  console.log('Cannot cancel:', result.error);
  // "Cannot cancel in state: updating"
}
```

---

## State Transitions

```
idle
  ↓ (auto or manual update detected)
detected
  ↓ (if server running)
countdown
  ↓ (countdown complete)
stopping
  ↓
updating
  ↓
verifying or backup_failed
  ↓
starting
  ↓
idle or rollback_complete (on auto-rollback)
```

**Special States:**
- `backup_failed`: Update aborted due to backup failure (requires manual intervention)
- `rollback_complete`: Auto-rollback completed after server crash

---

## Error Handling Best Practices

### Mod Installation
```javascript
const result = installModToServer(path, name, id, dir);
if (result.error) {
  // Staging cleaned up automatically
  // Backup restored automatically (if existed)
  // Safe to retry
}
```

### Cache Operations
```javascript
const cached = getCached(workshopId, steamTime);
if (!cached) {
  // TTL expired or stale — safe to download new version
  // Stale entry already cleaned up
}

const stored = storeInCache(workshopId, path, name, steamTime);
if (!stored.success) {
  // Disk space issue or other error
  // No partial data left behind
}
```

### API Calls
```javascript
try {
  const response = await fetchWithRateLimit(url, opts, clientIp);
  if (!response.ok) {
    console.error(`HTTP ${response.status}`);
  }
} catch (err) {
  // Retried automatically, still failed
  // Could be network error, server down, or rate limited
}
```

### Updates
```javascript
const result = triggerManualUpdate('server-1', 'game');
if (!result.success) {
  // Already updating, or other error
  // Check getUpdateState() for current status
}

const state = getUpdateState('server-1');
if (state.state === 'backup_failed') {
  // Backup failed — no update occurred
  // Must fix backup and retry
}
```

---

## Configuration

### Mod Cache (mod-cache.js)
```javascript
const CACHE_CONFIG = {
  ttlMs: 30 * 60 * 1000,              // 30 minutes
  maxSizeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
  lowDiskThresholdBytes: 5 * 1024 * 1024 * 1024, // 5 GB warning
  maxEntries: 500,                    // LRU limit
};
```

To change: Edit constants in mod-cache.js, no config file needed.

### Workshop API (workshop.js)
```javascript
const RATE_LIMIT_CONFIG = {
  perMinute: 10,          // Max requests per minute
  perHour: 100,           // Max requests per hour
  minRetryDelayMs: 1000,  // Min exponential backoff
  maxRetryDelayMs: 60000, // Max exponential backoff (60s)
};
```

To change: Edit constants in workshop.js, no config file needed.

### Auto-Updater (auto-updater.js)
```javascript
// Post-start verification: 60 seconds
// Check interval: 2 seconds
// Set timeouts in runStartPhase() if needed
```

To change: Edit setInterval/setTimeout values in runStartPhase().

---

## Logging

All operations logged to:
- **Console**: logger.info/warn/error/debug
- **Audit Trail**: addLog(serverId, level, source, message)
- **Discord**: sendDiscordWebhook(message)
- **Notifications**: addNotification(serverId, type, title, message, level)

Example:
```javascript
logger.error({ err, workshopId }, 'Mod validation failed');
addLog(serverId, 'error', 'mods', 'Mod installation failed: validation error');
sendDiscordWebhook(`❌ **Server** mod install failed`);
addNotification(serverId, 'mod.install_failed', 'Mod Install Failed', 'error');
```

---

## Troubleshooting

**Mod installation hangs:**
- Check logs for staging directory issues
- Verify disk space available
- Check file permissions on install directory

**Cache not being used:**
- Run `getCacheStats()` to verify cache exists
- Check `isExpired` flag for TTL status
- Verify `time_updated` values from Steam API

**API rate limiting errors:**
- Check IP address tracking in rate limiter
- Verify backoff delays (starts at 1s, increases exponentially)
- Check Discord webhook for rate limit alerts

**Update stuck in state:**
- Check state journal at `C:\Citadel\data\state-journals\{serverId}.journal.json`
- If stuck, manually clear journal and retry
- Check backup-engine for backup issues if `backup_failed` state

**Auto-rollback not triggered:**
- Verify `preUpdateBackup` was created successfully
- Check 60s window starts immediately after server spawn
- Verify backup-engine has restore capabilities

---

## Performance Considerations

- **Mod Cache**: Reduces download time from minutes to seconds (if hit)
- **Rate Limiting**: Prevents API blacklisting (Steam throttles at 20 req/min)
- **LRU Eviction**: Keeps cache size bounded (prevents disk overflow)
- **Atomic Operations**: No partial writes or corrupted installations
- **State Journal**: Minimal disk I/O (one write per major transition)

---

**Document Version**: 1.0
**Last Updated**: 2026-03-07
**Product**: Citadel DayzServerController
