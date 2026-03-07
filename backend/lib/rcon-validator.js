/**
 * RCON Command Validation and Sanitization
 *
 * Implements a whitelist approach to prevent dangerous command injection
 * and execution of unauthorized commands on the DayZ server.
 *
 * Dangerous commands are blocked (e.g. shutdown, #exec, scripting commands).
 * Allowed commands are validated for syntax and parameters.
 */

const logger = require('./logger');

/**
 * Whitelist of allowed RCON commands with their validation rules.
 * Command names are case-insensitive.
 */
const ALLOWED_COMMANDS = {
  // Server control
  '#say': {
    description: 'Broadcast message to all players',
    pattern: /^#say\s+.+$/i,
    validator: (parts) => {
      if (parts.length < 2) return 'Message required';
      return null;
    }
  },
  'say': {
    description: 'Broadcast message to all players',
    pattern: /^say\s+.+$/i,
    validator: (parts) => {
      if (parts.length < 2) return 'Message required';
      return null;
    }
  },
  'server': {
    description: 'Get server info',
    pattern: /^server$/i,
    validator: () => null
  },
  'players': {
    description: 'List connected players',
    pattern: /^players$/i,
    validator: () => null
  },
  'kickoffline': {
    description: 'Kick offline players',
    pattern: /^kickoffline$/i,
    validator: () => null
  },
  'kick': {
    description: 'Kick player by BattlEye slot number',
    pattern: /^kick\s+\d+(\s+.*)?$/i,
    validator: (parts) => {
      if (parts.length < 2) return 'Player slot number required';
      if (!/^\d+$/.test(parts[1])) return 'Invalid slot number';
      return null;
    }
  },
  'bans': {
    description: 'List all bans',
    pattern: /^bans$/i,
    validator: () => null
  },
  'addban': {
    description: 'Add a ban',
    pattern: /^addban\s+.+(\s+.+)?(\s+.+)?$/i,
    validator: (parts) => {
      if (parts.length < 2) return 'Player identifier required';
      return null;
    }
  },
  'removeban': {
    description: 'Remove a ban',
    pattern: /^removeban\s+.+$/i,
    validator: (parts) => {
      if (parts.length < 2) return 'Ban index required';
      return null;
    }
  },
  'missions': {
    description: 'List available missions',
    pattern: /^missions$/i,
    validator: () => null
  },
  'mission': {
    description: 'Select a mission',
    pattern: /^mission\s+.+$/i,
    validator: (parts) => {
      if (parts.length < 2) return 'Mission name required';
      return null;
    }
  },
  'restartserver': {
    description: 'Restart the server',
    pattern: /^restartserver$/i,
    validator: () => null
  },
  'restart': {
    description: 'Restart the server',
    pattern: /^restart$/i,
    validator: () => null
  },
  'lockserver': {
    description: 'Lock the server',
    pattern: /^lockserver$/i,
    validator: () => null
  },
  'unlockserver': {
    description: 'Unlock the server',
    pattern: /^unlockserver$/i,
    validator: () => null
  },
  'maxplayers': {
    description: 'Set max players',
    pattern: /^maxplayers\s+\d+$/i,
    validator: (parts) => {
      if (parts.length < 2) return 'Player count required';
      if (!/^\d+$/.test(parts[1])) return 'Player count must be numeric';
      const count = parseInt(parts[1]);
      if (count < 1 || count > 100) return 'Player count must be between 1 and 100';
      return null;
    }
  },
  'monitorcpu': {
    description: 'Monitor CPU usage',
    pattern: /^monitorcpu$/i,
    validator: () => null
  },
  'monitormem': {
    description: 'Monitor memory usage',
    pattern: /^monitormem$/i,
    validator: () => null
  },
  'fps': {
    description: 'Get server FPS',
    pattern: /^fps$/i,
    validator: () => null
  },
  'load': {
    description: 'Get server load',
    pattern: /^load$/i,
    validator: () => null
  },
  'uptime': {
    description: 'Get server uptime',
    pattern: /^uptime$/i,
    validator: () => null
  },
  'version': {
    description: 'Get server version',
    pattern: /^version$/i,
    validator: () => null
  }
};

/**
 * Blocked dangerous commands (blacklist as fallback)
 */
const BLOCKED_COMMANDS = [
  'shutdown',
  'exit',
  'stop',
  '#exec',
  '#login',
  'killserver',
  'force-stop',
  'exec',
  'quit',
  'terminate'
];

/**
 * Validate an RCON command.
 * Returns { valid: true } if allowed, or { valid: false, reason: 'error message' } if blocked.
 *
 * @param {string} command - The RCON command to validate
 * @returns {Object} { valid: boolean, reason?: string, description?: string }
 */
function validateCommand(command) {
  if (!command || typeof command !== 'string') {
    return { valid: false, reason: 'Command must be a non-empty string' };
  }

  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Command cannot be empty' };
  }

  if (trimmed.length > 1024) {
    return { valid: false, reason: 'Command exceeds maximum length (1024 characters)' };
  }

  // Reject if contains null bytes or other control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(trimmed)) {
    return { valid: false, reason: 'Command contains invalid control characters' };
  }

  // Check blacklist first (fail-safe)
  const cmdLower = trimmed.toLowerCase().split(/\s+/)[0];
  if (BLOCKED_COMMANDS.some(blocked => blocked.toLowerCase() === cmdLower)) {
    return { valid: false, reason: `Command "${cmdLower}" is not allowed` };
  }

  // Check whitelist
  const parts = trimmed.split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const allowedCmd = Object.keys(ALLOWED_COMMANDS).find(key => key.toLowerCase() === cmdName);

  if (!allowedCmd) {
    return { valid: false, reason: `Unknown command: "${cmdName}". Use only whitelisted commands.` };
  }

  const rule = ALLOWED_COMMANDS[allowedCmd];

  // Validate pattern
  if (rule.pattern && !rule.pattern.test(trimmed)) {
    return { valid: false, reason: `Invalid syntax for command "${allowedCmd}"` };
  }

  // Run custom validator if present
  if (rule.validator) {
    const validationError = rule.validator(parts);
    if (validationError) {
      return { valid: false, reason: validationError };
    }
  }

  return { valid: true, description: rule.description };
}

/**
 * Sanitize a command string to remove injection attempts.
 * This is a secondary defense — validation should always be primary.
 *
 * @param {string} command - The command to sanitize
 * @returns {string} Sanitized command
 */
function sanitizeCommand(command) {
  if (!command || typeof command !== 'string') return '';

  // Remove any null bytes
  // eslint-disable-next-line no-control-regex
  let sanitized = command.replace(/\x00/g, '');

  // Remove control characters except newline (for multiline commands)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // Trim leading/trailing whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Get a list of allowed commands for display/help.
 *
 * @returns {Array} Array of { command, description } objects
 */
function getAllowedCommands() {
  return Object.entries(ALLOWED_COMMANDS).map(([cmd, rule]) => ({
    command: cmd,
    description: rule.description
  }));
}

module.exports = {
  validateCommand,
  sanitizeCommand,
  getAllowedCommands
};
