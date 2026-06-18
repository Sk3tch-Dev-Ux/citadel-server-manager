/**
 * Application configuration.
 *
 * Load order (later wins):
 *   1. Schema defaults (config-schema.js)
 *   2. citadel.config.json (optional, project root)
 *   3. .env / environment variables (always win)
 *
 * The exported CONFIG object preserves its original shape so all existing
 * modules continue to work without any changes.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('./logger');
const { getDefaults, validateConfig, getEnvMap, redactSensitive, getSchema, CONFIG_SCHEMA } = require('./config-schema');

const { ROOT } = require('./paths');
const CONFIG_FILE = path.join(ROOT, 'citadel.config.json');

// ─── 1. Start with schema defaults ──────────────────────
const structured = getDefaults();

// ─── 2. Merge citadel.config.json if it exists ──────────
let configFileLoaded = false;
let configFileValues = {}; // Track which keys came from the file
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const fileConfig = JSON.parse(raw);
    configFileLoaded = true;

    // Deep-merge file config into structured defaults
    for (const [section, fields] of Object.entries(fileConfig)) {
      if (typeof fields === 'object' && fields !== null && !Array.isArray(fields) && CONFIG_SCHEMA[section]) {
        if (!configFileValues[section]) configFileValues[section] = {};
        for (const [key, value] of Object.entries(fields)) {
          if (CONFIG_SCHEMA[section][key]) {
            structured[section][key] = value;
            configFileValues[section][key] = true;
          }
        }
      }
    }
    logger.info('Loaded configuration from citadel.config.json');
  }
} catch (err) {
  logger.warn({ err: err.message }, 'Failed to parse citadel.config.json — using defaults');
}

// ─── 3. Apply .env overrides (env vars always win) ──────
const envMap = getEnvMap();
const envOverrides = {}; // Track which keys came from env

for (const [envKey, { section, key, def }] of Object.entries(envMap)) {
  if (process.env[envKey] !== undefined && process.env[envKey] !== '') {
    let value = process.env[envKey];

    // Coerce env strings to the correct type
    if (def.type === 'number') {
      value = Number(value);
    } else if (def.type === 'boolean') {
      value = value === 'true' || value === '1';
    } else if (def.type === 'array') {
      value = value.split(',').map(s => s.trim()).filter(Boolean);
    }

    structured[section][key] = value;
    if (!envOverrides[section]) envOverrides[section] = {};
    envOverrides[section][key] = true;
  }
}

// ─── 4. Auto-generate and persist JWT_SECRET if still missing ───────
if (!structured.auth.jwtSecret) {
  if (!process.env.JWT_SECRET) {
    // Check if we have a persisted JWT secret file
    const jwtSecretFile = path.join(ROOT, 'data', '.jwt-secret');
    let persistedSecret = null;

    if (fs.existsSync(jwtSecretFile)) {
      try {
        persistedSecret = fs.readFileSync(jwtSecretFile, 'utf-8').trim();
        if (persistedSecret.length === 128) { // 64 bytes hex = 128 chars
          process.env.JWT_SECRET = persistedSecret;
          logger.info('Loaded persisted JWT_SECRET from data/.jwt-secret');
        }
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed to load persisted JWT_SECRET');
      }
    }

    // If no persisted secret, generate a new one and save it
    if (!process.env.JWT_SECRET) {
      const newSecret = crypto.randomBytes(64).toString('hex'); // 64 bytes = 128 hex chars (stronger)
      process.env.JWT_SECRET = newSecret;

      // Persist it to a file (not checked into git). 0o600 — owner-readable
      // only (audit M17). Windows ignores the mode but ACLs default to
      // Administrators+System, which is also fine.
      try {
        const dataDir = path.join(ROOT, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(jwtSecretFile, newSecret, { encoding: 'utf-8', mode: 0o600 });
        logger.info('Auto-generated and persisted JWT_SECRET to data/.jwt-secret');
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed to persist JWT_SECRET — using in-memory secret (will be lost on restart)');
      }
    }
  }
  structured.auth.jwtSecret = process.env.JWT_SECRET;
}

// ─── 5. Validate & log warnings ─────────────────────────
const warnings = validateConfig(structured);
for (const w of warnings) {
  logger.warn(`Config validation: ${w}`);
}

// ─── 6. Build the backward-compatible CONFIG object ─────
// IMPORTANT: property names must NOT change — existing code depends on them.
const CONFIG = {
  port: structured.server.port,
  bindHost: structured.server.bindHost,
  requireHttps: structured.server.requireHttps,
  jwtSecret: structured.auth.jwtSecret,
  dataDir: path.resolve(ROOT, structured.directories.data),
  dayz: {
    ip: process.env.DAYZ_SERVER_IP || '127.0.0.1',
    rconPort: parseInt(process.env.DAYZ_RCON_PORT || '2305'),
    rconPassword: process.env.RCON_PASSWORD || '',
    installDir: process.env.DAYZ_INSTALL_DIR || 'C:\\DayZServer',
    profileDir: process.env.DAYZ_PROFILE_DIR || '',
    executable: process.env.DAYZ_EXECUTABLE || 'DayZServer_x64.exe',
    launchParams: process.env.DAYZ_LAUNCH_PARAMS || '-config=serverDZ.cfg -port=2302 -profiles=profiles -dologs -adminlog -netlog -freezecheck',
  },
  // Legacy integration credentials (retained for backward compatibility)
  legacyIntegration: {
    applicationId: process.env.CFTOOLS_APPLICATION_ID || '',
    secret: process.env.CFTOOLS_SECRET || '',
  },
  webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  steam: {
    cmdPath: structured.steam.cmdPath,
    username: structured.steam.username,
    password: structured.steam.password,
    appId: '221100',
    serverAppId: '223350',
  },
};

// Ban message configuration
CONFIG.bans = {
  kickMessage: structured.bans.kickMessage,
  appealUrl: structured.bans.appealUrl,
};

// Allowed CORS origins — structured config, with env override already applied
CONFIG.allowedOrigins = structured.server.allowedOrigins;

// ─── Bind-host safety check ────────────────────────────────
// The Local Citadel Agent is meant to listen on loopback only. Remote access
// is supposed to go through Citadel Cloud (citadel-hub.com), not a directly
// exposed Agent. Warn loudly when the operator overrides this — '0.0.0.0' or
// '::' exposes the dashboard to anyone who can reach the host's IP.
{
  const host = CONFIG.bindHost;
  const isLoopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  const isAllInterfaces = host === '0.0.0.0' || host === '::';
  if (isAllInterfaces) {
    logger.warn(
      `SECURITY: server.bindHost is "${host}" — the Agent dashboard is reachable from every network this machine is on. ` +
      'The Local Agent is designed for loopback-only access; use Citadel Cloud for remote control. ' +
      'Set BIND_HOST=127.0.0.1 to restore the safe default.'
    );
  } else if (!isLoopback) {
    logger.warn(
      `server.bindHost is "${host}" (non-loopback). Make sure this interface is firewalled — the Agent has no built-in remote-access protection beyond JWT auth.`
    );
  }
}

// ─── CORS safety check ─────────────────────────────────────
// Flag wildcard or empty origins loudly — these are common misconfigurations
// that undermine CSRF protection when combined with credentialed requests.
if (!Array.isArray(CONFIG.allowedOrigins) || CONFIG.allowedOrigins.length === 0) {
  logger.warn(
    'SECURITY: allowedOrigins is empty. Browsers on other hosts (LAN access) will be blocked by CORS. ' +
    'Set CORS_ORIGINS to a comma-separated list in .env if that is intentional.'
  );
} else {
  const hasWildcard = CONFIG.allowedOrigins.some(
    (o) => o === '*' || (typeof o === 'string' && o.includes('*'))
  );
  if (hasWildcard) {
    logger.warn(
      'SECURITY: allowedOrigins contains a wildcard (*). This exposes the API to any origin and ' +
      'breaks CSRF protection. Narrow to specific hostnames in citadel.config.json or CORS_ORIGINS env ' +
      '(e.g. "http://localhost:3001,https://manager.example.com").'
    );
  }
}

// ─── New structured config sections (accessible via CONFIG._structured) ────
// These are additive — no existing code uses them yet.
CONFIG._structured = structured;
CONFIG._envOverrides = envOverrides;
CONFIG._configFileLoaded = configFileLoaded;
CONFIG._configFileValues = configFileValues;
CONFIG._configFilePath = CONFIG_FILE;

// Ensure data directory exists
if (!fs.existsSync(CONFIG.dataDir)) fs.mkdirSync(CONFIG.dataDir, { recursive: true });

/**
 * Hot-reload mutable config sections from a partial update.
 * Only non-destructive fields can be changed at runtime.
 * Returns { updated: true } or { updated: false, reason }.
 *
 * @param {Object} partial - e.g. { logging: { level: 'debug' }, polling: { metricsIntervalMs: 30000 } }
 */
