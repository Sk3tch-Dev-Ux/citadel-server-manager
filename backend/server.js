/**
 * DayZ Server Panel - Backend API
 * 
 * This Express server acts as the central hub connecting:
 *   - The Web Dashboard (React frontend)
 *   - The Discord Bot (button-based controls)
 *   - The actual DayZ server (via RCON / BattlEye / file system)
 * 
 * Environment Variables (see .env.example):
 *   PORT, DAYZ_SERVER_IP, DAYZ_RCON_PORT, RCON_PASSWORD,
 *   DAYZ_INSTALL_DIR, JWT_SECRET, DISCORD_WEBHOOK_URL
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, { cors: { origin: '*' } });

// ─── Config ──────────────────────────────────────────────
const CONFIG = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  dayz: {
    ip: process.env.DAYZ_SERVER_IP || '127.0.0.1',
    rconPort: parseInt(process.env.DAYZ_RCON_PORT || '2305'),
    rconPassword: process.env.RCON_PASSWORD || '',
    installDir: process.env.DAYZ_INSTALL_DIR || '/home/dayz/server',
    profileDir: process.env.DAYZ_PROFILE_DIR || '/home/dayz/server/profiles',
    executable: process.env.DAYZ_EXECUTABLE || 'DayZServer_x64.exe',
    startBat: process.env.DAYZ_START_BAT || '',  // e.g. 'start.bat' — if set, uses this instead of launching exe directly
    launchParams: process.env.DAYZ_LAUNCH_PARAMS || '-config=serverDZ.cfg -port=2302 -dologs -adminlog -netlog -freezecheck',
  },
  webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
};

// ─── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

// ─── In-Memory Store (replace with DB in production) ─────
let store = {
  users: [],                // { id, username, passwordHash, role }
  serverStatus: 'stopped',  // stopped | starting | running | stopping | crashed
  players: [],              // { id, name, ip, ping, joinedAt }
  logs: [],                 // { timestamp, level, source, message }
  scheduledRestarts: [],    // { id, cronExpression, label, enabled }
  modList: [],              // { name, workshopId, enabled, order }
  metrics: {                // rolling window of server metrics
    cpu: [],
    ram: [],
    players: [],
    fps: [],
    timestamps: [],
  },
  chatMessages: [],         // { timestamp, player, message }
  banList: [],              // { id, name, reason, bannedAt, expiresAt }
  config: {},               // populated from serverDZ.cfg at startup
};

// ─── serverDZ.cfg Parser & Writer ────────────────────────
// Reads the actual DayZ server config file and maps values to store.config.
// Also writes changes back to the file preserving comments and structure.

function getServerCfgPath() {
  return path.join(CONFIG.dayz.installDir, 'serverDZ.cfg');
}

// Parse serverDZ.cfg into a JS object
function readServerConfig() {
  const cfgPath = getServerCfgPath();
  const config = {};

  if (!fs.existsSync(cfgPath)) {
    addLog('warn', 'config', `serverDZ.cfg not found at ${cfgPath}`);
    return config;
  }

  try {
    const content = fs.readFileSync(cfgPath, 'utf8');
    const lines = content.split('\n');

    for (const line of lines) {
      // Skip comments, empty lines, class blocks
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('class') || trimmed === '{' || trimmed === '};') continue;

      // Match: key = value; or key = "value";
      const match = trimmed.match(/^([\w]+)\s*=\s*(.+?)\s*;/);
      if (match) {
        const key = match[1];
        let value = match[2].trim();

        // Strip inline comments: "value" // comment  OR  value // comment
        const commentIdx = value.indexOf('//');
        if (commentIdx > 0) {
          value = value.substring(0, commentIdx).trim();
        }

        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        // Convert numeric strings to numbers
        if (/^\d+$/.test(value)) {
          value = parseInt(value, 10);
        } else if (/^\d+\.\d+$/.test(value)) {
          value = parseFloat(value);
        }

        config[key] = value;
      }
    }

    addLog('info', 'config', `Loaded serverDZ.cfg: ${Object.keys(config).length} settings parsed`);
  } catch (err) {
    addLog('error', 'config', `Failed to read serverDZ.cfg: ${err.message}`);
  }

  return config;
}

// Write config changes back to serverDZ.cfg, preserving comments and structure
function writeServerConfig(updates) {
  const cfgPath = getServerCfgPath();

  if (!fs.existsSync(cfgPath)) {
    addLog('error', 'config', `Cannot write — serverDZ.cfg not found at ${cfgPath}`);
    return false;
  }

  try {
    // Backup first
    const backupDir = path.join(CONFIG.dayz.installDir, '.backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(cfgPath, path.join(backupDir, `serverDZ.cfg.${Date.now()}.bak`));

    let content = fs.readFileSync(cfgPath, 'utf8');

    for (const [key, value] of Object.entries(updates)) {
      // Build the replacement value
      const strValue = typeof value === 'string' ? `"${value}"` : String(value);

      // Match the existing line: key = value; // optional comment
      const regex = new RegExp(`^(\\s*${key}\\s*=\\s*).+?(\\s*;.*)$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `$1${strValue}$2`);
      } else {
        addLog('warn', 'config', `Key "${key}" not found in serverDZ.cfg, skipping`);
      }
    }

    fs.writeFileSync(cfgPath, content, 'utf8');
    addLog('info', 'config', `serverDZ.cfg updated: ${Object.keys(updates).join(', ')}`);
    return true;
  } catch (err) {
    addLog('error', 'config', `Failed to write serverDZ.cfg: ${err.message}`);
    return false;
  }
}

// Load config from serverDZ.cfg at startup
store.config = readServerConfig();

// Initialize default admin account
(async () => {
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin', 10);
  store.users.push({
    id: '1',
    username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: hash,
    role: 'admin',
  });
})();
// ─── Process Tracking ────────────────────────────────
let dayzProcess = null;       // child_process reference when we launch the server
let dayzProcessPID = null;    // PID of the DayZ server (may be externally launched)

// Check if DayZServer_x64.exe is running (Windows)
function detectRunningProcess() {
  return new Promise((resolve) => {
    exec(`tasklist /FI "IMAGENAME eq ${CONFIG.dayz.executable}" /FO CSV /NH`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      // tasklist CSV output: "DayZServer_x64.exe","12345","Console","1","2,048,000 K"
      const lines = stdout.trim().split('\n').filter(l => l.includes(CONFIG.dayz.executable));
      if (lines.length > 0) {
        const match = lines[0].match(/"[^"]+","(\d+)"/);
        return resolve(match ? parseInt(match[1]) : null);
      }
      resolve(null);
    });
  });
}

// Get real CPU and RAM usage of the DayZ server process (Windows)
function getProcessMetrics(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(null);
    // Use WMIC to get WorkingSetSize (bytes) and PercentProcessorTime
    exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (err, stdout) => {
      if (err || !stdout || !stdout.includes(CONFIG.dayz.executable)) {
        return resolve(null);
      }
      // Parse memory from tasklist: "DayZServer_x64.exe","PID","Console","1","2,048,000 K"
      const memMatch = stdout.match(/"([\d,]+)\s*K"/);
      const ramKB = memMatch ? parseInt(memMatch[1].replace(/,/g, '')) : 0;
      const ramMB = Math.round(ramKB / 1024);

      // Get CPU via wmic (percentage of one core)
      exec(`wmic path Win32_PerfFormattedData_PerfProc_Process where "IDProcess=${pid}" get PercentProcessorTime /value`, (err2, stdout2) => {
        let cpu = 0;
        if (!err2 && stdout2) {
          const cpuMatch = stdout2.match(/PercentProcessorTime=(\d+)/);
          if (cpuMatch) cpu = parseInt(cpuMatch[1]);
        }
        resolve({ cpu, ram: ramMB });
      });
    });
  });
}

// Spawn the actual DayZ server process
function spawnDayZServer() {
  const installDir = CONFIG.dayz.installDir;

  // Prefer start.bat if configured — it contains all mod loading, CPU, config, etc.
  if (CONFIG.dayz.startBat) {
    const batPath = path.join(installDir, CONFIG.dayz.startBat);
    if (!fs.existsSync(batPath)) {
      throw new Error(`Start batch file not found at: ${batPath}`);
    }

    addLog('info', 'server', `Launching via batch file: ${batPath}`);

    // Run the batch file via cmd.exe. The start.bat itself uses "start" to launch
    // DayZServer_x64.exe, so we run the bat and let it handle everything.
    // We strip the auto-restart loop by launching only the core start command.
    const child = spawn('cmd.exe', ['/c', batPath], {
      cwd: installDir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });

    child.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) addLog('info', 'server', msg);
    });
    child.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) addLog('error', 'server', msg);
    });

    // Note: The bat file uses "start" which spawns DayZServer_x64.exe as a separate
    // process. The cmd.exe child will stay alive (due to the timeout/restart loop in
    // the bat). We track the actual DayZServer exe via detectRunningProcess().
    child.on('exit', (code) => {
      addLog('info', 'server', `Batch launcher exited with code ${code}`);
      // Don't mark as crashed — the DayZ exe runs independently.
      // The polling interval will detect if the exe itself dies.
    });

    child.on('error', (err) => {
      addLog('error', 'server', `Failed to launch batch file: ${err.message}`);
      store.serverStatus = 'crashed';
      io.emit('serverStatus', store.serverStatus);
    });

    child.unref();
    return child;
  }

  // Fallback: launch exe directly with params from .env
  const execPath = path.join(installDir, CONFIG.dayz.executable);
  const params = CONFIG.dayz.launchParams.split(' ').filter(Boolean);

  if (!fs.existsSync(execPath)) {
    throw new Error(`DayZ executable not found at: ${execPath}`);
  }

  addLog('info', 'server', `Launching directly: ${execPath} ${params.join(' ')}`);

  const child = spawn(execPath, params, {
    cwd: installDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (data) => {
    addLog('info', 'server', data.toString().trim());
  });
  child.stderr?.on('data', (data) => {
    addLog('error', 'server', data.toString().trim());
  });

  child.on('exit', (code) => {
    addLog('warn', 'server', `DayZ process exited with code ${code}`);
    dayzProcess = null;
    dayzProcessPID = null;
    if (store.serverStatus !== 'stopping' && store.serverStatus !== 'stopped') {
      store.serverStatus = 'crashed';
      io.emit('serverStatus', store.serverStatus);
      sendDiscordWebhook('💥 **DayZ Server Crashed** (process exited unexpectedly)');
    }
  });

  child.on('error', (err) => {
    addLog('error', 'server', `Failed to launch process: ${err.message}`);
    dayzProcess = null;
    dayzProcessPID = null;
    store.serverStatus = 'crashed';
    io.emit('serverStatus', store.serverStatus);
  });

  child.unref();
  return child;
}

// ─── Mod Auto-Detection ──────────────────────────────────
// Scans the server directory for @mod folders and checks start.bat for active mods.
function autoDetectMods() {
  const installDir = CONFIG.dayz.installDir;

  // 1. Find all @folders in the server directory (these are installed mods)
  let installedMods = [];
  try {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    installedMods = entries
      .filter(e => e.isDirectory() && e.name.startsWith('@'))
      .map(e => e.name);
  } catch (err) {
    addLog('error', 'mods', `Failed to scan mod directory: ${err.message}`);
    return;
  }

  // 2. Parse start.bat to find which mods are actually loaded (-mod= parameter)
  let activeMods = new Set();
  if (CONFIG.dayz.startBat) {
    const batPath = path.join(installDir, CONFIG.dayz.startBat);
    try {
      const batContent = fs.readFileSync(batPath, 'utf8');
      // Match -mod= or "-mod= parameter (handles quoted and unquoted)
      const modMatch = batContent.match(/["\s]-mod=([^"\n]+)/i) || batContent.match(/-mod=([^\s]+)/i);
      if (modMatch) {
        const modString = modMatch[1].replace(/["]/g, '').trim();
        modString.split(';').forEach(m => {
          const trimmed = m.trim();
          if (trimmed) activeMods.add(trimmed);
        });
      }
    } catch (err) {
      addLog('warn', 'mods', `Could not parse start.bat for mods: ${err.message}`);
    }
  }

  // 3. Build mod list: installed mods with active status from start.bat
  store.modList = installedMods.map((name, index) => {
    const isActive = activeMods.size === 0 ? true : activeMods.has(name);
    // Try to read mod meta.cpp for Workshop ID
    let workshopId = '';
    try {
      const metaPath = path.join(installDir, name, 'meta.cpp');
      if (fs.existsSync(metaPath)) {
        const meta = fs.readFileSync(metaPath, 'utf8');
        const idMatch = meta.match(/publishedid\s*=\s*(\d+)/i);
        if (idMatch) workshopId = idMatch[1];
      }
    } catch { /* ignore */ }

    return {
      name,
      workshopId,
      enabled: isActive,
      order: index,
    };
  });

  addLog('info', 'mods', `Detected ${installedMods.length} installed mods, ${activeMods.size} active in start.bat`);
  io.emit('mods', store.modList);
}

