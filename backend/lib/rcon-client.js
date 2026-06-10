/**
 * BattlEye RCON (UDP) client for DayZ server management.
 */
const dgram = require('dgram');
const { Buffer } = require('buffer');
const logger = require('./logger');
const ctx = require('./context');
const { RCON_LOGIN_TIMEOUT_MS, RCON_COMMAND_TIMEOUT_MS, RCON_KEEPALIVE_INTERVAL_MS, RCON_STALE_TIMEOUT_MS } = require('./constants');

// CRC32 lookup table (BattlEye protocol requirement)
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let crc = i; for (let j = 0; j < 8; j++) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1); table[i] = crc; }
  return table;
})();

function computeCRC32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) crc = crc32Table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

class RCONClient {
  constructor(ip, port, password, serverId) {
    this.ip = ip; this.port = port; this.password = password;
    this.serverId = serverId || null;
    this.socket = null; this.connected = false; this.loggedIn = false;
    this.sequenceNum = 0; this.pendingCommands = new Map();
    // Buffers for re-assembling multi-part command responses, keyed by sequence.
    // BattlEye fragments responses larger than ~512 bytes (big player/ban lists)
    // across several UDP packets; each carries [seq, 0x00, total, index, ...part].
    this.multipartBuffers = new Map();
    this.keepAliveInterval = null;
    this.lastFPS = 0; this.monitorEnabled = false;
    // Timestamp of the last valid packet received (any type). Used to detect a
    // silently-dead connection independent of the keepalive send/ack path.
    this.lastResponseAt = 0;
  }

  /**
   * Verify a received packet's BattlEye CRC32. The 4-byte little-endian
   * checksum at bytes 2..5 covers everything from byte 6 to the end (the same
   * range this client checksums when building outbound packets, and the same
   * range the server checksums when building responses).
   *
   * @param {Buffer} msg
   * @returns {boolean} true if the checksum matches
   */
  _verifyChecksum(msg) {
    if (msg.length < 7) return false;
    const expected = msg.readUInt32LE(2);
    const actual = computeCRC32(msg.slice(6));
    return expected === actual;
  }

  _buildPacket(payload) {
    const body = Buffer.concat([Buffer.from([0xFF]), payload]);
    const crc = computeCRC32(body);
    const header = Buffer.alloc(6);
    header[0] = 0x42; header[1] = 0x45; header.writeUInt32LE(crc, 2);
    return Buffer.concat([header, body]);
  }

  _buildLoginPacket() { return this._buildPacket(Buffer.concat([Buffer.from([0x00]), Buffer.from(this.password, 'utf8')])); }

  _buildCommandPacket(command) {
    const seq = this.sequenceNum % 256; this.sequenceNum++;
    return { packet: this._buildPacket(Buffer.concat([Buffer.from([0x01, seq]), Buffer.from(command, 'utf8')])), seq };
  }

