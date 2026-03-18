/**
 * Cloud Agent — connects local Citadel instances to Citadel Cloud.
 *
 * Manages one outbound WebSocket connection per server, speaking the same
 * protocol as Citadel Cloud's plugin handler (/ws/plugin). Each server
 * authenticates independently with its own API key.
 *
 * Data flow:
 *   Local metrics/players/events → Cloud Agent → WSS → Citadel Cloud → Browser/Mobile
 *   Citadel Cloud → WSS → Cloud Agent → Provider System → DayZ Server
 *
 * The agent is opt-in (cloud.enabled = true in config) and has zero impact
 * on local-only operation when disabled.
 */
const WebSocket = require('ws');
const crypto = require('crypto');
const logger = require('./logger');
const ctx = require('./context');
const { getProviderForAction, findSession } = require('./server-actions/executor');
const { ActionType } = require('./server-actions/types');
const { addLog } = require('./audit');
const {
  CLOUD_AUTH_TIMEOUT_MS: AUTH_TIMEOUT_MS,
  CLOUD_RECONNECT_INITIAL_MS: RECONNECT_INITIAL_MS,
  CLOUD_RECONNECT_MAX_MS: RECONNECT_MAX_MS,
  CLOUD_STALE_THRESHOLD_MS: STALE_THRESHOLD_MS,
  CLOUD_MAX_MESSAGE_SIZE: MAX_MESSAGE_SIZE,
  CLOUD_MAX_AUTH_FAILURES: MAX_AUTH_FAILURES,
  CLOUD_COMMAND_RATE_LIMIT: COMMAND_RATE_LIMIT,
  CLOUD_COMMAND_RATE_WINDOW_MS: COMMAND_RATE_WINDOW_MS,
} = require('./constants');

// ─── Constants ─────────────────────────────────────────
const AGENT_VERSION = '1.0.0';

// Allowed inbound message types from Cloud
const ALLOWED_MESSAGE_TYPES = new Set(['auth_ok', 'auth_error', 'pong', 'command', 'config_sync']);

// Whitelisted fields for config_sync with per-field validation ranges
const CONFIG_SYNC_FIELDS = {
  pushIntervalMs: { min: 5000, max: 60000 },
  pingIntervalMs: { min: 10000, max: 60000 },
};

// ─── Cloud command → local ActionType mapping ──────────
// Maps the cloud protocol's action names to Citadel's ActionType constants.
const CLOUD_ACTION_MAP = {
  kick:           ActionType.KICK_PLAYER,
  ban:            ActionType.BAN_PLAYER,
  heal:           ActionType.HEAL_PLAYER,
  kill:           ActionType.KILL_PLAYER,
  teleport:       ActionType.TELEPORT_PLAYER,
  spawn_item:     ActionType.SPAWN_ITEM,
  message:        ActionType.MESSAGE_PLAYER,
  broadcast:      null, // handled specially via RCON
  set_time:       ActionType.SET_TIME,
  set_weather:    ActionType.SET_WEATHER,
  wipe_ai:        ActionType.WIPE_AI,
  wipe_vehicles:  ActionType.WIPE_VEHICLES,
};

/**
 * Per-server cloud connection state.
 * @typedef {Object} ServerConnection
 * @property {WebSocket|null} ws
 * @property {string} serverId
 * @property {string} cloudServerId - Server ID assigned by the cloud after auth
 * @property {boolean} authenticated
 * @property {NodeJS.Timeout|null} pingTimer
 * @property {NodeJS.Timeout|null} reconnectTimer
 * @property {number} reconnectDelay
 * @property {Date|null} lastPing
 * @property {boolean} intentionalClose
 */

/** @type {Map<string, ServerConnection>} */
const connections = new Map();

// ─── Public API ────────────────────────────────────────

/**
 * Start the Cloud Agent. Creates connections for all servers
 * that have a cloudApiKey configured.
 */
function startCloudAgent() {
  const config = ctx.CONFIG?.cloud;
  if (!config?.enabled || !config?.relayUrl) {
    logger.debug('Cloud Agent disabled or no relay URL configured');
    return;
  }

  logger.info({ relayUrl: config.relayUrl }, 'Cloud Agent starting');

  for (const srv of ctx.servers) {
    if (srv.cloudApiKey) {
      connectServer(srv);
    }
  }
}

/**
 * Stop the Cloud Agent. Closes all connections gracefully.
 */
