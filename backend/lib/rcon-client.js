/**
 * BattlEye RCON (UDP) client for DayZ server management.
 */
const dgram = require('dgram');
const { Buffer } = require('buffer');
const logger = require('./logger');
const ctx = require('./context');

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
    this.keepAliveInterval = null;
    this.lastFPS = 0; this.monitorEnabled = false;
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
      const loginTimeout = setTimeout(() => reject(new Error('RCON login timed out')), 10000);
      this.socket.on('message', (msg) => {
        if (msg.length < 7 || msg[0] !== 0x42 || msg[1] !== 0x45) return;
        const type = msg[6]; const payload = msg.slice(7);
        switch (type) {
          case 0x00:
            clearTimeout(loginTimeout);
            if (payload[0] === 0x01) { this.loggedIn = true; this._startKeepAlive(); resolve(true); }
            else reject(new Error('RCON login failed: invalid password'));
            break;
          case 0x01:
            if (payload.length >= 1) {
              const seq = payload[0]; const body = payload.slice(1).toString('utf8');
              const pending = this.pendingCommands.get(seq);
              if (pending) { clearTimeout(pending.timeout); pending.resolve(body); this.pendingCommands.delete(seq); }
            }
            break;
          case 0x02:
            if (payload.length >= 1) {
              const seq = payload[0]; const message = payload.slice(1).toString('utf8');
              const ack = this._buildAckPacket(seq);
              this.socket.send(ack, 0, ack.length, this.port, this.ip);
              const fpsMatch = message.match(/Server\s*FPS:\s*(\d+(?:\.\d+)?)/i);
              if (fpsMatch) this.lastFPS = parseFloat(fpsMatch[1]);
              if (ctx.io) ctx.io.emit('rconMessage', { serverId: this.serverId, timestamp: new Date().toISOString(), message });
            }
            break;
        }
      });
      this.socket.on('error', (err) => { logger.warn({ err }, 'RCON socket error'); this.connected = false; this.loggedIn = false; });
      this.socket.on('close', () => { this.connected = false; this.loggedIn = false; this._stopKeepAlive(); });
      this.socket.bind(0, () => {
        this.connected = true;
        const pkt = this._buildLoginPacket();
        this.socket.send(pkt, 0, pkt.length, this.port, this.ip);
      });
    });
  }

  disconnect() {
    this._stopKeepAlive(); this.loggedIn = false; this.connected = false;
    for (const [, p] of this.pendingCommands) { clearTimeout(p.timeout); p.reject(new Error('Disconnected')); }
    this.pendingCommands.clear();
    if (this.socket) { try { this.socket.close(); } catch (err) { logger.debug({ err }, 'RCON socket close error'); } this.socket = null; }
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    this.keepAliveInterval = setInterval(async () => {
      if (this.loggedIn && this.socket) {
        try {
          const result = await this.send('');
          if (result === '[No response]' || (typeof result === 'string' && result.startsWith('[Error]'))) {
            logger.warn({ serverId: this.serverId }, 'RCON keepalive got no response — marking connection stale');
            this.loggedIn = false;
          }
        } catch (err) {
          logger.warn({ err, serverId: this.serverId }, 'RCON keepalive error — marking connection stale');
          this.loggedIn = false;
        }
      }
    }, 30000);
  }

  _stopKeepAlive() { if (this.keepAliveInterval) { clearInterval(this.keepAliveInterval); this.keepAliveInterval = null; } }

  async send(command) {
    if (!this.loggedIn) { try { await this.connect(); } catch (err) { return `[Error] ${err.message}`; } }
    return new Promise((resolve) => {
      const { packet, seq } = this._buildCommandPacket(command);
      const timeout = setTimeout(() => { this.pendingCommands.delete(seq); resolve('[No response]'); }, 5000);
      this.pendingCommands.set(seq, { resolve, reject: () => {}, timeout });
      this.socket.send(packet, 0, packet.length, this.port, this.ip);
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