CONFIG._applyUpdate = function applyUpdate(partial) {
  // Sections that are safe to hot-reload (no restart required)
  const hotReloadable = ['logging', 'backups', 'polling', 'directories'];
  // Sections that require a restart
  const requiresRestart = ['server', 'auth'];

  const updated = [];
  const needsRestart = [];

  for (const [section, fields] of Object.entries(partial)) {
    if (!CONFIG_SCHEMA[section]) continue;

    // Skip sensitive fields — they cannot be updated via API
    for (const [key, value] of Object.entries(fields)) {
      const def = CONFIG_SCHEMA[section]?.[key];
      if (!def) continue;
      if (def.sensitive) continue;

      // Check if this value is locked by an env override
      if (envOverrides[section]?.[key]) continue;

      structured[section][key] = value;
      updated.push(`${section}.${key}`);

      if (requiresRestart.includes(section)) {
        needsRestart.push(`${section}.${key}`);
      }
    }
  }

  // Re-validate after mutation
  const warns = validateConfig(structured);
  for (const w of warns) {
    logger.warn(`Config validation after update: ${w}`);
  }

  // Persist to citadel.config.json
  _writeConfigFile(structured);

  return { updated: updated.length > 0, fields: updated, needsRestart };
};

/**
 * Get the structured config for API responses (redacted).
 */
CONFIG._getRedacted = function getRedacted() {
  return redactSensitive(structured);
};

/**
 * Get the schema for the frontend.
 */
CONFIG._getSchema = function () {
  return getSchema();
};

/**
 * Persist the current structured config to citadel.config.json.
 * Only writes non-sensitive fields that differ from defaults.
 */
function _writeConfigFile(cfg) {
  try {
    // Build a clean config object (exclude sensitive fields — those stay in .env)
    const toWrite = {};
    const defaults = getDefaults();

    for (const [section, fields] of Object.entries(CONFIG_SCHEMA)) {
      for (const [key, def] of Object.entries(fields)) {
        if (def.sensitive) continue; // Never write sensitive values to config file
        const value = cfg[section]?.[key];
        const defaultVal = defaults[section]?.[key];

        // Only write non-default values to keep the file clean
        if (JSON.stringify(value) !== JSON.stringify(defaultVal)) {
          if (!toWrite[section]) toWrite[section] = {};
          toWrite[section][key] = value;
        }
      }
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toWrite, null, 2) + '\n', 'utf-8');
    logger.debug('Wrote citadel.config.json');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to write citadel.config.json');
  }
}

module.exports = CONFIG;