function stopCloudAgent() {
  for (const [serverId, conn] of connections) {
    conn.intentionalClose = true;
    if (conn.pingTimer) clearInterval(conn.pingTimer);
    if (conn.staleCheckTimer) clearInterval(conn.staleCheckTimer);
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.close(1000, 'Agent shutdown');
    }
    logger.debug({ serverId }, 'Cloud connection closed');
  }
  connections.clear();
  logger.info('Cloud Agent stopped');
}

/**
 * Connect (or reconnect) a single server to Citadel Cloud.
 * @param {object} srv - Server config object with cloudApiKey
 */
function connectServer(srv) {
  const config = ctx.CONFIG?.cloud;
  if (!config?.enabled || !config?.relayUrl || !srv.cloudApiKey) return;

  // Clean up any existing connection
  const existing = connections.get(srv.id);
  if (existing) {
    existing.intentionalClose = true;
    if (existing.pingTimer) clearInterval(existing.pingTimer);
    if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
    if (existing.ws && existing.ws.readyState === WebSocket.OPEN) {
      existing.ws.close(1000, 'Reconnecting');
    }
  }

  /** @type {ServerConnection} */
  const conn = {
    ws: null,
    serverId: srv.id,
    cloudServerId: null,
    authenticated: false,
    pingTimer: null,
    staleCheckTimer: null,
    reconnectTimer: null,
    reconnectDelay: RECONNECT_INITIAL_MS,
    lastPing: null,
    lastPong: null,
    intentionalClose: false,
    authFailures: 0,
    authFailureFirstAt: null, // timestamp of first auth failure (for time-based reset)
    commandTimestamps: [], // for rate limiting
  };
  connections.set(srv.id, conn);

  _connect(srv, conn);
}

/**
 * Disconnect a single server from Citadel Cloud.
 * @param {string} serverId
 */
function disconnectServer(serverId) {
  const conn = connections.get(serverId);
  if (!conn) return;

  conn.intentionalClose = true;
  if (conn.pingTimer) clearInterval(conn.pingTimer);
  if (conn.staleCheckTimer) clearInterval(conn.staleCheckTimer);
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
  if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.close(1000, 'Disconnected by user');
  }
  connections.delete(serverId);
  logger.info({ serverId }, 'Cloud connection removed');
}

/**
 * Send a message to the cloud for a specific server.
 * Silently drops if not connected/authenticated.
 *
 * @param {string} serverId
 * @param {object} message - Must include { type, ... }
 */
function send(serverId, message) {
  const conn = connections.get(serverId);
  if (!conn?.ws || conn.ws.readyState !== WebSocket.OPEN || !conn.authenticated) return;

  try {
    conn.ws.send(JSON.stringify(message));
  } catch (err) {
    logger.debug({ err: err.message, serverId }, 'Cloud send failed');
  }
}

/**
 * Push metrics for a server to the cloud.
 * Called from metrics-collector.js after each collection tick.
 *
 * @param {string} serverId
 * @param {object} opts - { fps, playerCount, aiCount, activeAi, animalCount, vehicleCount, entityCount, uptime }
 */
function pushMetrics(serverId, opts) {
  send(serverId, {
    type: 'metrics',
    ts: Date.now(),
    data: {
      fps: Math.round((opts.fps || 0) * 100), // cloud expects fps * 100
      players: opts.playerCount || 0,
      ai_count: opts.aiCount || 0,
      active_ai: opts.activeAi || 0,
      animal_count: opts.animalCount || 0,
      vehicle_count: opts.vehicleCount || 0,
      entity_count: opts.entityCount || 0,
      uptime: opts.uptime || 0,
    },
  });
}

/**
 * Push player positions to the cloud.
 * Called alongside metrics.
 *
 * @param {string} serverId
 * @param {Array} players - state.players array
 */
function pushPlayerPositions(serverId, players) {
  if (!players?.length) return;

  send(serverId, {
    type: 'player_position',
    ts: Date.now(),
    data: {
      players: players
        .filter(p => p.position)
        .map(p => ({
          s: p.steamId || p.id,
          x: p.position?.x || 0,
          y: p.position?.y || 0,
          z: p.position?.z || 0,
          h: 0,
        })),
    },
  });
}

/**
 * Push a player connect event to the cloud.
 * @param {string} serverId
 * @param {object} player - { steamId, name, ip? }
 */