// Kill the DayZ server process (Windows)
function killDayZServer(pid) {
  return new Promise((resolve, reject) => {
    const targetPid = pid || dayzProcessPID;
    if (!targetPid) {
      // Fallback: kill by executable name
      exec(`taskkill /F /IM ${CONFIG.dayz.executable}`, (err) => {
        if (err) return reject(new Error(`Failed to kill ${CONFIG.dayz.executable}: ${err.message}`));
        resolve();
      });
      return;
    }
    exec(`taskkill /F /PID ${targetPid}`, (err) => {
      if (err) return reject(new Error(`Failed to kill PID ${targetPid}: ${err.message}`));
      resolve();
    });
  });
}
// ─── Helpers ─────────────────────────────────────────────
function addLog(level, source, message) {
  const entry = { timestamp: new Date().toISOString(), level, source, message };
  store.logs.unshift(entry);
  if (store.logs.length > 5000) store.logs.pop();
  io.emit('log', entry);
  return entry;
}

function pushMetrics(cpu, ram, playerCount, fps) {
  const now = new Date().toISOString();
  const m = store.metrics;
  m.cpu.push(cpu);
  m.ram.push(ram);
  m.players.push(playerCount);
  m.fps.push(fps);
  m.timestamps.push(now);
  // Keep last 360 entries (6 hours at 1/min)
  const max = 360;
  Object.keys(m).forEach((k) => {
    if (m[k].length > max) m[k] = m[k].slice(-max);
  });
  io.emit('metrics', { cpu, ram, players: playerCount, fps, timestamp: now });
}

