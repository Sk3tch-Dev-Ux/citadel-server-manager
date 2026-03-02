/**
 * Citadel Cloud Connector — connects this local instance to Citadel Cloud
 * as a plugin agent via WebSocket, similar to CFTools Agent ↔ Manager pairing.
 *
 * Flow:
 *   1. Reads CLOUD_URL + CLOUD_API_KEY from config
 *   2. Connects WebSocket to cloud's /ws/plugin endpoint
 *   3. Authenticates with API key
 *   4. Pushes metrics, player events, and status
 *   5. Receives and executes commands from cloud
 */
const WebSocket = require('ws');
const os = require('os');
const logger = require('./logger');

class CloudConnector {
  constructor(config, ctx) {
    this.config = config;
    this.ctx = ctx;
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.reconnectTimer = null;
    this.pushTimer = null;
    this.reconnectDelay = 5000;
    this.maxReconnectDelay = 60000;
    this.pushInterval = 15000;
  }

  get enabled() {
    return !!(this.config.cloudUrl && this.config.cloudApiKey);
  }

  start() {
    if (!this.enabled) {
      logger.info('Citadel Cloud connector disabled (no CLOUD_URL / CLOUD_API_KEY configured)');
      return;
    }
    logger.info({ url: this.config.cloudUrl }, 'Citadel Cloud connector starting');
    this.connect();
  }

  stop() {
    this.connected = false;
    this.authenticated = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pushTimer) clearInterval(this.pushTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    logger.info('Citadel Cloud connector stopped');
  }

  connect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    const wsUrl = this.config.cloudUrl.replace(/^http/, 'ws') + '/ws/plugin';
    logger.debug({ wsUrl }, 'Connecting to Citadel Cloud');

    try {
      this.ws = new WebSocket(wsUrl, { handshakeTimeout: 10000 });
    } catch (err) {
      logger.error({ err }, 'Failed to create WebSocket');
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      logger.info('Connected to Citadel Cloud — authenticating');
      this.connected = true;
      this.reconnectDelay = 5000;
      this.authenticate();
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch (err) {
        logger.warn({ err }, 'Invalid message from cloud');
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn({ code, reason: reason?.toString() }, 'Cloud connection closed');
      this.connected = false;
      this.authenticated = false;
      if (this.pushTimer) clearInterval(this.pushTimer);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error({ err: err.message }, 'Cloud WebSocket error');
    });
  }

  authenticate() {
    this.send({
      type: 'auth',
      api_key: this.config.cloudApiKey,
      plugin_version: '2.0.0',
      game_version: 'DayZ',
      server_name: os.hostname(),
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'auth_ok':
        logger.info('Authenticated with Citadel Cloud');
        this.authenticated = true;
        if (msg.config?.push_interval) {
          this.pushInterval = msg.config.push_interval * 1000;
        }
        this.startPushing();
        break;

      case 'auth_error':
        logger.error({ reason: msg.reason }, 'Cloud authentication failed');
        this.ws.close();
        break;

      case 'command':
        this.handleCommand(msg);
        break;

      case 'config_sync':
        logger.debug('Received config sync from cloud');
        break;

      case 'pong':
        break;

      default:
        logger.debug({ type: msg.type }, 'Unknown message from cloud');
    }
  }

  async handleCommand(msg) {
    const { action, params, command_id } = msg;
    logger.info({ action, command_id }, 'Received command from cloud');

    try {
      let result = { success: true };

      // Route commands to appropriate backend handlers
      switch (action) {
        case 'kick':
          if (params?.server_id && params?.steam_id) {
            const srv = this.ctx.servers.find(s => s.id === params.server_id);
            if (srv) {
              const rcon = require('./rcon-client');
              await rcon.kick(srv, params.steam_id, params.reason || 'Kicked by admin');
              result.message = 'Player kicked';
            }
          }
          break;

        case 'broadcast':
          if (params?.server_id && params?.message) {
            const srv = this.ctx.servers.find(s => s.id === params.server_id);
            if (srv) {
              const rcon = require('./rcon-client');
              await rcon.broadcast(srv, params.message);
              result.message = 'Message broadcast';
            }
          }
          break;

        case 'restart':
          if (params?.server_id) {
            const pm = require('./process-manager');
            await pm.restartServer(params.server_id);
            result.message = 'Server restarting';
          }
          break;

        default:
          result = { success: false, error: `Unknown action: ${action}` };
      }

      this.send({ type: 'command_result', command_id, ...result });
    } catch (err) {
      this.send({ type: 'command_result', command_id, success: false, error: err.message });
    }
  }

  startPushing() {
    if (this.pushTimer) clearInterval(this.pushTimer);
    this.pushMetrics();
    this.pushTimer = setInterval(() => this.pushMetrics(), this.pushInterval);
  }

  pushMetrics() {
    if (!this.authenticated || !this.connected) return;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // Push system-level metrics
    this.send({
      type: 'metrics',
      cpu_percent: 0, // Will be filled by polling
      memory_percent: +((1 - freeMem / totalMem) * 100).toFixed(1),
      memory_used_gb: +((totalMem - freeMem) / 1073741824).toFixed(2),
      uptime: os.uptime(),
    });

    // Push per-server metrics
    for (const srv of this.ctx.servers) {
      const state = this.ctx.serverStates[srv.id];
      if (!state) continue;

      this.send({
        type: 'server_metrics',
        server_id: srv.id,
        server_name: srv.name,
        status: state.status || 'stopped',
        player_count: state.players?.length || 0,
        max_players: srv.maxPlayers || 60,
        cpu: state.cpu || 0,
        ram: state.ram || 0,
        fps: state.fps || 0,
        map: srv.map || 'chernarusplus',
        game_port: srv.gamePort || 2302,
        query_port: srv.queryPort || 2303,
        rcon_port: srv.rconPort || 2305,
      });
    }

    // Ping keepalive
    this.send({ type: 'ping' });
  }

  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(data));
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to send to cloud');
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    logger.info({ delay: this.reconnectDelay }, 'Scheduling cloud reconnect');
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
  }

  getStatus() {
    return {
      enabled: this.enabled,
      connected: this.connected,
      authenticated: this.authenticated,
      cloudUrl: this.config.cloudUrl || null,
    };
  }
}

let instance = null;

module.exports = {
  CloudConnector,
  getInstance: () => instance,
  init: (config, ctx) => {
    instance = new CloudConnector(config, ctx);
    return instance;
  },
};