function pushPlayerConnect(serverId, player) {
  send(serverId, {
    type: 'player_connect',
    ts: Date.now(),
    data: {
      steam_id: player.steamId || '',
      name: player.name || 'Unknown',
      ip: player.ip || '0.0.0.0',
    },
  });
}

/**
 * Push a player disconnect event to the cloud.
 * @param {string} serverId
 * @param {object} player - { steamId, name }
 * @param {number} duration - Session length in seconds
 */
function pushPlayerDisconnect(serverId, player, duration) {
  send(serverId, {
    type: 'player_disconnect',
    ts: Date.now(),
    data: {
      steam_id: player.steamId || '',
      name: player.name || 'Unknown',
      duration: duration || 0,
    },
  });
}

/**
 * Push vehicle data to the cloud.
 * @param {string} serverId
 * @param {Array} vehicles
 */
function pushVehicles(serverId, vehicles) {
  if (!vehicles?.length) return;

  send(serverId, {
    type: 'vehicles',
    ts: Date.now(),
    data: {
      vehicles: vehicles.map(v => ({
        id: v.id || '',
        className: v.className || v.type || '',
        type: v.vehicleType || v.type || 'car',
        icon: v.icon || 'car',
        position: v.position || { x: 0, y: 0, z: 0 },
        health: v.health || 0,
        maxHealth: v.maxHealth || 0,
      })),
    },
  });
}

/**
 * Push a webhook/notification event to the cloud.
 * @param {string} serverId
 * @param {string} eventType - e.g. 'server.crashed', 'player.kicked'
 * @param {object} data - Event payload
 */
function pushEvent(serverId, eventType, data) {
  send(serverId, {
    type: 'event',
    ts: Date.now(),
    data: {
      event_type: eventType,
      ...data,
    },
  });
}

/**
 * Get connection status for all servers.
 * @returns {Object<string, { connected: boolean, authenticated: boolean, cloudServerId: string|null }>}
 */
function getStatus() {
  const status = {};
  for (const [serverId, conn] of connections) {
    status[serverId] = {
      connected: conn.ws?.readyState === WebSocket.OPEN,
      authenticated: conn.authenticated,
      cloudServerId: conn.cloudServerId,
    };
  }
  return status;
}

/**
 * Check if cloud is enabled and the module is active.
 * @returns {boolean}
 */
function isEnabled() {
  return ctx.CONFIG?.cloud?.enabled === true && !!ctx.CONFIG?.cloud?.relayUrl;
}

// ─── Internal: WebSocket lifecycle ─────────────────────

