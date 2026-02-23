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
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, { cors: { origin: '*' } });

// ─── Config ──────────────────────────────────────────────
const CONFIG = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  dayz: {
    ip: process.env.DAYZ_SERVER_IP || '127.0.0.1',
    rconPort: parseInt(process.env.DAYZ_RCON_PORT || '2302'),
    rconPassword: process.env.RCON_PASSWORD || '',
    installDir: process.env.DAYZ_INSTALL_DIR || '/home/dayz/server',
    profileDir: process.env.DAYZ_PROFILE_DIR || '/home/dayz/server/profiles',
    executable: process.env.DAYZ_EXECUTABLE || 'DayZServer_x64.exe',
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
  config: {                 // editable server config
    maxPlayers: 60,
    serverName: 'My DayZ Server',
    password: '',
    adminPassword: '',
    verifySignatures: 2,
    forceSameBuild: 1,
    thirdPerson: 1,
    crosshair: 0,
    mouseAcceleration: 1,
    respawnTime: 5,
    timeAcceleration: 6,
    nightTimeAcceleration: 12,
    loginQueueConcurrentPlayers: 5,
    loginQueueMaxPlayers: 500,
  },
};

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

// ─── RCON Client (BattlEye Protocol) ────────────────────
// Simplified RCON - in production, use a proper BattlEye RCON library
class RCONClient {
  constructor(ip, port, password) {
    this.ip = ip;
    this.port = port;
    this.password = password;
    this.connected = false;
  }

  async connect() {
    // In production, implement actual BattlEye RCON UDP protocol
    // For now, this is a stub that logs the intent
    addLog('info', 'rcon', `Connecting to RCON at ${this.ip}:${this.port}`);
    this.connected = true;
    return true;
  }

  async send(command) {
    if (!this.connected) await this.connect();
    addLog('info', 'rcon', `RCON command: ${command}`);
    
    // In production, send actual RCON command via UDP
    // Example using child_process for a CLI RCON tool:
    return new Promise((resolve, reject) => {
      // Stub response - replace with actual RCON implementation
      // You can use packages like 'battleye-rcon' or 'dayz-rcon'
      resolve(`[RCON] Command sent: ${command}`);
    });
  }

  async getPlayers() {
    return this.send('players');
  }

  async kick(playerId, reason) {
    return this.send(`kick ${playerId} ${reason}`);
  }

  async ban(playerId, reason) {
    return this.send(`ban ${playerId} 0 ${reason}`);
  }

  async say(message) {
    return this.send(`say -1 ${message}`);
  }

  async shutdown() {
    return this.send('#shutdown');
  }

  async restart() {
    return this.send('#restart');
  }

  async lock() {
    return this.send('#lock');
  }

  async unlock() {
    return this.send('#unlock');
  }
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
    maxPlayers: store.config.maxPlayers,
    serverName: store.config.serverName,
    uptime: store.serverStatus === 'running' ? process.uptime() : 0,
  });
});

app.post('/api/server/start', auth('admin'), async (req, res) => {
  if (store.serverStatus === 'running') return res.status(400).json({ error: 'Server already running' });

  store.serverStatus = 'starting';
  io.emit('serverStatus', store.serverStatus);
  addLog('info', 'server', `Server start initiated by ${req.user.username}`);

  try {
    // Build launch command
    const execPath = path.join(CONFIG.dayz.installDir, CONFIG.dayz.executable);
    const params = CONFIG.dayz.launchParams.split(' ');

    // In production on Windows, use: spawn(execPath, params, { cwd: CONFIG.dayz.installDir, detached: true })
    // In production on Linux (with Wine/Proton): spawn('wine', [execPath, ...params], { ... })
    
    // Simulate start for demo
    setTimeout(() => {
      store.serverStatus = 'running';
      io.emit('serverStatus', store.serverStatus);
      addLog('info', 'server', 'Server is now running');
      sendDiscordWebhook('🟢 **DayZ Server Started**');
    }, 3000);

    res.json({ message: 'Server starting...' });
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
    await rcon.shutdown();
    setTimeout(() => {
      store.serverStatus = 'stopped';
      store.players = [];
      io.emit('serverStatus', store.serverStatus);
      addLog('info', 'server', 'Server stopped');
      sendDiscordWebhook('🔴 **DayZ Server Stopped**');
    }, 5000);
    res.json({ message: 'Server stopping...' });
  } catch (err) {
    addLog('error', 'server', `Failed to stop: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/server/restart', auth('admin'), async (req, res) => {
  addLog('info', 'server', `Server restart initiated by ${req.user.username}`);
  
  const { countdown } = req.body;  // optional countdown in seconds
  
  if (countdown && store.serverStatus === 'running') {
    await rcon.say(`SERVER RESTART IN ${countdown} SECONDS`);
    setTimeout(async () => {
      await rcon.restart();
    }, countdown * 1000);
    res.json({ message: `Restart scheduled in ${countdown}s` });
  } else {
    await rcon.restart();
    store.serverStatus = 'starting';
    io.emit('serverStatus', store.serverStatus);
    setTimeout(() => {
      store.serverStatus = 'running';
      io.emit('serverStatus', store.serverStatus);
      sendDiscordWebhook('🔄 **DayZ Server Restarted**');
    }, 10000);
    res.json({ message: 'Server restarting...' });
  }
});

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
  res.json(store.config);
});

app.patch('/api/config', auth('admin'), (req, res) => {
  Object.assign(store.config, req.body);
  addLog('info', 'config', `Config updated by ${req.user.username}: ${JSON.stringify(req.body)}`);
  
  // In production: write changes to serverDZ.cfg
  // writeServerConfig(store.config);
  
  res.json(store.config);
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
        maxPlayers: store.config.maxPlayers,
        serverName: store.config.serverName,
        players: store.players.map((p) => ({ name: p.name, ping: p.ping })),
      });
    case 'start':
      store.serverStatus = 'starting';
      io.emit('serverStatus', store.serverStatus);
      setTimeout(() => {
        store.serverStatus = 'running';
        io.emit('serverStatus', store.serverStatus);
      }, 3000);
      return res.json({ message: 'Server starting...' });
    case 'stop':
      store.serverStatus = 'stopping';
      io.emit('serverStatus', store.serverStatus);
      setTimeout(() => {
        store.serverStatus = 'stopped';
        store.players = [];
        io.emit('serverStatus', store.serverStatus);
      }, 5000);
      return res.json({ message: 'Server stopping...' });
    case 'restart':
      store.serverStatus = 'starting';
      io.emit('serverStatus', store.serverStatus);
      setTimeout(() => {
        store.serverStatus = 'running';
        io.emit('serverStatus', store.serverStatus);
      }, 10000);
      return res.json({ message: 'Server restarting...' });
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

// ─── Demo: Simulated Metrics ─────────────────────────────
// In production, this reads from actual system stats via pidusage, os module, etc.
setInterval(() => {
  if (store.serverStatus === 'running') {
    const cpu = Math.round(20 + Math.random() * 30);
    const ram = Math.round(2048 + Math.random() * 1024);
    const fps = Math.round(45 + Math.random() * 15);
    pushMetrics(cpu, ram, store.players.length, fps);
  }
}, 60000);

// ─── Start ───────────────────────────────────────────────
server.listen(CONFIG.port, () => {
  addLog('info', 'server', `DayZ Panel API running on port ${CONFIG.port}`);
  console.log(`🎮 DayZ Panel API running on http://localhost:${CONFIG.port}`);
});

module.exports = { app, io, store, CONFIG };