async function sendDiscordWebhook(content, embeds) {
  if (!CONFIG.webhookUrl) return;
  try {
    const fetch = (await import('node-fetch')).default;
    await fetch(CONFIG.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds }),
    });
  } catch (err) {
    addLog('error', 'webhook', `Discord webhook failed: ${err.message}`);
  }
}

// ─── Auth Middleware ──────────────────────────────────────
function auth(requiredRole) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      const decoded = jwt.verify(token, CONFIG.jwtSecret);
      req.user = decoded;
      if (requiredRole && decoded.role !== requiredRole && decoded.role !== 'admin') {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

// ─── RCON Client (BattlEye RCON UDP Protocol) ───────────
// Implements the BattlEye RCon protocol directly via Node.js dgram.
// Protocol spec: https://www.battleye.com/downloads/BERConProtocol.txt
//
// Packet structure:
//   'B'(0x42) 'E'(0x45) [4-byte CRC32] [payload]
//
// Payload types (first byte):
//   0x00 = Login        → password (null-terminated)
//   0x01 = Command      → seq(1 byte) + command string
//   0x02 = Acknowledge  → seq(1 byte) (server→client message ack)
//
// Server responses:
//   0x00 = Login result → 0x01 success, 0x00 failure
//   0x01 = Command response → seq(1 byte) + body
//   0x02 = Server message   → seq(1 byte) + message text
const dgram = require('dgram');
const { Buffer } = require('buffer');

// CRC32 lookup table (standard CRC-32/ISO-HDLC)
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc;
  }
  return table;
})();

function computeCRC32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = crc32Table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

class RCONClient {
  constructor(ip, port, password) {
    this.ip = ip;
    this.port = port;
    this.password = password;
    this.socket = null;
    this.connected = false;
    this.loggedIn = false;
    this.sequenceNum = 0;
    this.pendingCommands = new Map();  // seq → { resolve, reject, timeout }
    this.keepAliveInterval = null;
    this.reconnectTimeout = null;
  }

  // Build a BattlEye RCON packet: 'B' 'E' [CRC32-LE] [0xFF] [payload]
  _buildPacket(payload) {
    const body = Buffer.concat([Buffer.from([0xFF]), payload]);
    const crc = computeCRC32(body);
    const header = Buffer.alloc(6);
    header[0] = 0x42; // 'B'
    header[1] = 0x45; // 'E'
    header.writeUInt32LE(crc, 2);
    return Buffer.concat([header, body]);
  }