function _connect(srv, conn) {
  const config = ctx.CONFIG.cloud;
  const wsUrl = `${config.relayUrl}/ws/plugin`;

  logger.debug({ serverId: srv.id, url: wsUrl }, 'Cloud Agent connecting');

  try {
    conn.ws = new WebSocket(wsUrl, {
      headers: { 'User-Agent': `CitadelAgent/${AGENT_VERSION}` },
      handshakeTimeout: 10_000,
    });
  } catch (err) {
    logger.warn({ err: err.message, serverId: srv.id }, 'Cloud WebSocket creation failed');
    _scheduleReconnect(srv, conn);
    return;
  }

  // Auth timeout — if not authenticated within 10s, close
  const authTimeout = setTimeout(() => {
    if (!conn.authenticated && conn.ws?.readyState === WebSocket.OPEN) {
      logger.warn({ serverId: srv.id }, 'Cloud auth timeout — closing connection');
      conn.ws.close(4001, 'Auth timeout');
    }
  }, AUTH_TIMEOUT_MS);

  conn.ws.on('open', () => {
    // Guard against race condition where ws closes before open fires
    if (conn.ws?.readyState !== WebSocket.OPEN) return;

    logger.debug({ serverId: srv.id }, 'Cloud WebSocket connected — sending auth');

    // Send auth message matching Citadel Cloud's expected format
    const state = ctx.serverStates[srv.id];
    conn.ws.send(JSON.stringify({
      type: 'auth',
      api_key: srv.cloudApiKey,
      plugin_version: AGENT_VERSION,
      game_version: '1.25',
      server_name: srv.name || 'Unknown',
      map: srv.map || 'chernarusplus',
      max_players: srv.maxPlayers || 60,
    }));
  });

  conn.ws.on('message', (raw) => {
    // Reject oversized messages to prevent DoS / memory exhaustion
    if (raw.length > MAX_MESSAGE_SIZE) {
      logger.warn({ serverId: srv.id, size: raw.length }, 'Cloud: rejected oversized message');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      logger.debug({ serverId: srv.id }, 'Cloud: received non-JSON message');
      return;
    }

    // Validate message type against allowlist
    if (!msg.type || !ALLOWED_MESSAGE_TYPES.has(msg.type)) {
      logger.debug({ serverId: srv.id, type: msg.type }, 'Cloud: rejected unknown message type');
      return;
    }

    switch (msg.type) {
      case 'auth_ok':
        clearTimeout(authTimeout);
        conn.authenticated = true;
        conn.cloudServerId = msg.server_id || null;
        conn.reconnectDelay = RECONNECT_INITIAL_MS; // reset backoff
        logger.info({ serverId: srv.id, cloudServerId: msg.server_id }, 'Cloud Agent authenticated');
        addLog(srv.id, 'info', 'cloud', `Connected to Citadel Cloud (server: ${msg.server_id})`);

        // Reset auth failure tracking on success
        conn.authFailures = 0;
        conn.authFailureFirstAt = null;

        // Start ping keepalive
        conn.lastPong = Date.now();
        conn.pingTimer = setInterval(() => {
          if (conn.ws?.readyState === WebSocket.OPEN) {
            conn.ws.send(JSON.stringify({ type: 'ping' }));
            conn.lastPing = new Date();
          }
        }, config.pingIntervalMs || 30000);

        // Start stale connection detection
        conn.staleCheckTimer = setInterval(() => {
          if (!conn.authenticated || !conn.ws) return;
          const sincePong = Date.now() - (conn.lastPong || 0);
          if (sincePong > STALE_THRESHOLD_MS) {
            logger.warn({ serverId: srv.id, sincePongMs: sincePong }, 'Cloud connection stale — no pong received, reconnecting');
            addLog(srv.id, 'warn', 'cloud', `Cloud connection stale (no pong for ${Math.round(sincePong / 1000)}s) — reconnecting`);
            conn.ws.close(4002, 'Stale connection');
          }
        }, 30000);
        break;

      case 'auth_error': {
        clearTimeout(authTimeout);
        const now = Date.now();

        // Time-based reset: clear auth failures after 1 hour
        if (conn.authFailureFirstAt && (now - conn.authFailureFirstAt) > 3600_000) {
          conn.authFailures = 0;
          conn.authFailureFirstAt = null;
        }

        if (!conn.authFailureFirstAt) conn.authFailureFirstAt = now;
        conn.authFailures++;

        logger.error({ serverId: srv.id, error: msg.message, failures: conn.authFailures }, 'Cloud auth failed — check API key');
        addLog(srv.id, 'error', 'cloud', `Cloud auth failed: ${msg.message || 'Invalid API key'} (attempt ${conn.authFailures}/${MAX_AUTH_FAILURES})`);

        if (conn.authFailures >= MAX_AUTH_FAILURES) {
          // Back off with extended delay instead of permanent disable
          conn.reconnectDelay = RECONNECT_MAX_MS * 4; // ~2 min backoff
          logger.error({ serverId: srv.id }, `Cloud auth failed ${MAX_AUTH_FAILURES} times — backing off for ${conn.reconnectDelay / 1000}s before retrying`);
          addLog(srv.id, 'error', 'cloud', `Cloud auth failed ${MAX_AUTH_FAILURES} times. Will retry in ${conn.reconnectDelay / 1000}s. Check API key.`);
        }
        if (conn.ws?.readyState === WebSocket.OPEN) conn.ws.close(4003, 'Auth failed');
        break;
      }

      case 'pong':
        conn.lastPong = Date.now();
        break;

      case 'command':
        _handleCommand(srv, conn, msg);
        break;

      case 'config_sync':
        _handleConfigSync(srv, msg);
        break;

    }
  });

  conn.ws.on('close', (code, reason) => {
    clearTimeout(authTimeout);
    conn.authenticated = false;
    if (conn.pingTimer) { clearInterval(conn.pingTimer); conn.pingTimer = null; }
    if (conn.staleCheckTimer) { clearInterval(conn.staleCheckTimer); conn.staleCheckTimer = null; }

    const reasonStr = reason?.toString() || '';
    logger.info({ serverId: srv.id, code, reason: reasonStr }, 'Cloud WebSocket closed');

    if (!conn.intentionalClose) {
      _scheduleReconnect(srv, conn);
    }
  });

  conn.ws.on('error', (err) => {
    // Errors are followed by 'close' event — just log
    logger.debug({ err: err.message, serverId: srv.id }, 'Cloud WebSocket error');
  });
}