  _buildAckPacket(seq) { return this._buildPacket(Buffer.from([0x02, seq])); }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.connected && this.loggedIn) return resolve(true);
      this.disconnect();
      this.socket = dgram.createSocket('udp4');
      let settled = false;
      const loginTimeout = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('RCON login timed out')); }
      }, RCON_LOGIN_TIMEOUT_MS);
      this.socket.on('message', (msg) => {
        if (msg.length < 7 || msg[0] !== 0x42 || msg[1] !== 0x45) return;
        // Drop packets whose CRC32 does not match — corrupted/spoofed UDP.
        if (!this._verifyChecksum(msg)) {
          logger.debug({ serverId: this.serverId }, 'RCON: dropping packet with bad CRC32');
          return;
        }
        this.lastResponseAt = Date.now();
        const type = msg[6]; const payload = msg.slice(7);
        switch (type) {
          case 0x00:
            clearTimeout(loginTimeout);
            if (payload.length >= 1 && payload[0] === 0x01) {
              this.loggedIn = true; this._startKeepAlive();
              if (!settled) { settled = true; resolve(true); }
            } else {
              if (!settled) { settled = true; reject(new Error('RCON login failed: invalid password')); }
            }
            break;
          case 0x01:
            this._handleCommandResponse(payload);
            break;
          case 0x02:
            if (payload.length >= 1) {
              const seq = payload[0]; const message = payload.slice(1).toString('utf8');
              try {
                const ack = this._buildAckPacket(seq);
                if (this.socket) this.socket.send(ack, 0, ack.length, this.port, this.ip);
              } catch (err) { logger.debug({ err }, 'RCON ACK send failed'); }
              const fpsMatch = message.match(/Server\s*FPS:\s*(\d+(?:\.\d+)?)/i);
              if (fpsMatch) this.lastFPS = parseFloat(fpsMatch[1]);
              try { if (ctx.io) ctx.emitServer('rconMessage', { serverId: this.serverId, timestamp: new Date().toISOString(), message }); } catch { /* ignore */ }
            }
            break;
        }
      });
      this.socket.on('error', (err) => {
        logger.warn({ err }, 'RCON socket error');
        this.connected = false; this.loggedIn = false;
        if (!settled) { settled = true; reject(new Error(`RCON socket error: ${err.message}`)); }
      });
      this.socket.on('close', () => { this.connected = false; this.loggedIn = false; this._stopKeepAlive(); });
      this.socket.bind(0, () => {
        this.connected = true;
        try {
          const pkt = this._buildLoginPacket();
          this.socket.send(pkt, 0, pkt.length, this.port, this.ip);
        } catch (err) {
          if (!settled) { settled = true; reject(new Error(`RCON bind send failed: ${err.message}`)); }
        }
      });
    });
  }

  /**
   * Handle a command-response packet (BattlEye type 0x01). The payload (bytes
   * after the type byte) is either:
   *   single-part:  [seq, ...utf8 body]
   *   multi-part:   [seq, 0x00, total, index, ...part]
   * Multi-part responses are buffered by sequence and only resolve the pending
   * command once every fragment has arrived.
   *
   * @param {Buffer} payload
   */
  _handleCommandResponse(payload) {
    if (!payload || payload.length < 1) return;
    const seq = payload[0];

    let body;
    if (payload.length >= 4 && payload[1] === 0x00) {
      // Multi-part fragment: [seq, 0x00, total, index, ...part]
      const total = payload[2];
      const index = payload[3];
      const part = payload.slice(4);
      body = this._collectMultipart(seq, total, index, part);
      if (body === null) return; // still waiting for more fragments
    } else {
      // Single-part response: everything after the sequence byte is the body.
      body = payload.slice(1).toString('utf8');
    }

    const pending = this.pendingCommands.get(seq);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(body);
      this.pendingCommands.delete(seq);
    }
    this.multipartBuffers.delete(seq);
  }

  /**
   * Accumulate one multi-part fragment. Returns the fully re-assembled body
   * string once all fragments for the sequence have arrived, otherwise null.
   *
   * @param {number} seq
   * @param {number} total - total fragment count for this response
   * @param {number} index - this fragment's index (0-based)
   * @param {Buffer} part  - this fragment's payload bytes
   * @returns {string|null}
   */
  _collectMultipart(seq, total, index, part) {
    if (!total || index >= total) return null; // malformed header — ignore
    let buf = this.multipartBuffers.get(seq);
    // Reset if this is a new response (different total) for a reused sequence.
    if (!buf || buf.total !== total) {
      buf = { total, parts: new Array(total), received: 0 };
      this.multipartBuffers.set(seq, buf);
    }
    if (!buf.parts[index]) {
      buf.parts[index] = part;
      buf.received++;
    }
    if (buf.received === total) {
      return Buffer.concat(buf.parts).toString('utf8');
    }
    return null;
  }

  disconnect() {
    this._stopKeepAlive(); this.loggedIn = false; this.connected = false;
    for (const [, p] of this.pendingCommands) { clearTimeout(p.timeout); p.resolve('[Disconnected]'); }
    this.pendingCommands.clear();
    this.multipartBuffers.clear();
    if (this.socket) {
      try { this.socket.removeAllListeners(); } catch { /* ignore */ }
      try { this.socket.close(); } catch (err) { logger.debug({ err }, 'RCON socket close error'); }
      this.socket = null;
    }
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    // Mark the connection fresh so the staleness check has a baseline.
    this.lastResponseAt = Date.now();
    this.keepAliveInterval = setInterval(async () => {
      if (this.loggedIn && this.socket) {
        // Stale-connection guard: if we have not received ANY valid packet in
        // RCON_STALE_TIMEOUT_MS, treat the link as dead and reconnect, even if
        // socket.send() keeps appearing to succeed (UDP has no delivery proof).
        if (this.lastResponseAt && (Date.now() - this.lastResponseAt) > RCON_STALE_TIMEOUT_MS) {
          logger.warn({ serverId: this.serverId, silentMs: Date.now() - this.lastResponseAt }, 'RCON connection stale — reconnecting');
          this.disconnect();
          setTimeout(() => {
            this.connect().catch(err => {
              logger.debug({ err: err.message, serverId: this.serverId }, 'RCON auto-reconnect failed');
            });
          }, 3000);
          return;
        }
        try {
          const result = await this.send('');
          if (result === '[No response]' || (typeof result === 'string' && result.startsWith('[Error]'))) {
            logger.warn({ serverId: this.serverId }, 'RCON keepalive got no response — reconnecting');
            this.disconnect();
            // Schedule reconnect after a short delay to avoid tight loops
            setTimeout(() => {
              this.connect().catch(err => {
                logger.debug({ err: err.message, serverId: this.serverId }, 'RCON auto-reconnect failed');
              });
            }, 3000);
          }
        } catch (err) {
          logger.warn({ err, serverId: this.serverId }, 'RCON keepalive error — reconnecting');
          this.disconnect();
          setTimeout(() => {
            this.connect().catch(reconnErr => {
              logger.debug({ err: reconnErr.message, serverId: this.serverId }, 'RCON auto-reconnect failed');
            });
          }, 3000);
        }
      }
    }, RCON_KEEPALIVE_INTERVAL_MS);
  }

  _stopKeepAlive() { if (this.keepAliveInterval) { clearInterval(this.keepAliveInterval); this.keepAliveInterval = null; } }

  async send(command) {
    if (!this.loggedIn) { try { await this.connect(); } catch (err) { return `[Error] ${err.message}`; } }
    if (!this.socket || !this.connected) return '[Error] RCON not connected';
    return new Promise((resolve) => {
      const { packet, seq } = this._buildCommandPacket(command);
      // Drop any leftover fragments from a previous command that reused this seq.
      this.multipartBuffers.delete(seq);
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(seq);
        this.multipartBuffers.delete(seq);
        resolve('[No response]');
      }, RCON_COMMAND_TIMEOUT_MS);
      this.pendingCommands.set(seq, { resolve, reject: () => {}, timeout });
      try {
        this.socket.send(packet, 0, packet.length, this.port, this.ip);
      } catch (err) {
        clearTimeout(timeout);
        this.pendingCommands.delete(seq);
        logger.warn({ err, serverId: this.serverId }, 'RCON socket.send() failed');
        resolve(`[Error] ${err.message}`);
      }
    });
  }

  async getPlayers() { return this.send('players'); }
  async kick(id, reason) { return this.send(`kick ${id} ${reason || 'Kicked by admin'}`); }
  async ban(id, reason, duration = -1) { return this.send(`ban ${id} ${duration} ${reason || 'Banned'}`); }
  async say(message) { return this.send(`say -1 ${message}`); }
  async shutdown() { return this.send('#shutdown'); }
  async restart() { return this.send('#restart'); }
  async lock() { return this.send('#lock'); }
  async unlock() { return this.send('#unlock'); }
  async enableMonitor() {
    if (this.monitorEnabled) return;
    try { await this.send('#monitor 1'); this.monitorEnabled = true; } catch (err) { logger.debug({ err }, 'Failed to enable RCON monitor'); }
  }
  getFPS() { return this.lastFPS; }
}

module.exports = RCONClient;
