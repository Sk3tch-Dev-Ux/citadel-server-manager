/**
 * serverDZ.cfg parser and writer for DayZ servers.
 *
 * Writes are validated against a whitelist — arbitrary keys from a compromised
 * client can't inject new directives. Untrusted user input is coerced to
 * string/number/boolean before substitution, and string values are scrubbed
 * of characters that could break the .cfg grammar (quotes, semicolons,
 * newlines).
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ─── Config key whitelist ──────────────────────────────────────────────
// Every DayZ serverDZ.cfg key Citadel is allowed to write. Anything else
// submitted by the client is dropped with a warning. Reference:
//   https://community.bistudio.com/wiki/DayZ:Server_Configuration
const ALLOWED_CONFIG_KEYS = new Set([
  // Basic identity
  'hostname', 'password', 'passwordAdmin', 'serverTime', 'serverTimeAcceleration',
  'serverNightTimeAcceleration', 'serverTimePersistent',
  // Slots + region
  'maxPlayers', 'motd', 'motdInterval', 'respawnTime', 'timeStampFormat',
  // Files + logging
  'logAverageFps', 'logMemory', 'logPlayers', 'logFile', 'adminLogPlayerHitsOnly',
  'adminLogPlacement', 'adminLogBuildActions', 'adminLogPlayerList',
  // Anti-cheat + security
  'disableBanlist', 'disableRespawnDialog', 'guaranteedUpdates', 'BattlEye',
  'enableDebugMonitor', 'allowFilePatching', 'simulatedPlayersBatch', 'multithreadedReplication',
  'speedhackDetection', 'networkRangeClose', 'networkRangeNear', 'networkRangeFar',
  'networkRangeDistantEffect', 'networkObjectBatchLogSlow', 'networkObjectBatchSend',
  'networkObjectBatchSendRest', 'networkObjectBatchCompute', 'defaultVisibility',
  'defaultObjectViewDistance', 'lightingConfig',
  // Missions + persistence
  'class Missions', 'template', 'difficulty', 'instanceId', 'storageAutoFix',
  'storeHouseStateDisabled', 'disablePersonalLight', 'disable3rdPerson', 'disableCrosshair',
  'disableVoN', 'vonCodecQuality', 'useRespawnInventory', 'enableCfgGameplayFile',
  'disableBaseDamage', 'disableContainerDamage', 'disableRespawnDialog',
  'lootHistory', 'shotValidation', 'playerRestoreDelay', 'lightingConfig',
  // Economy tuning
  'enableMouseAndKeyboard', 'forceSameBuild', 'forceRHWatchingOnly',
  'serverFpsRating', 'dayTime', 'nightTime',
  // Steam + query
  'steamQueryPort', 'queryPort', 'port',
  // Anti-cheat paths
  'verifySignatures', 'serverPort',
  // Network tuning (DayZ:Server_Configuration)
  'maxPing', 'loginQueueConcurrentPlayers', 'loginQueueMaxPlayers',
  'enablePerformanceLogging', 'performanceCheckType',
]);

/**
 * Filter + coerce the client-supplied updates to only allowed keys with
 * safe values. Returns a new object of the updates that will actually be
 * written, plus a list of rejected keys for logging.
 */
function sanitizeUpdates(updates) {
  const safe = {};
  const rejected = [];
  for (const [key, value] of Object.entries(updates || {})) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      rejected.push(key);
      continue;
    }
    if (value === null || value === undefined) {
      safe[key] = value;
      continue;
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      safe[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      // Strip characters that would let an attacker break out of the
      // quoted value into sibling directives.
      safe[key] = value.replace(/[\r\n";]/g, '').slice(0, 1024);
      continue;
    }
    // Unknown types (objects, arrays) — reject
    rejected.push(key);
  }
  return { safe, rejected };
}

function getServerCfgPath(installDir) {
  return path.join(installDir, 'serverDZ.cfg');
}

function readServerConfig(installDir) {
  const cfgPath = getServerCfgPath(installDir);
  const config = {};
  if (!fs.existsSync(cfgPath)) return config;
  try {
    const content = fs.readFileSync(cfgPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('class') || trimmed === '{' || trimmed === '};') continue;
      const match = trimmed.match(/^([\w]+)\s*=\s*(.+?)\s*;/);
      if (match) {
        const key = match[1];
        let value = match[2].trim();
        const ci = value.indexOf('//');
        if (ci > 0) value = value.substring(0, ci).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (/^\d+$/.test(value)) value = parseInt(value, 10);
        else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
        config[key] = value;
      }
    }
  } catch (err) {
    logger.warn({ err, installDir }, 'Failed to read serverDZ.cfg');
  }
  return config;
}

function writeServerConfig(installDir, updates) {
  const cfgPath = getServerCfgPath(installDir);
  if (!fs.existsSync(cfgPath)) return false;

  // Validate + coerce client-supplied values before touching disk.
  const { safe, rejected } = sanitizeUpdates(updates);
  if (rejected.length) {
    logger.warn({ rejected, installDir }, 'Rejected unknown serverDZ.cfg keys');
  }

  try {
    const backupDir = path.join(installDir, '.backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(cfgPath, path.join(backupDir, `serverDZ.cfg.${Date.now()}.bak`));
    let content = fs.readFileSync(cfgPath, 'utf8');
    const appended = [];
    for (const [key, value] of Object.entries(safe)) {
      if (value === null || value === undefined) continue;
      const strValue = typeof value === 'string' ? `"${value}"` : String(value);
      // Match an existing assignment. The value is non-greedy and the trailing
      // `;` is OPTIONAL (some cfgs omit it on the last line); we capture any
      // inline comment so it's preserved rather than clobbered. Escape the key
      // so a key containing regex metachars can't break the pattern.
      const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^(\\s*${safeKey}\\s*=\\s*)[^;\\r\\n/]*(;?)([ \\t]*(?://.*)?)$`, 'm');
      if (regex.test(content)) {
        // Key exists in file — update in place. Preserve the original line's
        // semicolon-presence and any trailing comment ($2/$3).
        content = content.replace(regex, `$1${strValue}$2$3`);
      } else {
        // Key doesn't exist yet — append it. A value of 0/false/'' is a
        // DELIBERATE setting the operator chose (e.g. disableVoN = 0), so it
        // MUST be written, not skipped.
        appended.push(`${key} = ${strValue};`);
      }
    }
    // Append new keys at the end of the file
    if (appended.length > 0) {
      const eol = content.includes('\r\n') ? '\r\n' : '\n';
      if (!content.endsWith(eol)) content += eol;
      content += eol + '// Added by Citadel' + eol;
      content += appended.join(eol) + eol;
    }
    fs.writeFileSync(cfgPath, content, 'utf8');
    return true;
  } catch (err) {
    logger.error({ err, installDir }, 'Failed to write serverDZ.cfg');
    return false;
  }
}

module.exports = {
  getServerCfgPath,
  readServerConfig,
  writeServerConfig,
  sanitizeUpdates,
  ALLOWED_CONFIG_KEYS,
};