function _scheduleReconnect(srv, conn) {
  if (conn.intentionalClose) return;

  const delay = conn.reconnectDelay;
  conn.reconnectDelay = Math.min(conn.reconnectDelay * 2, RECONNECT_MAX_MS);

  logger.debug({ serverId: srv.id, delayMs: delay }, 'Cloud Agent scheduling reconnect');
  conn.reconnectTimer = setTimeout(() => {
    // Re-read server config in case cloudApiKey was changed or removed
    const freshSrv = ctx.servers.find(s => s.id === srv.id);
    if (!freshSrv?.cloudApiKey) {
      logger.info({ serverId: srv.id }, 'Cloud API key removed — stopping reconnection');
      connections.delete(srv.id);
      return;
    }
    if (ctx.CONFIG?.cloud?.enabled) {
      _connect(freshSrv, conn);
    }
  }, delay);
}

/**
 * Handle an incoming command from Citadel Cloud.
 * Maps cloud action → local ActionType, dispatches through the provider system.
 */
/**
 * Check if a command is within the rate limit.
 * @returns {boolean} true if allowed
 */
function _checkCommandRate(conn) {
  const now = Date.now();
  // Remove timestamps outside the window
  conn.commandTimestamps = conn.commandTimestamps.filter(ts => now - ts < COMMAND_RATE_WINDOW_MS);
  // Safety cap: prevent unbounded growth if filter somehow fails
  if (conn.commandTimestamps.length > COMMAND_RATE_LIMIT * 2) {
    conn.commandTimestamps = conn.commandTimestamps.slice(-COMMAND_RATE_LIMIT);
  }
  if (conn.commandTimestamps.length >= COMMAND_RATE_LIMIT) {
    return false;
  }
  conn.commandTimestamps.push(now);
  return true;
}

/**
 * Validate string param: max length, returns truncated value.
 */
function _validateString(value, maxLen, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, maxLen);
}

/**
 * Validate numeric param: within range.
 */
function _validateNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