  // Build login packet: type 0x00 + password bytes
  _buildLoginPacket() {
    const payload = Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from(this.password, 'utf8'),
    ]);
    return this._buildPacket(payload);
  }

  // Build command packet: type 0x01 + seq + command string
  _buildCommandPacket(command) {
    const seq = this.sequenceNum % 256;
    this.sequenceNum++;
    const payload = Buffer.concat([
      Buffer.from([0x01, seq]),
      Buffer.from(command, 'utf8'),
    ]);
    return { packet: this._buildPacket(payload), seq };
  }

  // Build acknowledge packet: type 0x02 + seq
  _buildAckPacket(seq) {
    const payload = Buffer.from([0x02, seq]);
    return this._buildPacket(payload);
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.connected && this.loggedIn) return resolve(true);

      // Clean up any existing socket
      this.disconnect();

      this.socket = dgram.createSocket('udp4');

      const loginTimeout = setTimeout(() => {
        addLog('error', 'rcon', 'Login timed out');
        reject(new Error('RCON login timed out'));
      }, 10000);

      this.socket.on('message', (msg) => {
        if (msg.length < 7 || msg[0] !== 0x42 || msg[1] !== 0x45) return;

        // Skip header (B E [4-byte CRC] 0xFF) → payload starts at index 7
        const type = msg[6];
        const payload = msg.slice(7);

        switch (type) {
          case 0x00: // Login response
            clearTimeout(loginTimeout);
            if (payload[0] === 0x01) {
              this.loggedIn = true;
              addLog('info', 'rcon', `Connected to RCON at ${this.ip}:${this.port}`);
              this._startKeepAlive();
              resolve(true);
            } else {
              addLog('error', 'rcon', 'RCON login failed — bad password');
              reject(new Error('RCON login failed: invalid password'));
            }
            break;

          case 0x01: // Command response
            if (payload.length >= 1) {
              const seq = payload[0];
              const body = payload.slice(1).toString('utf8');
              const pending = this.pendingCommands.get(seq);
              if (pending) {
                clearTimeout(pending.timeout);
                pending.resolve(body);
                this.pendingCommands.delete(seq);
              }
              if (body) addLog('info', 'rcon', `Response: ${body.substring(0, 500)}`);
            }
            break;

          case 0x02: // Server message (chat, connects, etc.)
            if (payload.length >= 1) {
              const seq = payload[0];
              const message = payload.slice(1).toString('utf8');
              // Acknowledge the server message
              const ack = this._buildAckPacket(seq);
              this.socket.send(ack, 0, ack.length, this.port, this.ip);
              addLog('info', 'rcon', `Server: ${message.substring(0, 500)}`);
              // Emit to WebSocket clients
              io.emit('rconMessage', { timestamp: new Date().toISOString(), message });
            }
            break;
        }
      });

      this.socket.on('error', (err) => {
        addLog('error', 'rcon', `Socket error: ${err.message}`);
        this.connected = false;
        this.loggedIn = false;
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.loggedIn = false;
        this._stopKeepAlive();
        addLog('warn', 'rcon', 'RCON socket closed');
      });

      // Bind to a random local port and send login
      this.socket.bind(0, () => {
        this.connected = true;
        const loginPkt = this._buildLoginPacket();
        this.socket.send(loginPkt, 0, loginPkt.length, this.port, this.ip);
      });
    });
  }

  disconnect() {
    this._stopKeepAlive();
    this.loggedIn = false;
    this.connected = false;
    // Reject any pending commands
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    }
    this.pendingCommands.clear();
    if (this.socket) {
      try { this.socket.close(); } catch { /* ignore */ }
      this.socket = null;
    }
  }

  // Keep-alive: send an empty command every 30s to prevent timeout
  _startKeepAlive() {
    this._stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (this.loggedIn && this.socket) {
        const { packet } = this._buildCommandPacket('');
        this.socket.send(packet, 0, packet.length, this.port, this.ip);
      }
    }, 30000);
  }

  _stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  async send(command) {
    if (!this.loggedIn) {
      try {
        await this.connect();
      } catch (err) {
        addLog('error', 'rcon', `Cannot send — not connected: ${err.message}`);
        return `[Error] ${err.message}`;
      }
    }

    return new Promise((resolve, reject) => {
      const { packet, seq } = this._buildCommandPacket(command);

      const timeout = setTimeout(() => {
        this.pendingCommands.delete(seq);
        resolve('[No response — command may have been executed]');
      }, 5000);

      this.pendingCommands.set(seq, { resolve, reject, timeout });
      this.socket.send(packet, 0, packet.length, this.port, this.ip);
      addLog('info', 'rcon', `Command sent: ${command}`);
    });
  }

  // ─── Convenience Methods ─────────────────────────────
  async getPlayers()       { return this.send('players'); }
  async kick(id, reason)   { return this.send(`kick ${id} ${reason}`); }
  async ban(id, reason)    { return this.send(`ban ${id} 0 ${reason}`); }
  async say(message)       { return this.send(`say -1 ${message}`); }
  async shutdown()         { return this.send('#shutdown'); }
  async restart()          { return this.send('#restart'); }
  async lock()             { return this.send('#lock'); }
  async unlock()           { return this.send('#unlock'); }
}

const rcon = new RCONClient(CONFIG.dayz.ip, CONFIG.dayz.rconPort, CONFIG.dayz.rconPassword);

// ─── API Routes ──────────────────────────────────────────

// Auth
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = store.users.find((u) => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, CONFIG.jwtSecret, { expiresIn: '24h' });
  addLog('info', 'auth', `User ${username} logged in`);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/auth/register', auth('admin'), async (req, res) => {
  const { username, password, role } = req.body;
  if (store.users.find((u) => u.username === username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), username, passwordHash: hash, role: role || 'moderator' };
  store.users.push(user);
  addLog('info', 'auth', `User ${username} created by ${req.user.username}`);
  res.json({ id: user.id, username: user.username, role: user.role });
});

// Server Control
app.get('/api/server/status', auth(), (req, res) => {
  res.json({
    status: store.serverStatus,
    players: store.players,
    playerCount: store.players.length,
    maxPlayers: store.config.maxPlayers || 60,
    serverName: store.config.hostname || 'DayZ Server',
    uptime: store.serverStatus === 'running' ? process.uptime() : 0,
  });
});

