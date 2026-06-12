/**
 * Citadel Cloud WS client — opens a single WebSocket to
 * `wss://<cloudUrl>/ws/plugin`, authenticates with the Server ID + API key
 * the operator pasted from citadels.cc, and stays connected.
 *
 * Ported from citadel-cloud/packages/plugin/src/ws-client.ts (TypeScript ESM)
 * to CommonJS. The protocol surface mirrors that file 1:1 so future cloud-
 * side protocol changes stay obvious to diff against.
 *
 * Lifecycle (matches the supervisor's expectations):
 *   start()                        → opens the socket, sends auth
 *   stop()                         → 1000-close, suppress reconnect
 *   send(msg)                      → forwards a PluginToCloudMessage
 * Events emitted (EventEmitter):
 *   'authenticated' (serverId)     → cloud accepted the auth
 *   'auth-failed'   (reason)       → cloud refused; will not retry until the
 *                                    next start() call (key probably wrong)
 *   'disconnected'  ({code, reason}) → socket closed; we WILL retry with
 *                                    exponential backoff unless stop() was
 *                                    called or the last close was 4008.
 *   'message'       (msg)          → any non-auth message from the cloud
 *
 * Reconnect policy:
 *   - On a non-auth close (network blip, idle timeout, supersede): backoff
 *     1s → 2s → 4s → ... cap 30s. Resets to 1s on successful auth.
 *   - On a CLOSE_AUTH_FAILED (4008): we stop reconnecting. The supervisor
 *     reopens us when the operator re-pastes credentials.
 *   - On a CLOSE_SUPERSEDED (4007): same backoff as a normal close. This
 *     means another agent (or a stale process) is using the same key — the
 *     supervisor is expected to log it loudly so the operator notices.
 */
const WebSocket = require('ws');
const { EventEmitter } = require('events');
const logger = require('../logger');

// Mirrors plugin-ws.routes.ts close codes — kept here so we can branch on
// them in JS without importing the TS shared types.
const CLOSE_NORMAL = 1000;
const CLOSE_AUTH_TIMEOUT = 4001;
const CLOSE_PROTOCOL_VIOLATION = 4002;
const CLOSE_IDLE_TIMEOUT = 4004;
const CLOSE_SUPERSEDED = 4007;
const CLOSE_AUTH_FAILED = 4008;

const DEFAULT_PING_INTERVAL_MS = 30_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