async function _handleCommand(srv, conn, msg) {
  const { id: commandId, action, params } = msg;

  logger.info({ serverId: srv.id, commandId, action }, 'Cloud command received');
  addLog(srv.id, 'info', 'cloud', `Cloud command: ${action} (${commandId})`);

  // Rate limit commands
  if (!_checkCommandRate(conn)) {
    logger.warn({ serverId: srv.id, action }, 'Cloud command rate limited');
    _sendCommandResult(conn, commandId, false, 'Rate limited — too many commands');
    return;
  }

  try {
    const localAction = CLOUD_ACTION_MAP[action];
    if (!localAction && action !== 'broadcast') {
      throw new Error(`Unknown cloud action: ${action}`);
    }

    // Handle broadcast specially — it goes through RCON
    if (action === 'broadcast') {
      const text = _validateString(params.text, 500);
      if (!text) throw new Error('Broadcast text is required');

      const state = ctx.serverStates[srv.id];
      if (state?.rcon?.loggedIn) {
        await state.rcon.say(text);
        _sendCommandResult(conn, commandId, true, 'Broadcast sent');
      } else {
        throw new Error('RCON not connected — cannot broadcast');
      }
      return;
    }

    // Player actions need a session lookup
    const isPlayerAction = action === 'kick' || action === 'ban' || action === 'heal' ||
      action === 'kill' || action === 'teleport' || action === 'spawn_item' || action === 'message';

    const provider = getProviderForAction(srv.id, localAction);

    if (isPlayerAction && params.steam_id) {
      const session = findSession(srv.id, params.steam_id);
      if (!session) {
        throw new Error(`Player ${params.steam_id} not found on server`);
      }

      // Map cloud params to provider params (with validation)
      switch (action) {
        case 'kick':
          await provider.kickPlayer(srv.id, session, _validateString(params.reason, 200, 'Kicked by admin'));
          break;
        case 'ban':
          await provider.kickPlayer(srv.id, session, _validateString(params.reason, 200, 'Banned by admin'));
          break;
        case 'heal':
          await provider.healPlayer(srv.id, session);
          break;
        case 'kill':
          await provider.killPlayer(srv.id, session);
          break;
        case 'teleport': {
          const x = _validateNumber(params.x, -20000, 20000, 0);
          const y = _validateNumber(params.y, 0, 1000, 0);
          const z = _validateNumber(params.z, -20000, 20000, 0);
          await provider.teleportPlayer(srv.id, session, { x, y, z });
          break;
        }
        case 'spawn_item': {
          const className = _validateString(params.item_class, 100);
          if (!className) throw new Error('item_class is required');
          const quantity = _validateNumber(params.quantity, 1, 100, 1);
          await provider.spawnItem(srv.id, session, className, quantity);
          break;
        }
        case 'message': {
          const text = _validateString(params.text, 500);
          if (!text) throw new Error('Message text is required');
          await provider.messagePlayer(srv.id, session, text);
          break;
        }
      }
    } else {
      // World actions
      switch (action) {
        case 'set_time': {
          const hour = _validateNumber(params.hour, 0, 23, 12);
          const minute = _validateNumber(params.minute, 0, 59, 0);
          await provider.setTime(srv.id, hour, minute);
          break;
        }
        case 'set_weather':
          await provider.setWeather(srv.id, {
            overcast: params.overcast != null ? _validateNumber(params.overcast, 0, 1, 0) : undefined,
            fog: params.fog != null ? _validateNumber(params.fog, 0, 1, 0) : undefined,
            rain: params.rain != null ? _validateNumber(params.rain, 0, 1, 0) : undefined,
            wind: params.wind != null ? _validateNumber(params.wind, 0, 1, 0) : undefined,
          });
          break;
        case 'wipe_ai':
          await provider.wipeAI(srv.id);
          break;
        case 'wipe_vehicles':
          await provider.wipeVehicles(srv.id);
          break;
      }
    }

    _sendCommandResult(conn, commandId, true, `${action} executed successfully`);
    addLog(srv.id, 'info', 'cloud', `Cloud command ${action} completed (${commandId})`);

  } catch (err) {
    logger.warn({ err: err.message, serverId: srv.id, commandId, action }, 'Cloud command failed');
    _sendCommandResult(conn, commandId, false, err.message);
    addLog(srv.id, 'warn', 'cloud', `Cloud command ${action} failed: ${err.message}`);
  }
}

/**
 * Handle config_sync messages from cloud.
 * Only applies whitelisted fields to prevent arbitrary config injection.
 */
function _handleConfigSync(srv, msg) {
  const { config_type, data } = msg;
  logger.info({ serverId: srv.id, configType: config_type }, 'Cloud config_sync received');

  if (config_type !== 'agent_settings' || !data || typeof data !== 'object') {
    logger.debug({ serverId: srv.id, configType: config_type }, 'Ignoring unsupported config_sync type');
    return;
  }

  const cloudConfig = ctx.CONFIG?.cloud;
  if (!cloudConfig) return;

  let applied = 0;
  for (const [key, value] of Object.entries(data)) {
    const fieldSpec = CONFIG_SYNC_FIELDS[key];
    if (!fieldSpec) {
      logger.debug({ serverId: srv.id, key }, 'config_sync: rejected non-whitelisted field');
      continue;
    }
    if (typeof value !== 'number' || value < fieldSpec.min || value > fieldSpec.max) {
      logger.debug({ serverId: srv.id, key, value, min: fieldSpec.min, max: fieldSpec.max }, 'config_sync: rejected out-of-range value');
      continue;
    }
    cloudConfig[key] = value;
    applied++;
  }

  if (applied > 0) {
    logger.info({ serverId: srv.id, applied }, 'config_sync: applied settings');
    addLog(srv.id, 'info', 'cloud', `Applied ${applied} config_sync setting(s)`);
  }
}

function _sendCommandResult(conn, commandId, success, message) {
  if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) return;

  try {
    conn.ws.send(JSON.stringify({
      type: 'command_result',
      id: commandId,
      success,
      message,
    }));
  } catch { /* connection gone */ }
}

// ─── Exports ───────────────────────────────────────────

module.exports = {
  startCloudAgent,
  stopCloudAgent,
  connectServer,
  disconnectServer,
  send,
  pushMetrics,
  pushPlayerPositions,
  pushPlayerConnect,
  pushPlayerDisconnect,
  pushVehicles,
  pushEvent,
  getStatus,
  isEnabled,
};
