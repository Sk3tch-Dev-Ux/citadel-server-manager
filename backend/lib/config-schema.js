/**
 * Configuration schema — defines every config section, field type, default,
 * validation constraints, and sensitivity markers.
 *
 * Used by config.js to merge citadel.config.json + .env overrides,
 * by setup.js to generate a starter config file, and by the API to
 * redact sensitive values before sending to the frontend.
 */

const CONFIG_SCHEMA = {
  server: {
    port: { type: 'number', default: 3001, min: 1, max: 65535, envKey: 'PORT', description: 'API server port' },
    bindHost: { type: 'string', default: '127.0.0.1', envKey: 'BIND_HOST', description: 'Interface to bind to. Defaults to 127.0.0.1 (loopback) so the dashboard is only reachable from this machine. Set to 0.0.0.0 to allow LAN access, or to a specific NIC IP. Anything other than 127.0.0.1 logs a security warning at startup — remote access is intended to go through Citadel Cloud, not a directly exposed Agent.' },
    allowedOrigins: { type: 'array', default: ['http://localhost:3001', 'http://127.0.0.1:3001'], envKey: 'CORS_ORIGINS', description: 'Allowed CORS origins (comma-separated in env)' },
    trustedProxies: { type: 'string', default: '', envKey: 'TRUSTED_PROXIES', description: 'Trusted reverse-proxy IPs (comma-separated)' },
    requireHttps: { type: 'boolean', default: false, envKey: 'REQUIRE_HTTPS', description: 'When true, the Agent refuses to start unless valid TLS certificates are present in ./cert (key.pem + cert.pem). Set this for any public/internet-facing deployment so the dashboard and auth cookies are never served over plaintext HTTP. Independently, binding to all interfaces (0.0.0.0 / ::) over HTTP is always refused unless ALLOW_INSECURE_BIND=1 is set.' },
  },
  auth: {
    jwtSecret: { type: 'string', default: null, sensitive: true, envKey: 'JWT_SECRET', description: 'JWT signing secret' },
    jwtExpiresIn: { type: 'string', default: '24h', envKey: 'JWT_EXPIRES_IN', description: 'JWT token lifetime (e.g. 8h, 24h, 7d)' },
    passwordMinLength: { type: 'number', default: 8, min: 4, max: 128, description: 'Minimum password length for new users' },
    fail2banThreshold: { type: 'number', default: 5, min: 1, max: 100, description: 'Failed login attempts before IP ban' },
    fail2banDurations: { type: 'array', default: [60, 300, 3600], description: 'Escalating ban durations in seconds' },
  },
  steam: {
    cmdPath: { type: 'string', default: '', envKey: 'STEAMCMD_PATH', description: 'Path to steamcmd.exe' },
    username: { type: 'string', default: '', sensitive: true, envKey: 'STEAM_USERNAME', description: 'Steam account username' },
    password: { type: 'string', default: '', sensitive: true, envKey: 'STEAM_PASSWORD', description: 'Steam account password' },
  },
  directories: {
    data: { type: 'string', default: './data', envKey: 'CITADEL_DATA_DIR', description: 'Data directory for JSON persistence' },
    cache: { type: 'string', default: 'C:\\Citadel\\cache', description: 'Cache directory for SteamCMD downloads' },
    deployments: { type: 'string', default: 'C:\\Citadel\\deployments', description: 'Default server deployment root' },
    backups: { type: 'string', default: './.backups', description: 'Default backup storage directory' },
  },
  logging: {
    level: { type: 'string', default: 'info', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'], envKey: 'LOG_LEVEL', description: 'Minimum log level' },
    auditRetentionDays: { type: 'number', default: 7, min: 1, max: 365, description: 'Days to keep audit log entries' },
  },
  backups: {
    defaultInterval: { type: 'number', default: 0, min: 0, description: 'Default auto-backup interval in minutes (0 = disabled)' },
    defaultMaxKeepDays: { type: 'number', default: 7, min: 1, max: 365, description: 'Default days to keep backup files' },
    backupAtStartup: { type: 'boolean', default: false, description: 'Run a backup when the server starts' },
  },
  polling: {
    metricsIntervalMs: { type: 'number', default: 15000, min: 5000, max: 300000, description: 'Metrics collection interval in ms' },
    steamUpdateIntervalMs: { type: 'number', default: 300000, min: 60000, max: 3600000, description: 'Steam update check interval in ms' },
    metricsHistorySize: { type: 'number', default: 360, min: 10, max: 10000, description: 'Number of metrics history data points to retain' },
  },
  bans: {
    kickMessage: { type: 'string', default: 'You have been banned. Reason: {reason}. To appeal, visit our Discord.', envKey: 'BAN_KICK_MESSAGE', description: 'Message shown to players when kicked for a ban. Use {reason} for the ban reason and {banId} for the ban ID.' },
    appealUrl: { type: 'string', default: '', envKey: 'BAN_APPEAL_URL', description: 'Discord invite or appeal URL included in ban messages. If set, replaces "our Discord" in the default kick message.' },
  },
};

/**
 * Build a plain config object populated with all default values from the schema.
 * @returns {Object} Nested config with section → field → default
 */
function getDefaults() {
  const defaults = {};
  for (const [section, fields] of Object.entries(CONFIG_SCHEMA)) {
    defaults[section] = {};
    for (const [key, def] of Object.entries(fields)) {
      defaults[section][key] = def.default !== undefined
        ? (Array.isArray(def.default) ? [...def.default] : def.default)
        : null;
    }
  }
  return defaults;
}

/**
 * Validate a config object against the schema.
 * Returns an array of warning strings for any invalid values (does not throw).
 * Invalid values are replaced in-place with their defaults.
 *
 * @param {Object} config - The config object to validate (mutated in place)
 * @returns {string[]} warnings
 */
function validateConfig(config) {
  const warnings = [];

  for (const [section, fields] of Object.entries(CONFIG_SCHEMA)) {
    if (!config[section] || typeof config[section] !== 'object') {
      config[section] = {};
    }

    for (const [key, def] of Object.entries(fields)) {
      const value = config[section][key];
      const path = `${section}.${key}`;

      // If value is null/undefined, fill in default
      if (value === undefined || value === null) {
        config[section][key] = def.default !== undefined
          ? (Array.isArray(def.default) ? [...def.default] : def.default)
          : null;
        continue;
      }

      // Type checking
      if (def.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) {
          warnings.push(`${path}: expected number, got "${value}" — using default ${def.default}`);
          config[section][key] = def.default;
          continue;
        }
        config[section][key] = num;
        if (def.min !== undefined && num < def.min) {
          warnings.push(`${path}: ${num} is below minimum ${def.min} — clamped`);
          config[section][key] = def.min;
        }
        if (def.max !== undefined && num > def.max) {
          warnings.push(`${path}: ${num} exceeds maximum ${def.max} — clamped`);
          config[section][key] = def.max;
        }
      }

      if (def.type === 'string') {
        if (typeof value !== 'string') {
          config[section][key] = String(value);
        }
        if (def.enum && !def.enum.includes(config[section][key])) {
          warnings.push(`${path}: "${config[section][key]}" not in [${def.enum.join(', ')}] — using default "${def.default}"`);
          config[section][key] = def.default;
        }
        // Pattern validation (e.g. relayUrl must start with ws:// or wss://)
        if (def.pattern && config[section][key] && !def.pattern.test(config[section][key])) {
          warnings.push(`${path}: "${config[section][key]}" does not match required format — using default`);
          config[section][key] = def.default;
        }
      }

      if (def.type === 'boolean') {
        if (typeof value === 'string') {
          config[section][key] = value === 'true' || value === '1';
        } else {
          config[section][key] = Boolean(value);
        }
      }

      if (def.type === 'array') {
        if (typeof value === 'string') {
          // Parse comma-separated string into array
          config[section][key] = value.split(',').map(s => s.trim()).filter(Boolean);
        } else if (!Array.isArray(value)) {
          warnings.push(`${path}: expected array, got ${typeof value} — using default`);
          config[section][key] = Array.isArray(def.default) ? [...def.default] : [];
        }
      }
    }
  }

  return warnings;
}