class CloudWsClient extends EventEmitter {
  /**
   * @param {object} cfg
   * @param {string} cfg.cloudUrl        e.g. 'https://api.citadels.cc' (we'll ws-ify it)
   * @param {string} cfg.apiKey          raw API key from /api/v1/plugin-servers
   * @param {string} cfg.pluginVersion   short string, e.g. '2.19.0'
   * @param {string} cfg.gameVersion     e.g. '1.27'
   * @param {string} cfg.serverName      DayZ server name (the hostname shown in the launcher)
   * @param {string} cfg.map             e.g. 'chernarusplus'
   * @param {number} cfg.maxPlayers      0..1024
   * @param {number} [cfg.pingIntervalMs] defaults to 30_000
   */
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this._ws = null;
    this._reconnectDelay = INITIAL_RECONNECT_MS;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._stopped = false;
    this._authed = false;
    this._lastAuthFailed = false;   // gate: don't auto-retry past a 4008
  }

  // ─── Public API ────────────────────────────────────────────────────

  start() {
    this._stopped = false;
    this._lastAuthFailed = false;
    this._connect();
  }

  stop() {
    this._stopped = true;
    this._clearTimers();
    if (this._ws) {
      try { this._ws.close(CLOSE_NORMAL, 'Agent shutting down'); } catch { /* ignore */ }
      this._ws = null;
    }
  }

  isAuthenticated() {
    return this._authed && this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  /** Forward a PluginToCloudMessage. No-op (warn-logged) if not connected. */
  send(message) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      logger.debug({ type: message?.type }, 'cloud-ws: drop send — not connected');
      return false;
    }
    try {
      this._ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      logger.warn({ err: err.message, type: message?.type }, 'cloud-ws: send failed');
      return false;
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────

  _wsUrl() {
    // Cloud config matches packages/plugin/src/config.ts wsUrl():
    // strip trailing slash, swap http→ws, append `/ws/plugin`.
    const base = (this.cfg.cloudUrl || 'https://api.citadels.cc').replace(/\/$/, '');
    return base.replace(/^http/, 'ws') + '/ws/plugin';
  }

  _connect() {
    if (this._stopped) return;
    const url = this._wsUrl();

    // Security (Audit P3): never authenticate over a plaintext ws:// to a
    // REMOTE host — the cloud API key would cross the wire unencrypted, and an
    // http:// cloud URL silently becomes ws:// in _wsUrl(). Allow ws:// only to
    // loopback (local cloud dev); require wss:// for anything else. We refuse
    // rather than downgrade, and don't schedule a reconnect (it's a config
    // error that needs the URL fixed, not a transient failure).
    if (url.startsWith('ws://')) {
      let host = '';
      try { host = new URL(url).hostname; } catch { /* unparseable — treat as remote */ }
      const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      if (!isLoopback) {
        logger.error({ url }, 'cloud-ws: refusing to connect over plaintext ws:// to a remote host — set the cloud URL to https:// (wss://). Not connecting.');
        return;
      }
    }

    logger.info({ url }, 'cloud-ws: connecting');

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      logger.warn({ err: err.message }, 'cloud-ws: WebSocket() threw — scheduling retry');
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;
    this._authed = false;

    ws.on('open', () => {
      logger.debug('cloud-ws: socket open, sending auth');
      this._sendAuth();
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch {
        logger.warn('cloud-ws: invalid JSON from cloud');
        return;
      }
      this._handleMessage(msg);
    });

    ws.on('close', (code, reasonBuf) => {
      const reason = reasonBuf ? reasonBuf.toString() : '';
      logger.info({ code, reason }, 'cloud-ws: closed');
      this._authed = false;
      this._clearTimers();
      this.emit('disconnected', { code, reason });

      if (this._stopped) return;

      // 4008 = auth refused; 4002 = protocol violation (e.g. a structurally
      // invalid auth payload such as a truncated <32-char API key, which the
      // cloud rejects at the schema before reaching the auth check). Both are
      // fatal credential/payload problems: reconnecting would re-send the same
      // bad auth forever (a flapping loop with no terminal state). Stop and let
      // the supervisor reopen us when the operator fixes/updates the link.
      if (code === CLOSE_AUTH_FAILED || code === CLOSE_PROTOCOL_VIOLATION) {
        this._lastAuthFailed = true;
        return;
      }
      this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      // 'error' precedes 'close' on connect failure. Just log; the close
      // handler does the reconnect bookkeeping.
      logger.warn({ err: err.message }, 'cloud-ws: socket error');
    });
  }

  _sendAuth() {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    const authMsg = {
      type: 'auth',
      api_key: this.cfg.apiKey,
      plugin_version: this.cfg.pluginVersion,
      game_version: this.cfg.gameVersion,
      server_name: this.cfg.serverName,
      map: this.cfg.map,
      max_players: this.cfg.maxPlayers,
    };
    try {
      this._ws.send(JSON.stringify(authMsg));
    } catch (err) {
      logger.warn({ err: err.message }, 'cloud-ws: auth send failed');
    }
  }

  _handleMessage(msg) {
    switch (msg?.type) {
      case 'auth_ok': {
        this._authed = true;
        this._reconnectDelay = INITIAL_RECONNECT_MS;   // reset backoff
        this._lastAuthFailed = false;
        const pingMs = (msg.config?.push_interval ?? 30) * 1000;
        this._startPingLoop(Math.max(10_000, pingMs));
        logger.info({ cloudServerId: msg.server_id }, 'cloud-ws: authenticated');
        this.emit('authenticated', msg.server_id);
        return;
      }
      case 'auth_error': {
        this._authed = false;
        // The cloud sends the actionable, customer-facing sentence in `message`
        // (e.g. "API key has been revoked. Visit citadels.cc/account..."); read
        // it first, keeping `reason` as a forward-compat fallback. Surfacing
        // this string in the status lets the operator self-serve instead of
        // seeing a generic 'unknown'.
        const reason = msg.message || msg.reason || 'unknown';
        logger.warn({ reason }, 'cloud-ws: auth refused');
        this.emit('auth-failed', reason);
        // Server should close us with 4008 next; we don't preempt the close.
        return;
      }
      case 'pong':
        // Heartbeat ack — nothing to do; idle timer resets on any message
        // server-side, so the ping itself is what keeps the link alive.
        return;
      default:
        this.emit('message', msg);
    }
  }

  _startPingLoop(intervalMs) {
    this._clearPingTimer();
    const ping = () => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
      try {
        this._ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      } catch (err) {
        logger.debug({ err: err.message }, 'cloud-ws: ping send failed');
      }
    };
    // Use the smaller of the cloud-suggested push_interval and the safe default;
    // cloud's idle timeout is 60s, so 30s is the right ceiling regardless.
    const safe = Math.min(intervalMs, DEFAULT_PING_INTERVAL_MS);
    this._pingTimer = setInterval(ping, safe);
  }

  _scheduleReconnect() {
    if (this._stopped || this._reconnectTimer) return;
    const delay = this._reconnectDelay;
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, MAX_RECONNECT_MS);
    logger.debug({ delayMs: delay }, 'cloud-ws: scheduling reconnect');
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _clearPingTimer() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }
  _clearReconnectTimer() {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
  }
  _clearTimers() {
    this._clearPingTimer();
    this._clearReconnectTimer();
  }
}

module.exports = {
  CloudWsClient,
  CLOSE_AUTH_TIMEOUT,
  CLOSE_PROTOCOL_VIOLATION,
  CLOSE_IDLE_TIMEOUT,
  CLOSE_SUPERSEDED,
  CLOSE_AUTH_FAILED,
};