app.post('/api/server/start', auth('admin'), async (req, res) => {
  if (store.serverStatus === 'running') return res.status(400).json({ error: 'Server already running' });

  // Check if already running externally
  const existingPid = await detectRunningProcess();
  if (existingPid) {
    dayzProcessPID = existingPid;
    store.serverStatus = 'running';
    io.emit('serverStatus', store.serverStatus);
    addLog('info', 'server', `Found already-running DayZ server (PID: ${existingPid})`);
    return res.json({ message: `Server already running (PID: ${existingPid})` });
  }

  store.serverStatus = 'starting';
  io.emit('serverStatus', store.serverStatus);
  addLog('info', 'server', `Server start initiated by ${req.user.username}`);

  try {
    dayzProcess = spawnDayZServer();
    dayzProcessPID = dayzProcess.pid;
    addLog('info', 'server', `DayZ server launched with PID: ${dayzProcessPID}`);

    // Give the process a moment to either crash or start
    setTimeout(async () => {
      const pid = await detectRunningProcess();
      if (pid) {
        store.serverStatus = 'running';
        io.emit('serverStatus', store.serverStatus);
        addLog('info', 'server', 'DayZ server is now running');
        sendDiscordWebhook('🟢 **DayZ Server Started**');
      } else if (store.serverStatus === 'starting') {
        store.serverStatus = 'crashed';
        io.emit('serverStatus', store.serverStatus);
        addLog('error', 'server', 'DayZ server failed to stay running');
      }
    }, 8000);

    res.json({ message: `Server starting... (PID: ${dayzProcessPID})` });
  } catch (err) {
    store.serverStatus = 'crashed';
    io.emit('serverStatus', store.serverStatus);
    addLog('error', 'server', `Failed to start: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/server/stop', auth('admin'), async (req, res) => {
  if (store.serverStatus !== 'running') return res.status(400).json({ error: 'Server not running' });

  store.serverStatus = 'stopping';
  io.emit('serverStatus', store.serverStatus);
  addLog('info', 'server', `Server stop initiated by ${req.user.username}`);

  try {
    // Try graceful RCON shutdown first (only works if RCON is connected)
    if (rcon.loggedIn) {
      try {
        await rcon.shutdown();
        addLog('info', 'server', 'Sent RCON #shutdown, waiting for graceful exit...');
      } catch { /* ignore RCON errors, we\'ll force-kill below */ }
      // Wait a few seconds for graceful shutdown
      await new Promise(r => setTimeout(r, 5000));
    }

    // Check if still running, force-kill if needed
    const pid = await detectRunningProcess();
    if (pid) {
      addLog('info', 'server', `Force-killing DayZ server (PID: ${pid})`);
      await killDayZServer(pid);
    }

    store.serverStatus = 'stopped';
    store.players = [];
    dayzProcess = null;
    dayzProcessPID = null;
    io.emit('serverStatus', store.serverStatus);
    io.emit('players', store.players);
    addLog('info', 'server', 'Server stopped');
    sendDiscordWebhook('🔴 **DayZ Server Stopped**');
    res.json({ message: 'Server stopped' });
  } catch (err) {
    addLog('error', 'server', `Failed to stop: ${err.message}`);
    // Force status update even on error
    const stillRunning = await detectRunningProcess();
    if (!stillRunning) {
      store.serverStatus = 'stopped';
      io.emit('serverStatus', store.serverStatus);
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/server/restart', auth('admin'), async (req, res) => {
  addLog('info', 'server', `Server restart initiated by ${req.user.username}`);
  
  const { countdown } = req.body;
  
  if (countdown && store.serverStatus === 'running' && rcon.loggedIn) {
    // If RCON is available, warn players first
    await rcon.say(`SERVER RESTART IN ${countdown} SECONDS`);
    setTimeout(async () => {
      await performRestart(req.user.username);
    }, countdown * 1000);
    res.json({ message: `Restart scheduled in ${countdown}s` });
  } else {
    await performRestart(req.user.username);
    res.json({ message: 'Server restarting...' });
  }
});

// Shared restart logic
async function performRestart(initiator) {
  store.serverStatus = 'stopping';
  io.emit('serverStatus', store.serverStatus);

  // Kill existing process
  try {
    const pid = await detectRunningProcess();
    if (pid) {
      await killDayZServer(pid);
      addLog('info', 'server', 'Old server process killed');
    }
  } catch (err) {
    addLog('warn', 'server', `Error stopping for restart: ${err.message}`);
  }

  dayzProcess = null;
  dayzProcessPID = null;
  store.players = [];
  io.emit('players', store.players);

  // Wait a moment, then start fresh
  await new Promise(r => setTimeout(r, 3000));

  store.serverStatus = 'starting';
  io.emit('serverStatus', store.serverStatus);

  try {
    dayzProcess = spawnDayZServer();
    dayzProcessPID = dayzProcess.pid;
    addLog('info', 'server', `DayZ server relaunched with PID: ${dayzProcessPID}`);

    setTimeout(async () => {
      const pid = await detectRunningProcess();
      if (pid) {
        store.serverStatus = 'running';
        io.emit('serverStatus', store.serverStatus);
        addLog('info', 'server', 'DayZ server restarted successfully');
        sendDiscordWebhook('🔄 **DayZ Server Restarted**');
      } else if (store.serverStatus === 'starting') {
        store.serverStatus = 'crashed';
        io.emit('serverStatus', store.serverStatus);
        addLog('error', 'server', 'DayZ server failed to restart');
      }
    }, 8000);
  } catch (err) {
    store.serverStatus = 'crashed';
    io.emit('serverStatus', store.serverStatus);
    addLog('error', 'server', `Failed to restart: ${err.message}`);
  }
}

app.post('/api/server/lock', auth('admin'), async (req, res) => {
  await rcon.lock();
  addLog('info', 'server', `Server locked by ${req.user.username}`);
  res.json({ message: 'Server locked' });
});

app.post('/api/server/unlock', auth('admin'), async (req, res) => {
  await rcon.unlock();
  addLog('info', 'server', `Server unlocked by ${req.user.username}`);
  res.json({ message: 'Server unlocked' });
});

// RCON Command
app.post('/api/server/rcon', auth('admin'), async (req, res) => {
  const { command } = req.body;
  try {
    const result = await rcon.send(command);
    addLog('info', 'rcon', `Command by ${req.user.username}: ${command}`);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global Message
app.post('/api/server/message', auth(), async (req, res) => {
  const { message } = req.body;
  await rcon.say(message);
  addLog('info', 'chat', `Global message by ${req.user.username}: ${message}`);
  res.json({ message: 'Sent' });
});

// Players
app.get('/api/players', auth(), (req, res) => {
  res.json(store.players);
});

app.post('/api/players/:id/kick', auth(), async (req, res) => {
  const { reason } = req.body;
  await rcon.kick(req.params.id, reason || 'Kicked by admin');
  addLog('warn', 'player', `Player ${req.params.id} kicked by ${req.user.username}: ${reason}`);
  store.players = store.players.filter((p) => p.id !== req.params.id);
  io.emit('players', store.players);
  res.json({ message: 'Player kicked' });
});

app.post('/api/players/:id/ban', auth('admin'), async (req, res) => {
  const { reason, duration } = req.body;
  await rcon.ban(req.params.id, reason || 'Banned by admin');
  const player = store.players.find((p) => p.id === req.params.id);
  store.banList.push({
    id: req.params.id,
    name: player?.name || 'Unknown',
    reason: reason || 'Banned by admin',
    bannedAt: new Date().toISOString(),
    expiresAt: duration ? new Date(Date.now() + duration * 1000).toISOString() : null,
  });
  store.players = store.players.filter((p) => p.id !== req.params.id);
  addLog('warn', 'player', `Player ${req.params.id} banned by ${req.user.username}: ${reason}`);
  io.emit('players', store.players);
  res.json({ message: 'Player banned' });
});

app.get('/api/bans', auth(), (req, res) => {
  res.json(store.banList);
});

app.delete('/api/bans/:id', auth('admin'), (req, res) => {
  store.banList = store.banList.filter((b) => b.id !== req.params.id);
  addLog('info', 'player', `Ban removed for ${req.params.id} by ${req.user.username}`);
  res.json({ message: 'Ban removed' });
});

// Logs
app.get('/api/logs', auth(), (req, res) => {
  const { level, source, limit = 200 } = req.query;
  let logs = store.logs;
  if (level) logs = logs.filter((l) => l.level === level);
  if (source) logs = logs.filter((l) => l.source === source);
  res.json(logs.slice(0, parseInt(limit)));
});

// Metrics
app.get('/api/metrics', auth(), (req, res) => {
  res.json(store.metrics);
});

// Server Config
app.get('/api/config', auth('admin'), (req, res) => {
  // Re-read from disk to ensure freshness
  store.config = readServerConfig();
  res.json(store.config);
});

app.patch('/api/config', auth('admin'), (req, res) => {
  const updates = req.body;
  const success = writeServerConfig(updates);

  if (success) {
    // Re-read the full config from disk after writing
    store.config = readServerConfig();
    addLog('info', 'config', `Config updated by ${req.user.username}: ${JSON.stringify(updates)}`);
    res.json(store.config);
  } else {
    res.status(500).json({ error: 'Failed to write serverDZ.cfg' });
  }
});

// Mods
app.get('/api/mods', auth(), (req, res) => {
  res.json(store.modList);
});

app.post('/api/mods', auth('admin'), (req, res) => {
  const { name, workshopId } = req.body;
  const mod = { name, workshopId, enabled: true, order: store.modList.length };
  store.modList.push(mod);
  addLog('info', 'mods', `Mod added by ${req.user.username}: ${name} (${workshopId})`);
  res.json(mod);
});

app.patch('/api/mods/:workshopId', auth('admin'), (req, res) => {
  const mod = store.modList.find((m) => m.workshopId === req.params.workshopId);
  if (!mod) return res.status(404).json({ error: 'Mod not found' });
  Object.assign(mod, req.body);
  addLog('info', 'mods', `Mod updated by ${req.user.username}: ${mod.name}`);
  res.json(mod);
});

app.delete('/api/mods/:workshopId', auth('admin'), (req, res) => {
  store.modList = store.modList.filter((m) => m.workshopId !== req.params.workshopId);
  addLog('info', 'mods', `Mod removed by ${req.user.username}: ${req.params.workshopId}`);
  res.json({ message: 'Mod removed' });
});

// Scheduled Restarts
app.get('/api/schedule', auth(), (req, res) => {
  res.json(store.scheduledRestarts);
});

// ─── Steam Workshop Search & Browse ──────────────────────
// Searches the Steam Workshop for DayZ mods (AppID 221100).
// Uses Steam's public API endpoints — no API key required.

const DAYZ_APP_ID = 221100;

// Search Workshop by text query
app.get('/api/workshop/search', auth(), async (req, res) => {
  const { q, page = 1 } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' });
  }

  try {
    const fetch = (await import('node-fetch')).default;

    // Use Steam's public search page and parse results
    // The IPublishedFileService/QueryFiles works without key for basic searches
    const url = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/` +
      `?query_type=1` +
      `&page=${parseInt(page)}` +
      `&numperpage=20` +
      `&appid=${DAYZ_APP_ID}` +
      `&search_text=${encodeURIComponent(q.trim())}` +
      `&return_short_description=true` +
      `&return_metadata=true` +
      `&return_previews=true` +
      `&strip_description_bbcode=true` +
      `&filetype=0` +
      `&match_all_tags=false` +
      (process.env.STEAM_API_KEY ? `&key=${process.env.STEAM_API_KEY}` : '');

    const response = await fetch(url, { timeout: 10000 });
    const data = await response.json();

    if (!data.response || !data.response.publishedfiledetails) {
      // Fallback: scrape the Workshop HTML search page
      return await scrapeWorkshopSearch(req, res, q, page);
    }

    const results = data.response.publishedfiledetails.map(item => ({
      workshopId: item.publishedfileid,
      name: item.title || 'Unknown',
      description: (item.short_description || '').substring(0, 200),
      preview: item.preview_url || (item.previews?.[0]?.url) || '',
      subscribers: item.subscriptions || 0,
      favorites: item.favorited || 0,
      fileSize: item.file_size || 0,
      updated: item.time_updated ? new Date(item.time_updated * 1000).toISOString() : '',
      tags: (item.tags || []).map(t => t.tag || t.display_name || ''),
    }));

    res.json({
      results,
      total: data.response.total || results.length,
      page: parseInt(page),
    });
  } catch (err) {
    addLog('error', 'workshop', `Search failed: ${err.message}`);
    // Try scraping as fallback
    try {
      await scrapeWorkshopSearch(req, res, q, page);
    } catch (fallbackErr) {
      res.status(500).json({ error: 'Workshop search failed. Steam may be temporarily unavailable.' });
    }
  }
});

// Fallback: Scrape the Steam Workshop HTML search page
async function scrapeWorkshopSearch(req, res, query, page) {
  const fetch = (await import('node-fetch')).default;
  const pageNum = parseInt(page) || 1;
  const url = `https://steamcommunity.com/workshop/browse/?appid=${DAYZ_APP_ID}` +
    `&searchtext=${encodeURIComponent(query)}` +
    `&browsesort=textsearch&section=readytouseitems` +
    `&actualsort=textsearch&p=${pageNum}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
    timeout: 15000,
  });
  const html = await response.text();

  const results = [];
  // Match workshop items from the HTML
  const itemRegex = /workshopItem[^>]*>[\s\S]*?SharedFileBindMouseHover[^"]*"(\d+)"[\s\S]*?<div class="workshopItemTitle[^"]*">([^<]+)<\/div>/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    results.push({
      workshopId: match[1],
      name: match[2].trim(),
      description: '',
      preview: '',
      subscribers: 0,
      favorites: 0,
      fileSize: 0,
      updated: '',
      tags: [],
    });
  }

  // Simpler fallback regex if above doesn't match
  if (results.length === 0) {
    const linkRegex = /filedetails\/\?id=(\d+)[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g;
    while ((match = linkRegex.exec(html)) !== null) {
      if (!results.find(r => r.workshopId === match[1])) {
        results.push({
          workshopId: match[1],
          name: match[2].trim(),
          description: '',
          preview: '',
          subscribers: 0,
          favorites: 0,
          fileSize: 0,
          updated: '',
          tags: [],
        });
      }
    }
  }

  res.json({ results: await enrichWorkshopResults(results), total: results.length, page: pageNum });
}

// Batch-fetch details for workshop items using the free GetPublishedFileDetails API
async function enrichWorkshopResults(items) {
  if (items.length === 0) return items;
  try {
    const fetch = (await import('node-fetch')).default;
    // Build form body: itemcount=N&publishedfileids[0]=ID1&publishedfileids[1]=ID2...
    const params = new URLSearchParams();
    params.append('itemcount', items.length);
    items.forEach((item, i) => params.append(`publishedfileids[${i}]`, item.workshopId));

    const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeout: 10000,
    });
    const data = await response.json();
    const details = data.response?.publishedfiledetails || [];

    // Merge details into our items
    return items.map(item => {
      const detail = details.find(d => d.publishedfileid === item.workshopId);
      if (detail && detail.result === 1) {
        return {
          ...item,
          name: detail.title || item.name,
          description: (detail.description || '').replace(/\[.*?\]/g, '').substring(0, 200),
          preview: detail.preview_url || item.preview,
          subscribers: detail.subscriptions || item.subscribers,
          favorites: detail.favorited || item.favorites,
          fileSize: detail.file_size || item.fileSize,
          updated: detail.time_updated ? new Date(detail.time_updated * 1000).toISOString() : item.updated,
          tags: (detail.tags || []).map(t => t.tag),
        };
      }
      return item;
    });
  } catch (err) {
    addLog('warn', 'workshop', `Enrichment failed, returning basic results: ${err.message}`);
    return items;
  }
}

// Get details for a specific Workshop item (no API key needed)
app.get('/api/workshop/details/:id', auth(), async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const workshopId = req.params.id;

    const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `itemcount=1&publishedfileids[0]=${workshopId}`,
      timeout: 10000,
    });

    const data = await response.json();
    const item = data.response?.publishedfiledetails?.[0];

    if (!item || item.result !== 1) {
      return res.status(404).json({ error: 'Workshop item not found' });
    }

    res.json({
      workshopId: item.publishedfileid,
      name: item.title,
      description: (item.description || '').substring(0, 500),
      preview: item.preview_url || '',
      subscribers: item.subscriptions || 0,
      favorites: item.favorited || 0,
      fileSize: item.file_size || 0,
      updated: item.time_updated ? new Date(item.time_updated * 1000).toISOString() : '',
      tags: (item.tags || []).map(t => t.tag),
      steamUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedfileid}`,
    });
  } catch (err) {
    addLog('error', 'workshop', `Details fetch failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch workshop item details' });
  }
});

// Get trending/popular DayZ mods (for browsing)
app.get('/api/workshop/popular', auth(), async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const { page = 1 } = req.query;

    const url = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/` +
      `?query_type=3` +  // 3 = most popular
      `&page=${parseInt(page)}` +
      `&numperpage=20` +
      `&appid=${DAYZ_APP_ID}` +
      `&return_short_description=true` +
      `&return_previews=true` +
      `&strip_description_bbcode=true` +
      `&filetype=0` +
      `&days=30` +
      (process.env.STEAM_API_KEY ? `&key=${process.env.STEAM_API_KEY}` : '');

    const response = await fetch(url, { timeout: 10000 });
    const data = await response.json();

    const results = (data.response?.publishedfiledetails || []).map(item => ({
      workshopId: item.publishedfileid,
      name: item.title || 'Unknown',
      description: (item.short_description || '').substring(0, 200),
      preview: item.preview_url || (item.previews?.[0]?.url) || '',
      subscribers: item.subscriptions || 0,
      favorites: item.favorited || 0,
      fileSize: item.file_size || 0,
      updated: item.time_updated ? new Date(item.time_updated * 1000).toISOString() : '',
      tags: (item.tags || []).map(t => t.tag || t.display_name || ''),
    }));

    res.json({
      results,
      total: data.response?.total || results.length,
      page: parseInt(page),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch popular mods' });
  }
});

app.post('/api/schedule', auth('admin'), (req, res) => {
  const { cronExpression, label, enabled } = req.body;
  const task = {
    id: Date.now().toString(),
    cronExpression,
    label,
    enabled: enabled !== false,
  };
  store.scheduledRestarts.push(task);
  addLog('info', 'schedule', `Restart scheduled by ${req.user.username}: ${label} (${cronExpression})`);
  res.json(task);
});

app.delete('/api/schedule/:id', auth('admin'), (req, res) => {
  store.scheduledRestarts = store.scheduledRestarts.filter((s) => s.id !== req.params.id);
  res.json({ message: 'Schedule removed' });
});

// File Browser (limited to DayZ directories)
app.get('/api/files', auth('admin'), (req, res) => {
  const { dir } = req.query;
  const basePath = CONFIG.dayz.installDir;
  const targetDir = dir ? path.resolve(basePath, dir) : basePath;
  
  // Security: ensure we stay within the install directory
  if (!targetDir.startsWith(basePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    res.json(entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
      path: path.relative(basePath, path.join(targetDir, e.name)),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/read', auth('admin'), (req, res) => {
  const { file } = req.query;
  const basePath = CONFIG.dayz.installDir;
  const filePath = path.resolve(basePath, file);
  
  if (!filePath.startsWith(basePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, path: file });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/write', auth('admin'), (req, res) => {
  const { file, content } = req.body;
  const basePath = CONFIG.dayz.installDir;
  const filePath = path.resolve(basePath, file);
  
  if (!filePath.startsWith(basePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    // Backup before writing
    const backupDir = path.join(basePath, '.backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, path.join(backupDir, `${path.basename(file)}.${Date.now()}.bak`));
    }
    
    fs.writeFileSync(filePath, content);
    addLog('info', 'files', `File edited by ${req.user.username}: ${file}`);
    res.json({ message: 'File saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Discord Bot Endpoint (internal, for the bot to call)
app.post('/api/discord/action', async (req, res) => {
  const { action, apiKey, params } = req.body;
  
  // Verify the bot's API key
  if (apiKey !== (process.env.DISCORD_BOT_API_KEY || 'bot-secret-key')) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  addLog('info', 'discord', `Discord action: ${action}`);

  switch (action) {
    case 'status':
      return res.json({
        status: store.serverStatus,
        playerCount: store.players.length,
        maxPlayers: store.config.maxPlayers || 60,
        serverName: store.config.hostname || 'DayZ Server',
        players: store.players.map((p) => ({ name: p.name, ping: p.ping })),
      });
    case 'start': {
      const existingPid = await detectRunningProcess();
      if (existingPid) {
        dayzProcessPID = existingPid;
        store.serverStatus = 'running';
        io.emit('serverStatus', store.serverStatus);
        return res.json({ message: `Server already running (PID: ${existingPid})` });
      }
      store.serverStatus = 'starting';
      io.emit('serverStatus', store.serverStatus);
      try {
        dayzProcess = spawnDayZServer();
        dayzProcessPID = dayzProcess.pid;
        setTimeout(async () => {
          const pid = await detectRunningProcess();
          if (pid) {
            store.serverStatus = 'running';
            io.emit('serverStatus', store.serverStatus);
            sendDiscordWebhook('🟢 **DayZ Server Started** (via Discord)');
          }
        }, 8000);
      } catch (err) {
        store.serverStatus = 'crashed';
        io.emit('serverStatus', store.serverStatus);
        return res.json({ error: err.message });
      }
      return res.json({ message: 'Server starting...' });
    }
    case 'stop': {
      store.serverStatus = 'stopping';
      io.emit('serverStatus', store.serverStatus);
      try {
        const pid = await detectRunningProcess();
        if (pid) await killDayZServer(pid);
        store.serverStatus = 'stopped';
        store.players = [];
        dayzProcess = null;
        dayzProcessPID = null;
        io.emit('serverStatus', store.serverStatus);
        io.emit('players', store.players);
        sendDiscordWebhook('🔴 **DayZ Server Stopped** (via Discord)');
      } catch (err) {
        return res.json({ error: err.message });
      }
      return res.json({ message: 'Server stopped' });
    }
    case 'restart': {
      store.serverStatus = 'stopping';
      io.emit('serverStatus', store.serverStatus);
      try {
        const pid = await detectRunningProcess();
        if (pid) await killDayZServer(pid);
        dayzProcess = null;
        dayzProcessPID = null;
        store.players = [];
        io.emit('players', store.players);
        await new Promise(r => setTimeout(r, 3000));
        store.serverStatus = 'starting';
        io.emit('serverStatus', store.serverStatus);
        dayzProcess = spawnDayZServer();
        dayzProcessPID = dayzProcess.pid;
        setTimeout(async () => {
          const newPid = await detectRunningProcess();
          if (newPid) {
            store.serverStatus = 'running';
            io.emit('serverStatus', store.serverStatus);
            sendDiscordWebhook('🔄 **DayZ Server Restarted** (via Discord)');
          }
        }, 8000);
      } catch (err) {
        store.serverStatus = 'crashed';
        io.emit('serverStatus', store.serverStatus);
        return res.json({ error: err.message });
      }
      return res.json({ message: 'Server restarting...' });
    }
    case 'kick':
      if (params?.playerId) {
        await rcon.kick(params.playerId, params.reason || 'Kicked via Discord');
        store.players = store.players.filter((p) => p.id !== params.playerId);
        io.emit('players', store.players);
      }
      return res.json({ message: 'Player kicked' });
    case 'message':
      if (params?.message) await rcon.say(params.message);
      return res.json({ message: 'Message sent' });
    case 'lock':
      await rcon.lock();
      return res.json({ message: 'Server locked' });
    case 'unlock':
      await rcon.unlock();
      return res.json({ message: 'Server unlocked' });
    case 'players':
      return res.json({ players: store.players });
    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
});

// ─── WebSocket Events ────────────────────────────────────
io.on('connection', (socket) => {
  addLog('info', 'ws', 'Client connected');
  
  socket.emit('serverStatus', store.serverStatus);
  socket.emit('players', store.players);

  socket.on('disconnect', () => {
    addLog('info', 'ws', 'Client disconnected');
  });
});

// ─── Real Process Metrics & Status Polling ────────────────
// Polls the actual process to get real CPU/RAM usage and detect crashes.
setInterval(async () => {
  if (store.serverStatus === 'running' || store.serverStatus === 'starting') {
    const pid = await detectRunningProcess();
    if (pid) {
      dayzProcessPID = pid;
      if (store.serverStatus !== 'running') {
        store.serverStatus = 'running';
        io.emit('serverStatus', store.serverStatus);
      }
      // Get real metrics
      const metrics = await getProcessMetrics(pid);
      if (metrics) {
        pushMetrics(metrics.cpu, metrics.ram, store.players.length, 0);
      }
    } else if (store.serverStatus === 'running') {
      // Process disappeared — server crashed or was killed externally
      addLog('error', 'server', 'DayZ server process is no longer running!');
      store.serverStatus = 'crashed';
      store.players = [];
      dayzProcess = null;
      dayzProcessPID = null;
      io.emit('serverStatus', store.serverStatus);
      io.emit('players', store.players);
      sendDiscordWebhook('💥 **DayZ Server Down** — process no longer detected');
    }
  }
}, 15000); // Every 15 seconds

// ─── Startup: Detect Already-Running Server ────────────────
(async () => {
  const pid = await detectRunningProcess();
  if (pid) {
    dayzProcessPID = pid;
    store.serverStatus = 'running';
    addLog('info', 'server', `Detected already-running DayZ server (PID: ${pid})`);
    io.emit('serverStatus', store.serverStatus);
  }
})();

// ─── Startup: Auto-Detect Mods ─────────────────────────────
autoDetectMods();
// Re-scan mods every 5 minutes (picks up newly installed mods)
setInterval(() => autoDetectMods(), 5 * 60 * 1000);

// ─── Optional RCON: Try to connect but don't fail ──────────
if (CONFIG.dayz.rconPassword) {
  setTimeout(async () => {
    try {
      await rcon.connect();
      addLog('info', 'rcon', 'RCON connected successfully');
    } catch (err) {
      addLog('warn', 'rcon', `RCON not available (this is normal for local servers): ${err.message}`);
    }
  }, 5000);
}

// ─── Start ───────────────────────────────────────────────
server.listen(CONFIG.port, () => {
  addLog('info', 'server', `DayZ Panel API running on port ${CONFIG.port}`);
  console.log(`🎮 DayZ Panel API running on http://localhost:${CONFIG.port}`);
});

module.exports = { app, io, store, CONFIG };