/**
 * Return a deep copy of config with all sensitive fields replaced by '********'.
 * Safe to send to the frontend / API responses.
 *
 * @param {Object} config - The structured config object
 * @returns {Object} Redacted copy
 */
function redactSensitive(config) {
  const redacted = {};
  for (const [section, fields] of Object.entries(CONFIG_SCHEMA)) {
    redacted[section] = {};
    for (const [key, def] of Object.entries(fields)) {
      if (def.sensitive && config[section] && config[section][key]) {
        redacted[section][key] = '********';
      } else {
        const val = config[section]?.[key];
        redacted[section][key] = Array.isArray(val) ? [...val] : val;
      }
    }
  }
  return redacted;
}

/**
 * Build a map of envKey → { section, key } for all fields that have an envKey.
 * Used by config.js to apply .env overrides efficiently.
 *
 * @returns {Object} Map from env var name to { section, key, def }
 */
function getEnvMap() {
  const map = {};
  for (const [section, fields] of Object.entries(CONFIG_SCHEMA)) {
    for (const [key, def] of Object.entries(fields)) {
      if (def.envKey) {
        map[def.envKey] = { section, key, def };
      }
    }
  }
  return map;
}

/**
 * Return the full schema for the frontend (for rendering form fields).
 * Strips only the actual values — returns type/default/constraints/description.
 *
 * @returns {Object} The CONFIG_SCHEMA
 */
function getSchema() {
  return CONFIG_SCHEMA;
}

module.exports = {
  CONFIG_SCHEMA,
  getDefaults,
  validateConfig,
  redactSensitive,
  getEnvMap,
  getSchema,
};
