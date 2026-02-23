// ─── Steam Update Polling ──────────────────────────────
const fetch = require('node-fetch');
function getWorkshopModVersion(workshopId) {
  // Steam Web API: https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/
  return fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `itemcount=1&publishedfileids[0]=${workshopId}`
  })
    .then(res => res.json())
    .then(data => {
      const file = data?.response?.publishedfiledetails?.[0];
      return file ? file.time_updated : null;
    })
    .catch(() => null);
}

function getDayZBuildVersion() {
  // Steam Web API: https://api.steampowered.com/ISteamApps/GetAppBuilds/v1/
  const appId = CONFIG.steam.appId;
  return fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`)
    .then(res => res.json())
    .then(data => {
      const build = data?.[appId]?.data?.build_number;
      return build || null;
    })
    .catch(() => null);
}

let lastModVersions = {};
let lastGameBuild = null;

function steamUpdatePolling() {
  setInterval(async () => {
    for (const srv of servers) {
      const state = serverStates[srv.id];
      if (!state) continue;
      // Mod update polling
      if (!srv.ignoreModUpdates && Array.isArray(state.modList)) {
        for (const mod of state.modList) {
          if (!mod.workshopId) continue;
          const remoteVersion = await getWorkshopModVersion(mod.workshopId);
          if (remoteVersion && lastModVersions[mod.workshopId] && remoteVersion > lastModVersions[mod.workshopId]) {
            // Mod update detected
            addNotification(srv.id, 'mod.update', 'Mod Update Detected', `Workshop mod ${mod.name} updated. Restarting in ${srv.restartCountdown || 60} seconds.`, 'warning');
            io.emit('modUpdate', { serverId: srv.id, mod: mod.name, countdown: srv.restartCountdown || 60 });
            setTimeout(() => {
              io.emit('serverStatus', { serverId: srv.id, status: 'restarting' });
              // Call restart endpoint or logic
              // ...existing restart logic...
            }, (srv.restartCountdown || 60) * 1000);
          }
          lastModVersions[mod.workshopId] = remoteVersion;
        }
      }
      // Game build update polling
      const remoteBuild = await getDayZBuildVersion();
      if (remoteBuild && lastGameBuild && remoteBuild !== lastGameBuild) {
        addNotification(srv.id, 'game.update', 'Game Update Detected', `DayZ game build updated. Restarting in ${srv.restartCountdown || 60} seconds.`, 'warning');
        io.emit('gameUpdate', { serverId: srv.id, build: remoteBuild, countdown: srv.restartCountdown || 60 });
        setTimeout(() => {
          io.emit('serverStatus', { serverId: srv.id, status: 'restarting' });
          // Call restart endpoint or logic
          // ...existing restart logic...
        }, (srv.restartCountdown || 60) * 1000);
      }
      lastGameBuild = remoteBuild;
    }
  }, 15 * 60 * 1000); // 15 minutes
}

steamUpdatePolling();
/**
 * DayZ Server Panel - Backend API v2.0
 * 
 * Features:
 *   - Multi-server instance management (Server Hub)
 *   - User/Role management with Audit Log
 *   - Webhook system (server events → Discord/HTTP)
 *   - Server deployment via SteamCMD
 *   - Enhanced metrics with real-time streaming
 *   - Steam Workshop search, download & install
 *   - BattlEye RCON integration
 *   - File explorer with Monaco Editor support
 *   - serverDZ.cfg parser/writer
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
const { v4: uuid } = require('uuid');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, { cors: { origin: '*' } });

// ─── Config ──────────────────────────────────────────────
const CONFIG = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  dataDir: path.join(__dirname, '..', 'data'),
  dayz: {
    ip: process.env.DAYZ_SERVER_IP || '127.0.0.1',
    rconPort: parseInt(process.env.DAYZ_RCON_PORT || '2305'),
    rconPassword: process.env.RCON_PASSWORD || '',
    installDir: process.env.DAYZ_INSTALL_DIR || 'C:\\DayZServer',
    profileDir: process.env.DAYZ_PROFILE_DIR || '',
    executable: process.env.DAYZ_EXECUTABLE || 'DayZServer_x64.exe',
    startBat: process.env.DAYZ_START_BAT || '',
    launchParams: process.env.DAYZ_LAUNCH_PARAMS || '-config=serverDZ.cfg -port=2302 -dologs -adminlog -netlog -freezecheck',
  },
  webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  steam: {
    cmdPath: process.env.STEAMCMD_PATH || '',
    username: process.env.STEAM_USERNAME || '',
    password: process.env.STEAM_PASSWORD || '',
    appId: '221100',
    serverAppId: '223350',
  },
};

// Ensure data directory exists
if (!fs.existsSync(CONFIG.dataDir)) fs.mkdirSync(CONFIG.dataDir, { recursive: true });

// ─── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../web')));

// ─── Persistent JSON Data Store ──────────────────────────
function loadJSON(filename, defaultVal) {
  const p = path.join(CONFIG.dataDir, filename);
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  return defaultVal;
}
function saveJSON(filename, data) {
  const p = path.join(CONFIG.dataDir, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ─── Data ────────────────────────────────────────────────
let servers = loadJSON('servers.json', []);
let users = loadJSON('users.json', []);
let roles = loadJSON('roles.json', [
  { id: 'admin', name: 'Admin', permissions: ['*'], color: '#ff3b3b', builtIn: true },
  { id: 'moderator', name: 'Moderator', permissions: ['server.view','server.start','server.stop','server.restart','players.view','players.kick','mods.view','logs.view','metrics.view','chat.send'], color: '#3b82f6', builtIn: true },
  { id: 'viewer', name: 'Viewer', permissions: ['server.view','players.view','mods.view','logs.view','metrics.view'], color: '#00ff6a', builtIn: true },
]);
let webhooks = loadJSON('webhooks.json', []);
let auditLog = loadJSON('audit.json', []);

// Runtime state per server
const serverStates = {};

// Global state
let steamCmdPath = CONFIG.steam.cmdPath;
const activeInstalls = {};
let steamCredentials = {
  username: CONFIG.steam.username || '',
  password: CONFIG.steam.password || '',
  guardCode: '',
};
let steamLoginValidated = false;

// ─── Helpers ─────────────────────────────────────────────
function addLog(serverId, level, source, message) {
  const entry = { timestamp: new Date().toISOString(), level, source, message };
  if (serverId && serverStates[serverId]) {
    serverStates[serverId].logs.unshift(entry);
    if (serverStates[serverId].logs.length > 5000) serverStates[serverId].logs.pop();
  }
  io.emit('log', { serverId, ...entry });
  return entry;
}

function addAudit(userId, username, action, details) {
  const entry = { id: uuid(), timestamp: new Date().toISOString(), userId, username, action, details };
  auditLog.unshift(entry);
  if (auditLog.length > 10000) auditLog = auditLog.slice(0, 10000);
  saveJSON('audit.json', auditLog.slice(0, 2000));
  return entry;
}

function pushMetrics(serverId, cpu, ram, playerCount, fps) {
  const state = serverStates[serverId];
  if (!state) return;
  const now = new Date().toISOString();
  const m = state.metricsHistory;
  m.cpu.push(cpu); m.ram.push(ram); m.players.push(playerCount); m.fps.push(fps); m.timestamps.push(now);
  const max = 360;
  Object.keys(m).forEach(k => { if (m[k].length > max) m[k] = m[k].slice(-max); });
  io.emit('metrics', { serverId, cpu, ram, players: playerCount, fps, timestamp: now });
}

// ─── Notification System ─────────────────────────────────
const notifications = []; // In-memory notification store (max 200)
const NOTIFICATION_ICONS = {
  'server.started': '🟢', 'server.stopped': '🔴', 'server.crashed': '💥', 'server.restarted': '🔄',
  'server.health': '⚠️', 'player.join': '👋', 'player.leave': '👤', 'player.kick': '🦶',
  'player.ban': '🔨', 'mod.installed': '📦', 'mod.updated': '📦', 'mod.removed': '🗑️',
  'scheduler.task': '📅', 'backup.created': '💾', 'update.available': '🆕', 'rcon.command': '🖥️',
};

function addNotification(serverId, type, title, message, severity) {
  severity = severity || 'info'; // info, success, warning, error
  const n = {
    id: uuid(), serverId, type, title, message, severity,
    icon: NOTIFICATION_ICONS[type] || '🔔',
    timestamp: new Date().toISOString(), read: false,
  };
  notifications.unshift(n);
  if (notifications.length > 200) notifications.length = 200;
  io.emit('notification', n);
  return n;
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
    console.error('Discord webhook failed:', err.message);
  }
}

// Fire all matching webhooks for an event
async function fireWebhooks(eventType, data) {
  const matching = webhooks.filter(w => w.enabled && w.event === eventType);
  for (const wh of matching) {
    try {
      const fetch = (await import('node-fetch')).default;
      const payload = { event: eventType, timestamp: new Date().toISOString(), data };
      // Discord webhook format
      if (wh.url.includes('discord.com/api/webhooks')) {
        let body;
        try { body = JSON.parse(wh.template || '{}'); } catch { body = {}; }
        let content = body.content || `**${eventType}** event fired`;
        content = content.replace(/\{server\.name\}/g, data.serverName || 'Unknown');
        content = content.replace(/\{server\.id\}/g, data.serverId || '');
        content = content.replace(/\{timestamp\}/g, new Date().toLocaleString());
        body.content = content;
        await fetch(wh.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(wh.timeout || 60000) });
      } else {
        await fetch(wh.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(wh.headers || {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(wh.timeout || 60000) });
      }
      if (!wh.deliveries) wh.deliveries = [];
      wh.deliveries.unshift({ timestamp: new Date().toISOString(), status: 'success', event: eventType });
      if (wh.deliveries.length > 50) wh.deliveries = wh.deliveries.slice(0, 50);
    } catch (err) {
      if (!wh.deliveries) wh.deliveries = [];
      wh.deliveries.unshift({ timestamp: new Date().toISOString(), status: 'failed', event: eventType, error: err.message });
      if (wh.deliveries.length > 50) wh.deliveries = wh.deliveries.slice(0, 50);
      if (wh.retryEnabled && (!wh._retryCount || wh._retryCount < 3)) {
        wh._retryCount = (wh._retryCount || 0) + 1;
        setTimeout(() => fireWebhooks(eventType, data), 5000 * wh._retryCount);
      }
    }
  }
  saveJSON('webhooks.json', webhooks);
}

function saveServers() { saveJSON('servers.json', servers); }
function saveUsers() { saveJSON('users.json', users.map(u => ({ ...u }))); }
function saveRoles() { saveJSON('roles.json', roles); }

// ─── Auth Middleware ──────────────────────────────────────
function auth(requiredPermission) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      const decoded = jwt.verify(token, CONFIG.jwtSecret);
      req.user = decoded;
      if (requiredPermission) {
        const user = users.find(u => u.id === decoded.id);
        if (!user) return res.status(401).json({ error: 'User not found' });
        const role = roles.find(r => r.id === user.role);
        if (!role) return res.status(403).json({ error: 'Role not found' });
        if (!role.permissions.includes('*') && !role.permissions.includes(requiredPermission)) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

// ─── serverDZ.cfg Parser ─────────────────────────────────
function getServerCfgPath(installDir) {
  return path.join(installDir, 'serverDZ.cfg');
}

function readServerConfig(installDir) {
  const cfgPath = getServerCfgPath(installDir);
  const config = {};
  if (!fs.existsSync(cfgPath)) return config;
  try {
    const content = fs.readFileSync(cfgPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('class') || trimmed === '{' || trimmed === '};') continue;
      const match = trimmed.match(/^([\w]+)\s*=\s*(.+?)\s*;/);
      if (match) {
        const key = match[1];
        let value = match[2].trim();
        const ci = value.indexOf('//');
        if (ci > 0) value = value.substring(0, ci).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (/^\d+$/.test(value)) value = parseInt(value, 10);
        else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
        config[key] = value;
      }
    }
  } catch {}
  return config;
}

function writeServerConfig(installDir, updates) {
  const cfgPath = getServerCfgPath(installDir);
  if (!fs.existsSync(cfgPath)) return false;
  try {
    const backupDir = path.join(installDir, '.backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(cfgPath, path.join(backupDir, `serverDZ.cfg.${Date.now()}.bak`));
    let content = fs.readFileSync(cfgPath, 'utf8');
    for (const [key, value] of Object.entries(updates)) {
      const strValue = typeof value === 'string' ? `"${value}"` : String(value);
      const regex = new RegExp(`^(\\s*${key}\\s*=\\s*).+?(\\s*;.*)$`, 'm');
      if (regex.test(content)) content = content.replace(regex, `$1${strValue}$2`);
    }
    fs.writeFileSync(cfgPath, content, 'utf8');
    return true;
  } catch { return false; }
}

// ─── Process Tracking (Windows) ──────────────────────────
function detectRunningProcess(executable) {
  return new Promise((resolve) => {
    exec(`tasklist /FI "IMAGENAME eq ${executable}" /FO CSV /NH`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const lines = stdout.trim().split('\n').filter(l => l.includes(executable));
      if (lines.length > 0) {
        const match = lines[0].match(/"[^"]+","(\d+)"/);
        return resolve(match ? parseInt(match[1]) : null);
      }
      resolve(null);
    });
  });
}

function getProcessMetrics(pid, executable) {
  return new Promise((resolve) => {
    if (!pid) return resolve(null);
    // Use PowerShell to get CPU and memory for the process (wmic is deprecated/removed on modern Windows)
    const psCmd = `powershell -NoProfile -Command "try { $p = Get-Process -Id ${pid} -ErrorAction Stop; $cpuCores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum; if (-not $cpuCores) { $cpuCores = [Environment]::ProcessorCount }; $totalMem = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory; $ws = $p.WorkingSet64; $cpu = 0; try { $sample1 = $p.TotalProcessorTime.TotalMilliseconds; Start-Sleep -Milliseconds 500; $p.Refresh(); $sample2 = $p.TotalProcessorTime.TotalMilliseconds; $cpu = [math]::Round(($sample2 - $sample1) / 500 * 100 / $cpuCores, 1) } catch { $cpu = 0 }; $ramPct = [math]::Round($ws / $totalMem * 100, 1); Write-Output \\"CPU=$cpu,RAM=$ramPct,RAMMB=$([math]::Round($ws/1MB))\\" } catch { Write-Output 'ERROR' }"`;
    exec(psCmd, { timeout: 8000 }, (err, stdout) => {
      if (err || !stdout || stdout.trim() === 'ERROR') return resolve(null);
      const output = stdout.trim();
      const cpuMatch = output.match(/CPU=([\d.]+)/);
      const ramMatch = output.match(/RAM=([\d.]+)/);
      const ramMBMatch = output.match(/RAMMB=(\d+)/);
      resolve({
        cpu: cpuMatch ? parseFloat(cpuMatch[1]) : 0,
        ram: ramMatch ? parseFloat(ramMatch[1]) : 0,
        ramMB: ramMBMatch ? parseInt(ramMBMatch[1]) : 0
      });
    });
  });
}

// ─── FPS Scraping from RPT logs ──────────────────────────
// DayZ with logAverageFps=N in serverDZ.cfg writes lines like:
//   "Average server FPS: 3000.00 (for last 10 sec)"
// to the .RPT file in the profiles directory.
function scrapeRPTForFPS(server) {
  try {
    const profileDir = server.profileDir || server.installDir;
    if (!profileDir || !fs.existsSync(profileDir)) return 0;
    // RPT files are named like: DayZServer_x64_YYYY-MM-DD_HH-MM-SS.RPT
    // or sometimes just script_YYYY-MM-DD.log — find the newest .RPT
    const files = fs.readdirSync(profileDir)
      .filter(f => f.toLowerCase().endsWith('.rpt'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(profileDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return 0;
    const rptPath = path.join(profileDir, files[0].name);
    // Read only the last 4KB of the file to find the most recent FPS line
    const stat = fs.statSync(rptPath);
    const readSize = Math.min(stat.size, 4096);
    const fd = fs.openSync(rptPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    const tail = buf.toString('utf8');
    // Match all FPS lines and take the last one
    const matches = [...tail.matchAll(/Average server FPS:\s*([\d.]+)/gi)];
    if (matches.length > 0) {
      const fps = parseFloat(matches[matches.length - 1][1]);
      return isNaN(fps) ? 0 : fps;
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

function killProcess(pid, executable) {
  return new Promise((resolve, reject) => {
    if (pid) {
      exec(`taskkill /F /PID ${pid}`, (err) => err ? reject(err) : resolve());
    } else {
      exec(`taskkill /F /IM ${executable}`, (err) => err ? reject(err) : resolve());
    }
  });
}

function spawnDayZServer(serverConfig) {
  const installDir = serverConfig.installDir;
  let child;
  if (serverConfig.startBat) {
    const batPath = path.join(installDir, serverConfig.startBat);
    if (!fs.existsSync(batPath)) throw new Error(`Start batch file not found: ${batPath}`);
    child = spawn('cmd.exe', ['/c', batPath], {
      cwd: installDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
    });
    child.unref();
  } else {
    const execPath = path.join(installDir, serverConfig.executable);
    const params = (serverConfig.launchParams || '').split(' ').filter(Boolean);
    if (!fs.existsSync(execPath)) throw new Error(`Executable not found: ${execPath}`);
    child = spawn(execPath, params, { cwd: installDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.unref();
  }
  // Apply CPU affinity and priority after spawn
  if (child && child.pid) {
    applyProcessSettings(child.pid, serverConfig);
  }
  return child;
}

function applyProcessSettings(pid, serverConfig) {
  if (!pid) return;
  const priorityMap = { Idle: 64, BelowNormal: 16384, Normal: 32, AboveNormal: 32768, High: 128, RealTime: 256 };
  const parts = [];
  if (serverConfig.cpuAffinity && serverConfig.cpuAffinity > 0) {
    parts.push(`$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.ProcessorAffinity = ${serverConfig.cpuAffinity}`);
  }
  if (serverConfig.priorityLevel && serverConfig.priorityLevel !== 'Normal') {
    const cls = priorityMap[serverConfig.priorityLevel];
    if (cls) parts.push(`$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::${serverConfig.priorityLevel}`);
  }
  if (parts.length > 0) {
    exec(`powershell -NoProfile -Command "${parts.join('; ')}"`, { timeout: 5000 }, (err) => {
      if (err) console.error(`Failed to apply process settings for PID ${pid}:`, err.message);
    });
  }
}

// ─── Mod Detection ───────────────────────────────────────
function autoDetectMods(serverId) {
  const srv = servers.find(s => s.id === serverId);
  if (!srv) return;
  const state = serverStates[serverId];
  if (!state) return;
  const installDir = srv.installDir;
  let installedMods = [];
  try {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    installedMods = entries.filter(e => e.isDirectory() && e.name.startsWith('@')).map(e => e.name);
  } catch { return; }
  let activeMods = new Set();
  if (srv.startBat) {
    try {
      const batContent = fs.readFileSync(path.join(installDir, srv.startBat), 'utf8');
      const modMatch = batContent.match(/["\s]-mod=([^"\n]+)/i) || batContent.match(/-mod=([^\s]+)/i);
      if (modMatch) modMatch[1].replace(/["]/g, '').trim().split(';').forEach(m => { if (m.trim()) activeMods.add(m.trim()); });
    } catch {}
  }
  state.modList = installedMods.map((name, index) => {
    let workshopId = '';
    try {
      const metaPath = path.join(installDir, name, 'meta.cpp');
      if (fs.existsSync(metaPath)) { const meta = fs.readFileSync(metaPath, 'utf8'); const m = meta.match(/publishedid\s*=\s*(\d+)/i); if (m) workshopId = m[1]; }
    } catch {}
    return { name, workshopId, enabled: activeMods.size === 0 ? true : activeMods.has(name), order: index };
  });
  io.emit('mods', { serverId, mods: state.modList });
}

// ─── RCON (BattlEye UDP) ─────────────────────────────────
const dgram = require('dgram');
const { Buffer } = require('buffer');
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
  constructor(ip, port, password) {
    this.ip = ip; this.port = port; this.password = password;
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
              // Parse server FPS from #monitor messages (format: "Server FPS: XX" or "ServerFPS: XX")
              const fpsMatch = message.match(/Server\s*FPS:\s*(\d+(?:\.\d+)?)/i);
              if (fpsMatch) this.lastFPS = parseFloat(fpsMatch[1]);
              io.emit('rconMessage', { timestamp: new Date().toISOString(), message });
            }
            break;
        }
      });
      this.socket.on('error', () => { this.connected = false; this.loggedIn = false; });
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
    if (this.socket) { try { this.socket.close(); } catch {} this.socket = null; }
  }
  _startKeepAlive() {
    this._stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (this.loggedIn && this.socket) { const { packet } = this._buildCommandPacket(''); this.socket.send(packet, 0, packet.length, this.port, this.ip); }
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
      // Log the command sent
      const serverId = this.ip + ':' + this.port;
      if (typeof addLog === 'function') {
        addLog(serverId, 'info', 'rcon', `RCON command sent: ${command}`);
      }
    });
  }
  async getPlayers() { return this.send('players'); }
  async kick(id, reason) { return this.send(`kick ${id} ${reason}`); }
  async ban(id, reason) { return this.send(`ban ${id} 0 ${reason}`); }
  async say(message) { return this.send(`say -1 ${message}`); }
  async shutdown() { return this.send('#shutdown'); }
  async restart() { return this.send('#restart'); }
  async lock() { return this.send('#lock'); }
  async unlock() { return this.send('#unlock'); }
  async enableMonitor() {
    if (this.monitorEnabled) return;
    try { await this.send('#monitor 1'); this.monitorEnabled = true; } catch(e) { /* ignore */ }
  }
  getFPS() { return this.lastFPS; }
}

// ─── Initialize Server States ────────────────────────────
// Migrate: if no servers exist but .env has a DayZ install, create the default one
if (servers.length === 0 && CONFIG.dayz.installDir && fs.existsSync(CONFIG.dayz.installDir)) {
  const defaultServer = {
    id: uuid(),
    name: readServerConfig(CONFIG.dayz.installDir).hostname || 'DayZ Server',
    installDir: CONFIG.dayz.installDir,
    executable: CONFIG.dayz.executable || 'DayZServer_x64.exe',
    startBat: CONFIG.dayz.startBat || '',
    launchParams: CONFIG.dayz.launchParams || '',
    ip: CONFIG.dayz.ip || '127.0.0.1',
    gamePort: 2302, queryPort: 2303,
    rconPort: CONFIG.dayz.rconPort || 2305,
    rconPassword: CONFIG.dayz.rconPassword || '',
    maxPlayers: 60, map: 'chernarusplus',
    gameTitle: 'DayZ, PC', profileDir: CONFIG.dayz.profileDir || '',
    createdAt: new Date().toISOString(),
  };
  servers.push(defaultServer);
  saveServers();
}

function initServerState(serverId) {
  if (serverStates[serverId]) return;
  const srv = servers.find(s => s.id === serverId);
  if (!srv) return;
  serverStates[serverId] = {
    status: 'stopped', pid: null, process: null, players: [],
    logs: [], metricsHistory: { cpu: [], ram: [], players: [], fps: [], timestamps: [] },
    modList: [], config: {}, scheduledRestarts: [], chatMessages: [], banList: [],
    rcon: srv.rconPassword ? new RCONClient(srv.ip, srv.rconPort, srv.rconPassword) : null,
    startedAt: null,
  };
  if (fs.existsSync(srv.installDir)) {
    serverStates[serverId].config = readServerConfig(srv.installDir);
    autoDetectMods(serverId);
  }
}

servers.forEach(s => initServerState(s.id));

// Initialize default admin user
(async () => {
  if (users.length === 0) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin', 10);
    users.push({
      id: uuid(), username: process.env.ADMIN_USERNAME || 'admin',
      passwordHash: hash, role: 'admin', isRoot: true, createdAt: new Date().toISOString(),
      description: 'This is the root user. It can not be modified or deleted.',
    });
    saveUsers();
  }
})();

// ─── SteamCMD ────────────────────────────────────────────
async function ensureSteamCMD() {
  if (steamCmdPath && fs.existsSync(steamCmdPath)) return steamCmdPath;
  const searchPaths = [
    'C:\\SteamCMD\\steamcmd.exe', 'C:\\steamcmd\\steamcmd.exe',
    path.join(__dirname, '..', 'steamcmd', 'steamcmd.exe'),
  ];
  for (const p of searchPaths) { if (fs.existsSync(p)) { steamCmdPath = p; return p; } }
  // Auto-download
  const steamCmdDir = path.join(__dirname, '..', 'steamcmd');
  const zipPath = path.join(steamCmdDir, 'steamcmd.zip');
  if (!fs.existsSync(steamCmdDir)) fs.mkdirSync(steamCmdDir, { recursive: true });
  const fetch = (await import('node-fetch')).default;
  const resp = await fetch('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip');
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await resp.arrayBuffer()));
  await new Promise((resolve, reject) => {
    exec(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${steamCmdDir}' -Force"`, { timeout: 60000 }, (err) => err ? reject(err) : resolve());
  });
  const exePath = path.join(steamCmdDir, 'steamcmd.exe');
  if (!fs.existsSync(exePath)) throw new Error('steamcmd.exe not found after extraction');
  await new Promise((resolve) => {
    const proc = spawn(exePath, ['+quit'], { cwd: steamCmdDir });
    proc.on('exit', () => resolve()); proc.on('error', () => resolve());
    setTimeout(() => { try { proc.kill(); } catch {} resolve(); }, 120000);
  });
  steamCmdPath = exePath;
  try { fs.unlinkSync(zipPath); } catch {}
  return exePath;
}

function findWorkshopContent(workshopId) {
  const appId = CONFIG.steam.appId;
  const cmdDir = steamCmdPath ? path.dirname(steamCmdPath) : '';
  const searchPaths = [
    path.join(CONFIG.dayz.installDir, 'steamapps', 'workshop', 'content', appId, workshopId),
    cmdDir ? path.join(cmdDir, 'steamapps', 'workshop', 'content', appId, workshopId) : '',
    path.join(CONFIG.dayz.installDir, '..', '..', 'workshop', 'content', appId, workshopId),
  ].filter(Boolean);
  for (const p of searchPaths) {
    try { const resolved = path.resolve(p); if (fs.existsSync(resolved) && fs.readdirSync(resolved).length > 0) return resolved; } catch {}
  }
  return null;
}

async function downloadWorkshopMod(workshopId, modName, serverId) {
  const cmdPath = await ensureSteamCMD();
  const appId = CONFIG.steam.appId;
  if (!steamCredentials.username || !steamCredentials.password) throw new Error('Steam credentials required.');
  const args = [];
  if (steamCredentials.guardCode) args.push('+set_steam_guard_code', steamCredentials.guardCode);
  args.push('+login', steamCredentials.username, steamCredentials.password);
  const srv = servers.find(s => s.id === serverId);
  if (srv) args.push('+force_install_dir', srv.installDir);
  args.push('+workshop_download_item', appId, workshopId, 'validate', '+quit');

  io.emit('modInstallProgress', { serverId, workshopId, status: 'downloading', progress: 0, message: `Logging into Steam as ${steamCredentials.username}...` });

  return new Promise((resolve, reject) => {
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
    let output = ''; let needsSteamGuard = false;
    const handleData = (data) => {
      const text = data.toString(); output += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim(); if (!trimmed) continue;
        if (trimmed.includes('Steam Guard') || trimmed.includes('Two-factor') || trimmed.includes('Enter the current code')) {
          needsSteamGuard = true;
          io.emit('modInstallProgress', { serverId, workshopId, status: 'steam_guard', progress: 0, message: 'Steam Guard code required.' });
          try { proc.kill(); } catch {}
        } else if (trimmed.includes('Invalid Password') || trimmed.includes('Login Failure')) {
          io.emit('modInstallProgress', { serverId, workshopId, status: 'error', progress: 0, message: 'Invalid Steam credentials.' });
        } else if (trimmed.match(/(\d+\.?\d*)\s*%/)) {
          const pct = parseFloat(trimmed.match(/(\d+\.?\d*)\s*%/)[1]);
          io.emit('modInstallProgress', { serverId, workshopId, status: 'downloading', progress: pct, message: `Downloading... ${pct.toFixed(0)}%` });
        } else if (trimmed.includes('Success. Downloaded item')) {
          io.emit('modInstallProgress', { serverId, workshopId, status: 'downloaded', progress: 100, message: 'Download complete!' });
        }
      }
    };
    proc.stdout?.on('data', handleData); proc.stderr?.on('data', handleData);
    const timeout = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('Download timed out')); }, 30 * 60 * 1000);
    proc.on('exit', () => {
      clearTimeout(timeout);
      if (needsSteamGuard) { steamLoginValidated = false; return reject(new Error('Steam Guard code required.')); }
      if (output.includes('Invalid Password') || output.includes('Login Failure')) { steamLoginValidated = false; return reject(new Error('Invalid Steam credentials.')); }
      const contentPath = findWorkshopContent(workshopId);
      if (contentPath) { steamLoginValidated = true; resolve(contentPath); }
      else reject(new Error('Download failed — content not found.'));
    });
    proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

async function validateSteamLogin(username, password, guardCode) {
  const cmdPath = await ensureSteamCMD();
  const args = [];
  if (guardCode) args.push('+set_steam_guard_code', guardCode);
  args.push('+login', username, password, '+quit');
  return new Promise((resolve) => {
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
    let output = ''; let resolved = false;
    const done = (result) => { if (resolved) return; resolved = true; clearTimeout(timeout); try { proc.kill(); } catch {} resolve(result); };
    const handleData = (data) => {
      const text = data.toString(); output += text;
      if (text.includes('Steam Guard') || text.includes('Two-factor') || text.includes('authenticator') || text.includes('Enter the current code'))
        done({ success: false, needsGuard: true, error: 'Steam Guard code required' });
      else if (text.includes('Logged in OK') || text.includes('Waiting for user info...OK'))
        done({ success: true });
      else if (text.includes('Invalid Password') || text.includes('Login Failure'))
        done({ success: false, error: 'Invalid username or password' });
      else if (text.includes('rate limit') || text.includes('too many'))
        done({ success: false, error: 'Too many attempts — wait and retry' });
    };
    proc.stdout?.on('data', handleData); proc.stderr?.on('data', handleData);
    const timeout = setTimeout(() => {
      if (output.includes('Logged in OK') || output.includes('Waiting for user info...OK')) done({ success: true });
      else done({ success: false, error: 'Login timed out' });
    }, 30000);
    proc.on('exit', () => {
      if (resolved) return;
      if (output.includes('Logged in OK') || output.includes('Waiting for user info...OK')) done({ success: true });
      else if (output.includes('Steam Guard') || output.includes('Enter the current code')) done({ success: false, needsGuard: true, error: 'Steam Guard code required' });
      else if (output.includes('Invalid Password')) done({ success: false, error: 'Invalid username or password' });
      else done({ success: true });
    });
    proc.on('error', (err) => done({ success: false, error: err.message }));
  });
}

function installModToServer(workshopContentPath, modName, workshopId, installDir) {
  const folderName = modName.startsWith('@') ? modName : `@${modName}`;
  const safeName = folderName.replace(/[<>:"/\\|?*]/g, '').trim();
  const destPath = path.join(installDir, safeName);
  if (fs.existsSync(destPath)) fs.rmSync(destPath, { recursive: true, force: true });
  copyDirSync(workshopContentPath, destPath);
  const metaPath = path.join(destPath, 'meta.cpp');
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, `protocol = 1;\nname = "${modName}";\ntimestamp = ${Math.floor(Date.now() / 1000)};\npublishedid = ${workshopId};\n`);
  }
  const keysSource = [path.join(destPath, 'keys'), path.join(destPath, 'Keys'), path.join(destPath, 'key')].find(k => fs.existsSync(k));
  if (keysSource) {
    const serverKeysDir = path.join(installDir, 'keys');
    if (!fs.existsSync(serverKeysDir)) fs.mkdirSync(serverKeysDir, { recursive: true });
    try { fs.readdirSync(keysSource).filter(f => f.endsWith('.bikey')).forEach(f => { if (!fs.existsSync(path.join(serverKeysDir, f))) fs.copyFileSync(path.join(keysSource, f), path.join(serverKeysDir, f)); }); } catch {}
  }
  return safeName;
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
  }
}

function updateStartBatMods(serverId) {
  const srv = servers.find(s => s.id === serverId);
  const state = serverStates[serverId];
  if (!srv || !state || !srv.startBat) return;
  const batPath = path.join(srv.installDir, srv.startBat);
  if (!fs.existsSync(batPath)) return;
  try {
    let content = fs.readFileSync(batPath, 'utf8');
    const enabledMods = state.modList.filter(m => m.enabled).map(m => m.name).join(';');
    const backupDir = path.join(srv.installDir, '.backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(batPath, path.join(backupDir, `${srv.startBat}.${Date.now()}.bak`));
    if (content.match(/"-mod=[^"]*"/i)) content = content.replace(/"-mod=[^"]*"/i, `"-mod=${enabledMods}"`);
    else if (content.match(/-mod=[^\s"]+/i)) content = content.replace(/-mod=[^\s"]+/i, `-mod=${enabledMods}`);
    fs.writeFileSync(batPath, content);
  } catch {}
}

// ─── Workshop Search ─────────────────────────────────────
const DAYZ_APP_ID = 221100;

async function enrichWorkshopResults(items) {
  if (items.length === 0) return items;
  try {
    const fetch = (await import('node-fetch')).default;
    const params = new URLSearchParams();
    params.append('itemcount', items.length);
    items.forEach((item, i) => params.append(`publishedfileids[${i}]`, item.workshopId));
    const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), timeout: 10000,
    });
    const data = await response.json();
    const details = data.response?.publishedfiledetails || [];
    return items.map(item => {
      const d = details.find(x => x.publishedfileid === item.workshopId);
      if (d && d.result === 1) return {
        ...item, name: d.title || item.name,
        description: (d.description || '').replace(/\[.*?\]/g, '').substring(0, 200),
        preview: d.preview_url || item.preview, subscribers: d.subscriptions || 0,
        favorites: d.favorited || 0, fileSize: d.file_size || 0,
        updated: d.time_updated ? new Date(d.time_updated * 1000).toISOString() : '',
        tags: (d.tags || []).map(t => t.tag),
      };
      return item;
    });
  } catch { return items; }
}

async function scrapeWorkshopSearch(query, page) {
  const fetch = (await import('node-fetch')).default;
  const url = `https://steamcommunity.com/workshop/browse/?appid=${DAYZ_APP_ID}&searchtext=${encodeURIComponent(query)}&browsesort=textsearch&section=readytouseitems&actualsort=textsearch&p=${page}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, timeout: 15000 });
  const html = await response.text();
  const results = [];
  let match;
  // Pattern 1: data-publishedfileid attribute (modern Steam Workshop HTML)
  const p1 = /data-publishedfileid="(\d+)"[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g;
  while ((match = p1.exec(html)) !== null) {
    if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] });
  }
  // Pattern 2: SharedFileBindMouseHover
  if (results.length === 0) {
    const p2 = /SharedFileBindMouseHover[^"]*"(\d+)"[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g;
    while ((match = p2.exec(html)) !== null) {
      if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] });
    }
  }
  // Pattern 3: workshopItem block with filedetails link
  if (results.length === 0) {
    const p3 = /workshopItem[^>]*>[\s\S]*?filedetails\/\?id=(\d+)[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g;
    while ((match = p3.exec(html)) !== null) {
      if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] });
    }
  }
  // Pattern 4: simple filedetails link + title
  if (results.length === 0) {
    const p4 = /filedetails\/\?id=(\d+)[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g;
    while ((match = p4.exec(html)) !== null) {
      if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] });
    }
  }
  // Pattern 5: just extract any filedetails IDs and enrich them
  if (results.length === 0) {
    const idSet = new Set();
    const p5 = /filedetails\/\?id=(\d+)/g;
    while ((match = p5.exec(html)) !== null) idSet.add(match[1]);
    for (const id of idSet) results.push({ workshopId: id, name: '', description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] });
  }
  return enrichWorkshopResults(results);
}

// ════════════════════════════════════════════════════════════
// ─── API ROUTES ────────────────────────────────────────────
// ════════════════════════════════════════════════════════════

// ─── Auth ────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, CONFIG.jwtSecret, { expiresIn: '24h' });
  addAudit(user.id, user.username, 'login', 'User logged in');
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// ─── Server Hub ──────────────────────────────────────────
app.get('/api/servers', auth(), (req, res) => {
  const result = servers.map(s => {
    const state = serverStates[s.id] || {};
    return {
      ...s, rconPassword: undefined,
      status: state.status || 'stopped',
      playerCount: state.players?.length || 0,
      maxPlayers: state.config?.maxPlayers || s.maxPlayers || 60,
      cpu: state.metricsHistory?.cpu?.slice(-1)[0] || 0,
      ram: state.metricsHistory?.ram?.slice(-1)[0] || 0,
      uptime: state.startedAt ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000) : 0,
      modCount: state.modList?.length || 0,
    };
  });
  res.json(result);
});

app.post('/api/servers', auth('server.deploy'), async (req, res) => {
  const { name, installDir, executable, startBat, launchParams, ip, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map, gameTitle } = req.body;
  if (!name || !installDir) return res.status(400).json({ error: 'Name and installDir required' });
  const srv = {
    id: uuid(), name, installDir: installDir.replace(/\//g, '\\'),
    executable: executable || 'DayZServer_x64.exe', startBat: startBat || '',
    launchParams: launchParams || '-config=serverDZ.cfg -port=2302 -dologs -adminlog -netlog -freezecheck',
    ip: ip || '127.0.0.1', gamePort: gamePort || 2302, queryPort: queryPort || 2303,
    rconPort: rconPort || 2305, rconPassword: rconPassword || '',
    maxPlayers: maxPlayers || 60, map: map || 'chernarusplus',
    gameTitle: gameTitle || 'DayZ, PC', profileDir: '', createdAt: new Date().toISOString(),
  };
  servers.push(srv); saveServers(); initServerState(srv.id);
  addAudit(req.user.id, req.user.username, 'server.create', `Created server: ${name}`);
  res.json(srv);
});

app.patch('/api/servers/:id', auth('server.deploy'), (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const allowed = ['name','installDir','executable','startBat','launchParams','launchParamsList','ip','gamePort','queryPort','rconPort','rconPassword','maxPlayers','map','gameTitle','profileDir','networkInterface','autoStart','cpuAffinity','priorityLevel','processIntegrityChecks','integrityCheckMods','startGracePeriod','healthMonitoring','healthMinFPS','healthMaxRAM','healthAction','shutdownForModUpdates','shutdownForTitleUpdates','ignoreServerModUpdates'];
  for (const key of allowed) { if (req.body[key] !== undefined) srv[key] = req.body[key]; }
  saveServers();
  addAudit(req.user.id, req.user.username, 'server.update', `Updated server: ${srv.name}`);
  res.json(srv);
});

app.delete('/api/servers/:id', auth('server.deploy'), (req, res) => {
  const idx = servers.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Server not found' });
  const name = servers[idx].name;
  if (serverStates[req.params.id]?.status === 'running') return res.status(400).json({ error: 'Stop the server first' });
  delete serverStates[req.params.id];
  servers.splice(idx, 1); saveServers();
  addAudit(req.user.id, req.user.username, 'server.delete', `Deleted server: ${name}`);
  res.json({ message: 'Server deleted' });
});

// ─── Server Control (per server) ─────────────────────────
app.get('/api/servers/:id/status', auth(), (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const state = serverStates[srv.id] || {};
  res.json({
    status: state.status || 'stopped',
    players: state.players || [], playerCount: state.players?.length || 0,
    maxPlayers: state.config?.maxPlayers || srv.maxPlayers || 60,
    serverName: state.config?.hostname || srv.name,
    map: state.config?.template || srv.map || 'chernarusplus',
    gameVersion: state.config?.gameVersion || '',
    uptime: state.startedAt ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000) : 0,
    ports: { game: srv.gamePort, query: srv.queryPort, rcon: srv.rconPort },
    cpu: state.metricsHistory?.cpu?.slice(-1)[0] || 0,
    ram: state.metricsHistory?.ram?.slice(-1)[0] || 0,
  });
});

app.post('/api/servers/:id/start', auth('server.start'), async (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const state = serverStates[srv.id];
  if (!state) return res.status(500).json({ error: 'State not initialized' });
  if (state.status === 'running') return res.status(400).json({ error: 'Already running' });

  const existingPid = await detectRunningProcess(srv.executable);
  if (existingPid) {
    state.pid = existingPid; state.status = 'running'; state.startedAt = new Date().toISOString();
    io.emit('serverStatus', { serverId: srv.id, status: 'running' });
    return res.json({ message: `Already running (PID: ${existingPid})` });
  }

  state.status = 'starting'; io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
  addLog(srv.id, 'info', 'server', `Start initiated by ${req.user.username}`);
  try {
    state.process = spawnDayZServer(srv); state.pid = state.process.pid;
    setTimeout(async () => {
      const pid = await detectRunningProcess(srv.executable);
      if (pid) {
        state.pid = pid; state.status = 'running'; state.startedAt = new Date().toISOString();
        io.emit('serverStatus', { serverId: srv.id, status: 'running' });
        addLog(srv.id, 'info', 'server', 'Server is now running');
        addNotification(srv.id, 'server.started', 'Server Started', `${srv.name} is now running`, 'success');
        fireWebhooks('server.started', { serverId: srv.id, serverName: srv.name });
        sendDiscordWebhook(`🟢 **${srv.name}** started`);
      } else if (state.status === 'starting') {
        state.status = 'crashed'; io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
      }
    }, 8000);
    addAudit(req.user.id, req.user.username, 'server.start', `Started: ${srv.name}`);
    res.json({ message: 'Starting...' });
  } catch (err) {
    state.status = 'crashed'; io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/servers/:id/stop', auth('server.stop'), async (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const state = serverStates[srv.id];
  if (!state || state.status === 'stopped') return res.status(400).json({ error: 'Not running' });

  state.status = 'stopping'; io.emit('serverStatus', { serverId: srv.id, status: 'stopping' });
  addLog(srv.id, 'info', 'server', `Stop initiated by ${req.user.username}`);
  try {
    if (state.rcon?.loggedIn) { try { await state.rcon.shutdown(); await new Promise(r => setTimeout(r, 5000)); } catch {} }
    await killProcess(state.pid, srv.executable);
    state.status = 'stopped'; state.pid = null; state.process = null; state.players = []; state.startedAt = null;
    io.emit('serverStatus', { serverId: srv.id, status: 'stopped' });
    io.emit('players', { serverId: srv.id, players: [] });
    addAudit(req.user.id, req.user.username, 'server.stop', `Stopped: ${srv.name}`);
    addNotification(srv.id, 'server.stopped', 'Server Stopped', `${srv.name} has been stopped`, 'info');
    fireWebhooks('server.stopped', { serverId: srv.id, serverName: srv.name });
    sendDiscordWebhook(`🔴 **${srv.name}** stopped`);
    res.json({ message: 'Stopped' });
  } catch {
    state.status = 'stopped'; state.pid = null;
    io.emit('serverStatus', { serverId: srv.id, status: 'stopped' });
    res.json({ message: 'Stopped (force)' });
  }
});

app.post('/api/servers/:id/restart', auth('server.restart'), async (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const state = serverStates[srv.id];
  if (!state) return res.status(500).json({ error: 'State not initialized' });

  addLog(srv.id, 'info', 'server', `Restart initiated by ${req.user.username}`);
  state.status = 'stopping'; io.emit('serverStatus', { serverId: srv.id, status: 'stopping' });
  let restartSuccess = false;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (state.pid) await killProcess(state.pid, srv.executable);
      state.pid = null; state.process = null; state.players = [];
      await new Promise(r => setTimeout(r, 3000));
      state.status = 'starting'; io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
      state.process = spawnDayZServer(srv); state.pid = state.process.pid;
      await new Promise(r => setTimeout(r, 8000));
      const pid = await detectRunningProcess(srv.executable);
      if (pid) {
        state.pid = pid; state.status = 'running'; state.startedAt = new Date().toISOString();
        io.emit('serverStatus', { serverId: srv.id, status: 'running' });
        addNotification(srv.id, 'server.restarted', 'Server Restarted', `${srv.name} has been restarted`, 'info');
        fireWebhooks('server.restarted', { serverId: srv.id, serverName: srv.name });
        sendDiscordWebhook(`🔄 **${srv.name}** restarted`);
        addLog(srv.id, 'info', 'server', `Restart succeeded on attempt ${attempt}`);
        restartSuccess = true;
        break;
      } else {
        lastError = `Process not detected after restart attempt ${attempt}`;
        addLog(srv.id, 'error', 'server', lastError);
      }
    } catch (err) {
      lastError = `Restart attempt ${attempt} failed: ${err.message}`;
      addLog(srv.id, 'error', 'server', lastError);
    }
  }
  addAudit(req.user.id, req.user.username, 'server.restart', `Restarted: ${srv.name} (success: ${restartSuccess})`);
  if (restartSuccess) {
    res.json({ message: 'Restarting...' });
  } else {
    state.status = 'crashed'; io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
    addNotification(srv.id, 'server.crashed', 'Restart Failed', `${srv.name} failed to restart after 3 attempts`, 'error');
    fireWebhooks('server.crashed', { serverId: srv.id, serverName: srv.name });
    sendDiscordWebhook(`💥 **${srv.name}** failed to restart after 3 attempts`);
    res.status(500).json({ error: lastError || 'Failed to restart after 3 attempts' });
  }
});

app.post('/api/servers/:id/lock', auth('server.rcon'), async (req, res) => {
  const state = serverStates[req.params.id];
  if (state?.rcon) { await state.rcon.lock(); res.json({ message: 'Locked' }); }
  else res.status(400).json({ error: 'RCON not available' });
});

app.post('/api/servers/:id/unlock', auth('server.rcon'), async (req, res) => {
  const state = serverStates[req.params.id];
  if (state?.rcon) { await state.rcon.unlock(); res.json({ message: 'Unlocked' }); }
  else res.status(400).json({ error: 'RCON not available' });
});

// ─── RCON / Players / Bans (per server) ──────────────────
app.post('/api/servers/:id/rcon', auth('server.rcon'), async (req, res) => {
  const state = serverStates[req.params.id];
  if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
  try { const result = await state.rcon.send(req.body.command); res.json({ result }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/servers/:id/message', auth('chat.send'), async (req, res) => {
  const state = serverStates[req.params.id];
  if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
  await state.rcon.say(req.body.message);
  res.json({ message: 'Sent' });
});

app.get('/api/servers/:id/players', auth('players.view'), (req, res) => {
  res.json(serverStates[req.params.id]?.players || []);
});

app.post('/api/servers/:id/players/:playerId/kick', auth('players.kick'), async (req, res) => {
  const state = serverStates[req.params.id];
  if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
  await state.rcon.kick(req.params.playerId, req.body.reason || 'Kicked');
  state.players = state.players.filter(p => p.id !== req.params.playerId);
  io.emit('players', { serverId: req.params.id, players: state.players });
  addAudit(req.user.id, req.user.username, 'player.kick', `Kicked player ${req.params.playerId}`);
  addNotification(req.params.id, 'player.kick', 'Player Kicked', `Player ${req.params.playerId} was kicked`, 'warning');
  fireWebhooks('player.kick', { serverId: req.params.id, playerId: req.params.playerId, reason: req.body.reason || 'Kicked' });
  res.json({ message: 'Kicked' });
});

app.post('/api/servers/:id/players/:playerId/ban', auth('players.ban'), async (req, res) => {
  const state = serverStates[req.params.id];
  if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
  await state.rcon.ban(req.params.playerId, req.body.reason || 'Banned');
  const player = state.players.find(p => p.id === req.params.playerId);
  state.banList.push({ id: req.params.playerId, name: player?.name || 'Unknown', reason: req.body.reason || 'Banned', bannedAt: new Date().toISOString(), expiresAt: null });
  state.players = state.players.filter(p => p.id !== req.params.playerId);
  io.emit('players', { serverId: req.params.id, players: state.players });
  addAudit(req.user.id, req.user.username, 'player.ban', `Banned player ${req.params.playerId}`);
  addNotification(req.params.id, 'player.ban', 'Player Banned', `Player ${req.params.playerId} was banned`, 'error');
  fireWebhooks('player.ban', { serverId: req.params.id, playerId: req.params.playerId, reason: req.body.reason || 'Banned' });
  res.json({ message: 'Banned' });
});

app.get('/api/servers/:id/bans', auth(), (req, res) => { res.json(serverStates[req.params.id]?.banList || []); });
app.delete('/api/servers/:id/bans/:banId', auth('players.ban'), (req, res) => {
  const state = serverStates[req.params.id];
  if (state) state.banList = state.banList.filter(b => b.id !== req.params.banId);
  res.json({ message: 'Ban removed' });
});

// ─── Server Logs & Metrics ───────────────────────────────
app.get('/api/servers/:id/logs', auth('logs.view'), (req, res) => {
  const { level, source, limit = 200 } = req.query;
  let logs = serverStates[req.params.id]?.logs || [];
  if (level) logs = logs.filter(l => l.level === level);
  if (source) logs = logs.filter(l => l.source === source);
  res.json(logs.slice(0, parseInt(limit)));
});

app.get('/api/servers/:id/metrics', auth('metrics.view'), (req, res) => {
  res.json(serverStates[req.params.id]?.metricsHistory || { cpu: [], ram: [], players: [], fps: [], timestamps: [] });
});

// Metrics streaming via Socket.IO
app.get('/api/servers/:id/metrics/stream', auth('metrics.view'), (req, res) => {
  res.json({ message: 'Use Socket.IO events: metrics' });
});

// ─── Server Config ───────────────────────────────────────
app.get('/api/servers/:id/config', auth('server.config'), (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const state = serverStates[srv.id];
  if (state) state.config = readServerConfig(srv.installDir);
  res.json(state?.config || {});
});

app.patch('/api/servers/:id/config', auth('server.config'), (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (writeServerConfig(srv.installDir, req.body)) {
    if (serverStates[srv.id]) serverStates[srv.id].config = readServerConfig(srv.installDir);
    addAudit(req.user.id, req.user.username, 'config.update', `Updated config for ${srv.name}`);
    res.json(serverStates[srv.id]?.config || {});
  } else res.status(500).json({ error: 'Failed to write config' });
});

// ─── Mods (per server) ──────────────────────────────────
app.get('/api/servers/:id/mods', auth('mods.view'), (req, res) => {
  res.json(serverStates[req.params.id]?.modList || []);
});

app.post('/api/servers/:id/mods/install', auth('mods.install'), async (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const state = serverStates[srv.id];
  const { workshopId, name } = req.body;
  if (!workshopId || !name) return res.status(400).json({ error: 'workshopId and name required' });
  if (state?.modList.find(m => m.workshopId === String(workshopId))) return res.status(400).json({ error: 'Already installed' });
  if (activeInstalls[workshopId]?.status === 'downloading') return res.status(409).json({ error: 'Already downloading' });

  activeInstalls[workshopId] = { status: 'starting', progress: 0, name };
  res.json({ message: 'Download started', workshopId });

  try {
    activeInstalls[workshopId] = { status: 'downloading', progress: 0, name };
    const contentPath = await downloadWorkshopMod(String(workshopId), name, srv.id);
    activeInstalls[workshopId] = { status: 'installing', progress: 90, name };
    const folderName = installModToServer(contentPath, name, String(workshopId), srv.installDir);
    state.modList.push({ name: folderName, workshopId: String(workshopId), enabled: true, order: state.modList.length });
    updateStartBatMods(srv.id);
    activeInstalls[workshopId] = { status: 'complete', progress: 100, name };
    io.emit('modInstallProgress', { serverId: srv.id, workshopId, status: 'complete', progress: 100, message: `${name} installed!` });
    io.emit('mods', { serverId: srv.id, mods: state.modList });
    addAudit(req.user.id, req.user.username, 'mod.install', `Installed ${name} on ${srv.name}`);
    addNotification(srv.id, 'mod.installed', 'Mod Installed', `${name} installed on ${srv.name}`, 'success');
    fireWebhooks('mod.installed', { serverId: srv.id, modName: name });
    setTimeout(() => delete activeInstalls[workshopId], 30000);
  } catch (err) {
    activeInstalls[workshopId] = { status: 'error', progress: 0, name, error: err.message };
    io.emit('modInstallProgress', { serverId: srv.id, workshopId, status: 'error', progress: 0, message: err.message });
    setTimeout(() => delete activeInstalls[workshopId], 60000);
  }
});

app.delete('/api/servers/:id/mods/uninstall/:workshopId', auth('mods.install'), (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const state = serverStates[srv.id];
  const mod = state?.modList.find(m => m.workshopId === req.params.workshopId);
  if (!mod) return res.status(404).json({ error: 'Mod not found' });
  try {
    const modPath = path.join(srv.installDir, mod.name);
    if (fs.existsSync(modPath)) fs.rmSync(modPath, { recursive: true, force: true });
    state.modList = state.modList.filter(m => m.workshopId !== req.params.workshopId);
    updateStartBatMods(srv.id);
    io.emit('mods', { serverId: srv.id, mods: state.modList });
    addAudit(req.user.id, req.user.username, 'mod.uninstall', `Uninstalled ${mod.name} from ${srv.name}`);
    addNotification(srv.id, 'mod.removed', 'Mod Uninstalled', `${mod.name} removed from ${srv.name}`, 'info');
    fireWebhooks('mod.removed', { serverId: srv.id, modName: mod.name });
    res.json({ message: `${mod.name} uninstalled` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/servers/:id/mods/:workshopId', auth('mods.install'), (req, res) => {
  const state = serverStates[req.params.id];
  if (!state) return res.status(404).json({ error: 'Server not found' });
  const mod = state.modList.find(m => m.workshopId === req.params.workshopId);
  if (!mod) return res.status(404).json({ error: 'Mod not found' });
  Object.assign(mod, req.body);
  updateStartBatMods(req.params.id);
  res.json(mod);
});

app.get('/api/mods/install-status', auth(), (req, res) => { res.json(activeInstalls); });

// ─── Files (per server) ─────────────────────────────────
app.get('/api/servers/:id/files', auth('files.browse'), (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const { dir } = req.query;
  const basePath = srv.installDir;
  const targetDir = dir ? path.resolve(basePath, dir) : basePath;
  if (!targetDir.startsWith(basePath)) return res.status(403).json({ error: 'Access denied' });
  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const results = entries.map(e => {
      const fullPath = path.join(targetDir, e.name);
      let size = 0, modified = 0;
      try { const s = fs.statSync(fullPath); size = s.size; modified = s.mtimeMs; } catch {}
      return { name: e.name, type: e.isDirectory() ? 'directory' : 'file', path: path.relative(basePath, fullPath).replace(/\\/g, '/'), size, modified };
    });
    results.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/servers/:id/files/read', auth('files.edit'), (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const { file } = req.query;
  const filePath = path.resolve(srv.installDir, file);
  if (!filePath.startsWith(srv.installDir)) return res.status(403).json({ error: 'Access denied' });
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large' });
    const binaryExts = ['.exe','.dll','.pdb','.pbo','.pak','.bin','.so','.png','.jpg','.jpeg','.gif','.bmp','.ico','.wav','.ogg','.mp3','.zip','.rar','.7z','.bikey','.bisign'];
    if (binaryExts.includes(path.extname(filePath).toLowerCase())) return res.status(400).json({ error: 'Binary file' });
    res.json({ content: fs.readFileSync(filePath, 'utf8'), path: file, size: stat.size, modified: stat.mtimeMs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/servers/:id/files/write', auth('files.edit'), (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const { file, content } = req.body;
  const filePath = path.resolve(srv.installDir, file);
  if (!filePath.startsWith(srv.installDir)) return res.status(403).json({ error: 'Access denied' });
  try {
    const bd = path.join(srv.installDir, '.backups');
    if (!fs.existsSync(bd)) fs.mkdirSync(bd, { recursive: true });
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, path.join(bd, `${path.basename(file)}.${Date.now()}.bak`));
    fs.writeFileSync(filePath, content);
    addAudit(req.user.id, req.user.username, 'file.edit', `Edited ${file} on ${srv.name}`);
    res.json({ message: 'Saved' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Schedule (per server) ───────────────────────────────
app.get('/api/servers/:id/schedule', auth(), (req, res) => {
  res.json(serverStates[req.params.id]?.scheduledRestarts || []);
});

app.post('/api/servers/:id/schedule', auth('server.restart'), (req, res) => {
  const state = serverStates[req.params.id];
  if (!state) return res.status(404).json({ error: 'Server not found' });
  const task = { id: uuid(), cronExpression: req.body.cronExpression, label: req.body.label, enabled: req.body.enabled !== false };
  state.scheduledRestarts.push(task);
  res.json(task);
});

app.delete('/api/servers/:id/schedule/:taskId', auth('server.restart'), (req, res) => {
  const state = serverStates[req.params.id];
  if (state) state.scheduledRestarts = state.scheduledRestarts.filter(s => s.id !== req.params.taskId);
  res.json({ message: 'Removed' });
});

// ─── Users & Roles ───────────────────────────────────────
app.get('/api/users', auth('users.manage'), (req, res) => {
  res.json(users.map(u => ({ id: u.id, username: u.username, role: u.role, isRoot: u.isRoot || false, description: u.description || '', createdAt: u.createdAt })));
});

app.post('/api/users', auth('users.manage'), async (req, res) => {
  const { username, password, role, description } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username already exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uuid(), username, passwordHash: hash, role: role || 'viewer', description: description || '', createdAt: new Date().toISOString() };
  users.push(user); saveUsers();
  addAudit(req.user.id, req.user.username, 'user.create', `Created user: ${username}`);
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.patch('/api/users/:id', auth('users.manage'), async (req, res) => {
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.isRoot) return res.status(403).json({ error: 'Cannot modify root user' });
  if (req.body.username) user.username = req.body.username;
  if (req.body.role) user.role = req.body.role;
  if (req.body.description !== undefined) user.description = req.body.description;
  if (req.body.password) user.passwordHash = await bcrypt.hash(req.body.password, 10);
  saveUsers();
  addAudit(req.user.id, req.user.username, 'user.update', `Updated user: ${user.username}`);
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.delete('/api/users/:id', auth('users.manage'), (req, res) => {
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.isRoot) return res.status(403).json({ error: 'Cannot delete root user' });
  users = users.filter(u => u.id !== req.params.id); saveUsers();
  addAudit(req.user.id, req.user.username, 'user.delete', `Deleted user: ${user.username}`);
  res.json({ message: 'User deleted' });
});

// ─── Roles ───────────────────────────────────────────────
app.get('/api/roles', auth(), (req, res) => { res.json(roles); });

app.post('/api/roles', auth('users.manage'), (req, res) => {
  const { name, permissions, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const role = { id: uuid(), name, permissions: permissions || [], color: color || '#8b919a', builtIn: false };
  roles.push(role); saveRoles();
  addAudit(req.user.id, req.user.username, 'role.create', `Created role: ${name}`);
  res.json(role);
});

app.patch('/api/roles/:id', auth('users.manage'), (req, res) => {
  const role = roles.find(r => r.id === req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.builtIn && req.body.name) return res.status(403).json({ error: 'Cannot rename built-in role' });
  if (req.body.permissions) role.permissions = req.body.permissions;
  if (req.body.color) role.color = req.body.color;
  if (req.body.name && !role.builtIn) role.name = req.body.name;
  saveRoles();
  res.json(role);
});

app.delete('/api/roles/:id', auth('users.manage'), (req, res) => {
  const role = roles.find(r => r.id === req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.builtIn) return res.status(403).json({ error: 'Cannot delete built-in role' });
  roles = roles.filter(r => r.id !== req.params.id); saveRoles();
  res.json({ message: 'Role deleted' });
});

// ─── Audit Log ───────────────────────────────────────────
app.get('/api/audit', auth('users.manage'), (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  res.json({ entries: auditLog.slice(parseInt(offset), parseInt(offset) + parseInt(limit)), total: auditLog.length });
});

// ─── Webhooks ────────────────────────────────────────────
app.get('/api/webhooks', auth('webhooks.manage'), (req, res) => { res.json(webhooks); });

app.post('/api/webhooks', auth('webhooks.manage'), (req, res) => {
  const { event, url, template, retryEnabled, timeout, headers } = req.body;
  if (!event || !url) return res.status(400).json({ error: 'Event and URL required' });
  const isDiscord = url.includes('discord.com/api/webhooks');
  let isValidJson = false;
  if (template) { try { JSON.parse(template); isValidJson = true; } catch {} }
  const wh = {
    id: uuid(), event, url, template: template || (isDiscord ? JSON.stringify({ content: '**{server.name}** — {timestamp}' }) : ''),
    retryEnabled: retryEnabled !== false, timeout: timeout || 60000,
    headers: headers || {}, enabled: true, isDiscord, isValidJson,
    deliveries: [], createdAt: new Date().toISOString(),
  };
  webhooks.push(wh); saveJSON('webhooks.json', webhooks);
  addAudit(req.user.id, req.user.username, 'webhook.create', `Created webhook for ${event}`);
  res.json(wh);
});

app.patch('/api/webhooks/:id', auth('webhooks.manage'), (req, res) => {
  const wh = webhooks.find(w => w.id === req.params.id);
  if (!wh) return res.status(404).json({ error: 'Webhook not found' });
  const allowed = ['event','url','template','retryEnabled','timeout','headers','enabled'];
  for (const key of allowed) { if (req.body[key] !== undefined) wh[key] = req.body[key]; }
  wh.isDiscord = wh.url.includes('discord.com/api/webhooks');
  if (wh.template) { try { JSON.parse(wh.template); wh.isValidJson = true; } catch { wh.isValidJson = false; } }
  saveJSON('webhooks.json', webhooks);
  res.json(wh);
});

app.delete('/api/webhooks/:id', auth('webhooks.manage'), (req, res) => {
  webhooks = webhooks.filter(w => w.id !== req.params.id);
  saveJSON('webhooks.json', webhooks);
  addAudit(req.user.id, req.user.username, 'webhook.delete', 'Deleted webhook');
  res.json({ message: 'Deleted' });
});

app.get('/api/webhooks/:id/deliveries', auth('webhooks.manage'), (req, res) => {
  const wh = webhooks.find(w => w.id === req.params.id);
  res.json(wh?.deliveries || []);
});

app.post('/api/webhooks/:id/test', auth('webhooks.manage'), async (req, res) => {
  const wh = webhooks.find(w => w.id === req.params.id);
  if (!wh) return res.status(404).json({ error: 'Not found' });
  try { await fireWebhooks(wh.event, { serverId: 'test', serverName: 'Test Server' }); res.json({ message: 'Test fired' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Notifications ───────────────────────────────────────
app.get('/api/notifications', auth(), (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(notifications.slice(0, limit));
});

app.patch('/api/notifications/read', auth(), (req, res) => {
  const { ids } = req.body; // array of IDs, or omit to mark all read
  if (ids && Array.isArray(ids)) {
    ids.forEach(id => { const n = notifications.find(x => x.id === id); if (n) n.read = true; });
  } else {
    notifications.forEach(n => n.read = true);
  }
  res.json({ message: 'Marked as read' });
});

app.delete('/api/notifications', auth(), (req, res) => {
  notifications.length = 0;
  res.json({ message: 'Cleared' });
});

// ─── Server Deployment ───────────────────────────────────
app.post('/api/deploy', auth('server.deploy'), async (req, res) => {
  const { name, installDir, gameTitle, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map } = req.body;
  if (!name || !installDir) return res.status(400).json({ error: 'Name and install directory required' });

  const appId = gameTitle === 'DayZ, PC (Experimental)' ? '1024020' : '223350';
  const resolvedDir = path.resolve(installDir);

  addAudit(req.user.id, req.user.username, 'server.deploy', `Deploying ${name} to ${resolvedDir}`);
  io.emit('deployProgress', { status: 'starting', message: 'Preparing deployment...' });

  const srv = {
    id: uuid(), name, installDir: resolvedDir,
    executable: 'DayZServer_x64.exe', startBat: '',
    launchParams: `-config=serverDZ.cfg -port=${gamePort || 2302} -dologs -adminlog -netlog -freezecheck`,
    ip: '127.0.0.1', gamePort: gamePort || 2302, queryPort: queryPort || 2303,
    rconPort: rconPort || 2305, rconPassword: rconPassword || '',
    maxPlayers: maxPlayers || 60, map: map || 'chernarusplus',
    gameTitle: gameTitle || 'DayZ, PC', profileDir: '', createdAt: new Date().toISOString(), deploying: true,
  };
  servers.push(srv); saveServers(); initServerState(srv.id);
  res.json({ message: 'Deployment started', server: srv });

  // Background download
  try {
    const cmdPath = await ensureSteamCMD();
    if (!fs.existsSync(resolvedDir)) fs.mkdirSync(resolvedDir, { recursive: true });
    io.emit('deployProgress', { serverId: srv.id, status: 'downloading', message: 'Downloading DayZ Server via SteamCMD...' });

    const args = ['+force_install_dir', resolvedDir];
    if (steamCredentials.username && steamCredentials.password) {
      if (steamCredentials.guardCode) args.push('+set_steam_guard_code', steamCredentials.guardCode);
      args.push('+login', steamCredentials.username, steamCredentials.password);
    } else { args.push('+login', 'anonymous'); }
    args.push('+app_update', appId, 'validate', '+quit');

    await new Promise((resolve, reject) => {
      const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
      proc.stdout?.on('data', (data) => {
        for (const line of data.toString().split('\n')) {
          const trimmed = line.trim();
          if (trimmed.match(/(\d+\.?\d*)\s*%/)) {
            const pct = parseFloat(trimmed.match(/(\d+\.?\d*)\s*%/)[1]);
            io.emit('deployProgress', { serverId: srv.id, status: 'downloading', progress: pct, message: `Downloading... ${pct.toFixed(0)}%` });
          } else if (trimmed.includes('Update state')) {
            io.emit('deployProgress', { serverId: srv.id, status: 'downloading', message: trimmed });
          }
        }
      });
      proc.stderr?.on('data', () => {});
      const timeout = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('Deploy timed out')); }, 60 * 60 * 1000);
      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0 || fs.existsSync(path.join(resolvedDir, 'DayZServer_x64.exe'))) resolve();
        else reject(new Error(`SteamCMD exit code: ${code}`));
      });
      proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });

    // Create default config
    const cfgPath = path.join(resolvedDir, 'serverDZ.cfg');
    if (!fs.existsSync(cfgPath)) {
      fs.writeFileSync(cfgPath, `hostname = "${name}";\npassword = "";\npasswordAdmin = "";\nmaxPlayers = ${maxPlayers || 60};\nverifySignatures = 2;\nforceSameBuild = 1;\ndisableThirdPerson = 0;\nserverTime = "SystemTime";\nserverTimeAcceleration = 1;\nserverTimePersistent = 0;\nguaranteedUpdates = 1;\nloginQueueConcurrentPlayers = 5;\nloginQueueMaxPlayers = 500;\ninstanceId = 1;\nstorageAutoFix = 1;\nrespawnTime = 5;\ntimeStampFormat = "Short";\ntemplate = "${map || 'chernarusplus'}";\n`);
    }
    srv.deploying = false; saveServers();
    serverStates[srv.id].config = readServerConfig(resolvedDir);
    io.emit('deployProgress', { serverId: srv.id, status: 'complete', message: 'Deployment complete!' });
  } catch (err) {
    io.emit('deployProgress', { serverId: srv.id, status: 'error', message: err.message });
    srv.deploying = false; srv.deployError = err.message; saveServers();
  }
});

// ─── Dangerzone: Server Rebuild (Wipe & Reinstall) ──────
app.post('/api/servers/:id/rebuild', auth('server.rebuild'), async (req, res) => {
  const srv = servers.find(s => s.id === req.params.id);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  const resolvedDir = path.resolve(srv.installDir);
  addAudit(req.user.id, req.user.username, 'server.rebuild', `Rebuilding ${srv.name} at ${resolvedDir}`);
  io.emit('dangerzoneProgress', { serverId: srv.id, status: 'starting', message: 'Preparing to wipe and reinstall server...' });
  try {
    // Stop server if running
    const state = serverStates[srv.id];
    if (state && state.pid) {
      await killProcess(state.pid, srv.executable);
      state.status = 'stopped'; state.pid = null; state.players = []; state.startedAt = null;
      io.emit('serverStatus', { serverId: srv.id, status: 'stopped' });
    }
    // Wipe install directory (except .backups)
    if (fs.existsSync(resolvedDir)) {
      const entries = fs.readdirSync(resolvedDir);
      for (const entry of entries) {
        if (entry === '.backups') continue;
        const entryPath = path.join(resolvedDir, entry);
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    }
    io.emit('dangerzoneProgress', { serverId: srv.id, status: 'wiping', message: 'Directory wiped. Reinstalling via SteamCMD...' });
    // Reinstall via SteamCMD
    const cmdPath = await ensureSteamCMD();
    const appId = srv.gameTitle === 'DayZ, PC (Experimental)' ? '1024020' : '223350';
    const args = ['+force_install_dir', resolvedDir];
    if (steamCredentials.username && steamCredentials.password) {
      if (steamCredentials.guardCode) args.push('+set_steam_guard_code', steamCredentials.guardCode);
      args.push('+login', steamCredentials.username, steamCredentials.password);
    } else { args.push('+login', 'anonymous'); }
    args.push('+app_update', appId, 'validate', '+quit');
    await new Promise((resolve, reject) => {
      const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
      proc.stdout?.on('data', (data) => {
        for (const line of data.toString().split('\n')) {
          const trimmed = line.trim();
          if (trimmed.match(/(\d+\.?\d*)\s*%/)) {
            const pct = parseFloat(trimmed.match(/(\d+\.?\d*)\s*%/)[1]);
            io.emit('dangerzoneProgress', { serverId: srv.id, status: 'downloading', progress: pct, message: `Downloading... ${pct.toFixed(0)}%` });
          } else if (trimmed.includes('Update state')) {
            io.emit('dangerzoneProgress', { serverId: srv.id, status: 'downloading', message: trimmed });
          }
        }
      });
      proc.stderr?.on('data', () => {});
      const timeout = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('Rebuild timed out')); }, 60 * 60 * 1000);
      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0 || fs.existsSync(path.join(resolvedDir, 'DayZServer_x64.exe'))) resolve();
        else reject(new Error(`SteamCMD exit code: ${code}`));
      });
      proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
    // Create default config
    const cfgPath = path.join(resolvedDir, 'serverDZ.cfg');
    if (!fs.existsSync(cfgPath)) {
      fs.writeFileSync(cfgPath, `hostname = "${srv.name}";\npassword = "";\npasswordAdmin = "";\nmaxPlayers = ${srv.maxPlayers || 60};\nverifySignatures = 2;\nforceSameBuild = 1;\ndisableThirdPerson = 0;\nserverTime = "SystemTime";\nserverTimeAcceleration = 1;\nserverTimePersistent = 0;\nguaranteedUpdates = 1;\nloginQueueConcurrentPlayers = 5;\nloginQueueMaxPlayers = 500;\ninstanceId = 1;\nstorageAutoFix = 1;\nrespawnTime = 5;\ntimeStampFormat = "Short";\ntemplate = "${srv.map || 'chernarusplus'}";\n`);
    }
    io.emit('dangerzoneProgress', { serverId: srv.id, status: 'complete', message: 'Rebuild complete!' });
    addNotification(srv.id, 'server.rebuild', 'Server Rebuilt', `${srv.name} wiped and reinstalled`, 'danger');
    addAudit(req.user.id, req.user.username, 'server.rebuild', `Completed rebuild for ${srv.name}`);
    res.json({ message: 'Rebuild complete!' });
  } catch (err) {
    io.emit('dangerzoneProgress', { serverId: srv.id, status: 'error', message: err.message });
    addAudit(req.user.id, req.user.username, 'server.rebuild', `Rebuild failed for ${srv.name}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Steam Settings ──────────────────────────────────────
app.get('/api/steam/status', auth(), async (req, res) => {
  let steamCmdFound = false;
  try { await ensureSteamCMD(); steamCmdFound = true; } catch {}
  res.json({ steamCmdReady: steamCmdFound, username: steamCredentials.username || '', hasPassword: !!steamCredentials.password, hasGuardCode: !!steamCredentials.guardCode, loginValidated: steamLoginValidated });
});

app.post('/api/steam/credentials', auth('mods.install'), async (req, res) => {
  const { username, password, guardCode } = req.body;
  if (username !== undefined) steamCredentials.username = username;
  if (password !== undefined) steamCredentials.password = password;
  if (guardCode !== undefined) steamCredentials.guardCode = guardCode;
  if (steamCredentials.username && steamCredentials.password) {
    const result = await validateSteamLogin(steamCredentials.username, steamCredentials.password, steamCredentials.guardCode);
    if (result.success) { steamLoginValidated = true; res.json({ success: true, message: `Logged in as ${steamCredentials.username}` }); }
    else if (result.needsGuard) { steamLoginValidated = false; res.json({ success: false, needsGuard: true, message: 'Steam Guard code required.' }); }
    else { steamLoginValidated = false; res.json({ success: false, message: result.error }); }
  } else { steamLoginValidated = false; res.json({ success: false, message: 'Username and password required' }); }
});

// ─── Workshop ────────────────────────────────────────────
app.get('/api/workshop/search', auth(), async (req, res) => {
  const { q, page = 1 } = req.query;
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'Query too short' });
  try {
    const fetch = (await import('node-fetch')).default;
    const url = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?query_type=1&page=${page}&numperpage=20&appid=${DAYZ_APP_ID}&search_text=${encodeURIComponent(q.trim())}&return_short_description=true&return_metadata=true&return_previews=true&strip_description_bbcode=true&filetype=0&match_all_tags=false` + (process.env.STEAM_API_KEY ? `&key=${process.env.STEAM_API_KEY}` : '');
    const response = await fetch(url, { timeout: 10000 });
    const data = await response.json();
    // With API key: publishedfiledetails is populated directly
    if (data.response?.publishedfiledetails && data.response.publishedfiledetails.length > 0) {
      const results = data.response.publishedfiledetails.map(item => ({
        workshopId: item.publishedfileid, name: item.title || 'Unknown',
        description: (item.short_description || '').substring(0, 200),
        preview: item.preview_url || item.previews?.[0]?.url || '',
        subscribers: item.subscriptions || 0, favorites: item.favorited || 0,
        fileSize: item.file_size || 0, updated: item.time_updated ? new Date(item.time_updated * 1000).toISOString() : '',
        tags: (item.tags || []).map(t => t.tag || t.display_name || ''),
      }));
      return res.json({ results, total: data.response.total || results.length, page: parseInt(page) });
    }
    // Without API key: only publishedfileids returned, enrich via GetPublishedFileDetails
    if (data.response?.publishedfileids && data.response.publishedfileids.length > 0) {
      const ids = data.response.publishedfileids.map(f => f.publishedfileid || f);
      const stubItems = ids.map(id => ({ workshopId: String(id), name: '', description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] }));
      const enriched = await enrichWorkshopResults(stubItems);
      return res.json({ results: enriched, total: data.response.total || enriched.length, page: parseInt(page) });
    }
    // Fallback to scraping
    const results = await scrapeWorkshopSearch(q, page);
    res.json({ results, total: results.length, page: parseInt(page) });
  } catch (err) {
    try { const results = await scrapeWorkshopSearch(q, page); res.json({ results, total: results.length, page: parseInt(page) }); }
    catch { res.status(500).json({ error: 'Workshop search failed' }); }
  }
});

app.get('/api/workshop/details/:id', auth(), async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `itemcount=1&publishedfileids[0]=${req.params.id}`, timeout: 10000,
    });
    const data = await response.json();
    const item = data.response?.publishedfiledetails?.[0];
    if (!item || item.result !== 1) return res.status(404).json({ error: 'Not found' });
    res.json({
      workshopId: item.publishedfileid, name: item.title, description: (item.description || '').substring(0, 500),
      preview: item.preview_url || '', subscribers: item.subscriptions || 0, favorites: item.favorited || 0,
      fileSize: item.file_size || 0, updated: item.time_updated ? new Date(item.time_updated * 1000).toISOString() : '',
      tags: (item.tags || []).map(t => t.tag), steamUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedfileid}`,
    });
  } catch { res.status(500).json({ error: 'Failed to fetch details' }); }
});

app.get('/api/workshop/popular', auth(), async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const { page = 1 } = req.query;
    const url = `https://steamcommunity.com/workshop/browse/?appid=${DAYZ_APP_ID}&browsesort=trend&section=readytouseitems&p=${page}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, timeout: 15000 });
    const html = await response.text();
    const results = [];
    let match;
    // Try multiple regex patterns for Steam Workshop HTML
    const patterns = [
      /data-publishedfileid="(\d+)"[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g,
      /SharedFileBindMouseHover[^"]*"(\d+)"[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g,
      /filedetails\/\?id=(\d+)[\s\S]*?workshopItemTitle[^"]*">([^<]+)/g,
    ];
    for (const p of patterns) {
      if (results.length > 0) break;
      while ((match = p.exec(html)) !== null) {
        if (!results.find(r => r.workshopId === match[1])) results.push({ workshopId: match[1], name: match[2].trim(), description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] });
      }
    }
    if (results.length === 0) {
      const idSet = new Set();
      const fp = /filedetails\/\?id=(\d+)/g;
      while ((match = fp.exec(html)) !== null) idSet.add(match[1]);
      for (const id of idSet) results.push({ workshopId: id, name: '', description: '', preview: '', subscribers: 0, favorites: 0, fileSize: 0, updated: '', tags: [] });
    }
    res.json({ results: await enrichWorkshopResults(results), total: results.length, page: parseInt(page) });
  } catch { res.status(500).json({ error: 'Failed to fetch popular mods' }); }
});

// ─── Discord Bot Endpoint ────────────────────────────────
app.post('/api/discord/action', async (req, res) => {
  const { action, apiKey, params } = req.body;
  const expectedKey = process.env.DISCORD_BOT_API_KEY || 'bot-secret-key';
  if (apiKey !== expectedKey) return res.status(403).json({ error: 'Invalid API key' });
  const defaultSrv = servers[0];
  const state = defaultSrv ? serverStates[defaultSrv.id] : null;

  switch (action) {
    case 'status':
      return res.json({ status: state?.status || 'unknown', players: state?.players || [], playerCount: state?.players?.length || 0, maxPlayers: state?.config?.maxPlayers || 60, serverName: defaultSrv?.name || 'DayZ Server' });
    case 'start':
      if (!defaultSrv || !state) return res.status(400).json({ error: 'No server' });
      if (state.status === 'running') return res.json({ message: 'Already running' });
      state.status = 'starting'; io.emit('serverStatus', { serverId: defaultSrv.id, status: 'starting' });
      try { state.process = spawnDayZServer(defaultSrv); state.pid = state.process.pid;
        setTimeout(async () => { const pid = await detectRunningProcess(defaultSrv.executable); if (pid) { state.pid = pid; state.status = 'running'; state.startedAt = new Date().toISOString(); io.emit('serverStatus', { serverId: defaultSrv.id, status: 'running' }); } }, 8000);
      } catch (err) { state.status = 'crashed'; return res.json({ error: err.message }); }
      return res.json({ message: 'Starting...' });
    case 'stop':
      if (!state || state.status !== 'running') return res.json({ message: 'Not running' });
      try { await killProcess(state.pid, defaultSrv.executable); state.status = 'stopped'; state.pid = null; state.players = []; state.startedAt = null; io.emit('serverStatus', { serverId: defaultSrv.id, status: 'stopped' }); }
      catch (err) { return res.json({ error: err.message }); }
      return res.json({ message: 'Stopped' });
    case 'restart':
      if (!state) return res.json({ error: 'No server' });
      try { if (state.pid) await killProcess(state.pid, defaultSrv.executable); state.status = 'starting'; state.pid = null; state.players = []; io.emit('serverStatus', { serverId: defaultSrv.id, status: 'starting' });
        await new Promise(r => setTimeout(r, 3000)); state.process = spawnDayZServer(defaultSrv); state.pid = state.process.pid;
        setTimeout(async () => { const pid = await detectRunningProcess(defaultSrv.executable); if (pid) { state.pid = pid; state.status = 'running'; state.startedAt = new Date().toISOString(); io.emit('serverStatus', { serverId: defaultSrv.id, status: 'running' }); } }, 8000);
      } catch (err) { return res.json({ error: err.message }); }
      return res.json({ message: 'Restarting...' });
    case 'players': return res.json({ players: state?.players || [] });
    default: return res.status(400).json({ error: `Unknown action: ${action}` });
  }
});

// ═══ BACKWARD COMPATIBILITY ══════════════════════════════
app.get('/api/server/status', auth(), (req, res) => {
  const srv = servers[0]; const state = srv ? serverStates[srv.id] : null;
  res.json({ status: state?.status || 'stopped', players: state?.players || [], playerCount: state?.players?.length || 0, maxPlayers: state?.config?.maxPlayers || 60, serverName: state?.config?.hostname || 'DayZ Server', uptime: state?.startedAt ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000) : 0 });
});
app.get('/api/mods', auth(), (req, res) => { res.json(serverStates[servers[0]?.id]?.modList || []); });
app.get('/api/metrics', auth(), (req, res) => { res.json(serverStates[servers[0]?.id]?.metricsHistory || { cpu: [], ram: [], players: [], fps: [], timestamps: [] }); });
app.get('/api/config', auth(), (req, res) => { const srv = servers[0]; if (!srv) return res.json({}); const st = serverStates[srv.id]; if (st) st.config = readServerConfig(srv.installDir); res.json(st?.config || {}); });
app.patch('/api/config', auth('server.config'), (req, res) => { const srv = servers[0]; if (!srv) return res.status(400).json({ error: 'No server' }); if (writeServerConfig(srv.installDir, req.body)) { if (serverStates[srv.id]) serverStates[srv.id].config = readServerConfig(srv.installDir); res.json(serverStates[srv.id]?.config || {}); } else res.status(500).json({ error: 'Failed' }); });
app.get('/api/logs', auth(), (req, res) => { const { level, source, limit = 200 } = req.query; let logs = serverStates[servers[0]?.id]?.logs || []; if (level) logs = logs.filter(l => l.level === level); if (source) logs = logs.filter(l => l.source === source); res.json(logs.slice(0, parseInt(limit))); });
app.get('/api/players', auth(), (req, res) => { res.json(serverStates[servers[0]?.id]?.players || []); });
app.get('/api/bans', auth(), (req, res) => { res.json(serverStates[servers[0]?.id]?.banList || []); });
app.get('/api/schedule', auth(), (req, res) => { res.json(serverStates[servers[0]?.id]?.scheduledRestarts || []); });
app.get('/api/files', auth('files.browse'), (req, res) => {
  const srv = servers[0]; if (!srv) return res.status(400).json({ error: 'No server' }); const { dir } = req.query; const bp = srv.installDir;
  const td = dir ? path.resolve(bp, dir) : bp; if (!td.startsWith(bp)) return res.status(403).json({ error: 'Access denied' });
  try { const entries = fs.readdirSync(td, { withFileTypes: true }); const results = entries.map(e => { const fp = path.join(td, e.name); let size = 0, modified = 0; try { const s = fs.statSync(fp); size = s.size; modified = s.mtimeMs; } catch {} return { name: e.name, type: e.isDirectory() ? 'directory' : 'file', path: path.relative(bp, fp).replace(/\\/g, '/'), size, modified }; }); results.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); res.json(results); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/files/read', auth('files.edit'), (req, res) => {
  const srv = servers[0]; if (!srv) return res.status(400).json({ error: 'No server' }); const { file } = req.query; const fp = path.resolve(srv.installDir, file);
  if (!fp.startsWith(srv.installDir)) return res.status(403).json({ error: 'Access denied' });
  try { const stat = fs.statSync(fp); if (stat.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large' }); const binaryExts = ['.exe','.dll','.pdb','.pbo','.pak','.bin','.so','.png','.jpg','.jpeg','.gif','.bmp','.ico','.wav','.ogg','.mp3','.zip','.rar','.7z','.bikey','.bisign']; if (binaryExts.includes(path.extname(fp).toLowerCase())) return res.status(400).json({ error: 'Binary file' }); res.json({ content: fs.readFileSync(fp, 'utf8'), path: file, size: stat.size, modified: stat.mtimeMs }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/files/write', auth('files.edit'), (req, res) => {
  const srv = servers[0]; if (!srv) return res.status(400).json({ error: 'No server' }); const { file, content } = req.body; const fp = path.resolve(srv.installDir, file);
  if (!fp.startsWith(srv.installDir)) return res.status(403).json({ error: 'Access denied' });
  try { const bd = path.join(srv.installDir, '.backups'); if (!fs.existsSync(bd)) fs.mkdirSync(bd, { recursive: true }); if (fs.existsSync(fp)) fs.copyFileSync(fp, path.join(bd, `${path.basename(file)}.${Date.now()}.bak`)); fs.writeFileSync(fp, content); res.json({ message: 'Saved' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── WebSocket ───────────────────────────────────────────
io.on('connection', (socket) => {
  for (const srv of servers) {
    const state = serverStates[srv.id];
    if (state) {
      socket.emit('serverStatus', { serverId: srv.id, status: state.status });
      socket.emit('players', { serverId: srv.id, players: state.players });
    }
  }
  socket.on('disconnect', () => {});
});

// ─── Metrics & Status Polling ─────────────────────────────
setInterval(async () => {
  for (const srv of servers) {
    const state = serverStates[srv.id];
    if (!state || (state.status !== 'running' && state.status !== 'starting')) continue;
    const pid = await detectRunningProcess(srv.executable);
    if (pid) {
      state.pid = pid;
      if (state.status !== 'running') { state.status = 'running'; state.startedAt = state.startedAt || new Date().toISOString(); io.emit('serverStatus', { serverId: srv.id, status: 'running' }); }
      const metrics = await getProcessMetrics(pid, srv.executable);
      // Get FPS: prefer RPT log scraping (logAverageFps in serverDZ.cfg), fall back to RCON
      let fps = scrapeRPTForFPS(srv);
      if (!fps && state.rcon) {
        try {
          if (!state.rcon.monitorEnabled && state.rcon.loggedIn) await state.rcon.enableMonitor();
          fps = state.rcon.getFPS() || 0;
        } catch(e) { /* RCON not available */ }
      }
      if (metrics) pushMetrics(srv.id, metrics.cpu, metrics.ram, state.players.length, fps);
      // Health monitoring checks (5-minute cooldown between alerts)
      if (srv.healthMonitoring && metrics) {
        const minFPS = srv.healthMinFPS || 5;
        const maxRAM = srv.healthMaxRAM || 90;
        const action = srv.healthAction || 'log';
        let triggered = false;
        let reason = '';
        if (fps > 0 && fps < minFPS) { triggered = true; reason = `FPS (${fps.toFixed(1)}) below threshold (${minFPS})`; }
        if (metrics.ram > maxRAM) { triggered = true; reason += (reason ? ' & ' : '') + `RAM (${metrics.ram.toFixed(1)}%) above threshold (${maxRAM}%)`; }
        const now = Date.now();
        const cooldown = 5 * 60 * 1000; // 5 minutes
        if (triggered && (!state.lastHealthAlert || now - state.lastHealthAlert > cooldown)) {
          state.lastHealthAlert = now;
          addLog(srv.id, 'warn', 'health', 'Health alert: ' + reason);
          addNotification(srv.id, 'server.health', 'Health Alert', `${srv.name}: ${reason}`, 'warning');
          if (action === 'webhook') {
            fireWebhooks('server.health', { serverId: srv.id, serverName: srv.name, reason });
            sendDiscordWebhook(`⚠️ **${srv.name}** health alert: ${reason}`);
          } else if (action === 'restart') {
            addLog(srv.id, 'warn', 'health', 'Auto-restarting due to health threshold');
            try { await killProcess(state.pid, srv.executable); } catch {}
            state.pid = null; state.process = null; state.players = [];
            state.status = 'starting'; io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
            await new Promise(r => setTimeout(r, 3000));
            state.process = spawnDayZServer(srv); state.pid = state.process.pid;
            setTimeout(async () => {
              const newPid = await detectRunningProcess(srv.executable);
              if (newPid) { state.pid = newPid; state.status = 'running'; state.startedAt = new Date().toISOString(); io.emit('serverStatus', { serverId: srv.id, status: 'running' }); }
            }, srv.startGracePeriod ? srv.startGracePeriod * 1000 : 8000);
          }
        }
      }
    } else if (state.status === 'running') {
      addLog(srv.id, 'error', 'server', 'Process no longer running');
      state.status = 'crashed'; state.players = []; state.pid = null; state.process = null;
      io.emit('serverStatus', { serverId: srv.id, status: 'crashed' });
      io.emit('players', { serverId: srv.id, players: [] });
      addNotification(srv.id, 'server.crashed', 'Server Crashed', `${srv.name} is no longer running`, 'error');
      fireWebhooks('server.crashed', { serverId: srv.id, serverName: srv.name });
      sendDiscordWebhook(`💥 **${srv.name}** crashed`);
    }
  }
}, 15000);

// ─── Startup ─────────────────────────────────────────────
(async () => {
  for (const srv of servers) {
    const state = serverStates[srv.id];
    if (state) {
      if (!state.logs) state.logs = [];
      addLog(srv.id, 'info', 'server', `Server state initialized for ${srv.name}`);
    }
    const pid = await detectRunningProcess(srv.executable);
    if (pid) {
      state.pid = pid; state.status = 'running'; state.startedAt = new Date().toISOString();
      io.emit('serverStatus', { serverId: srv.id, status: 'running' });
      addLog(srv.id, 'info', 'server', `Detected running process for ${srv.name} (PID: ${pid})`);
      applyProcessSettings(pid, srv);
    }
  }
  // Auto-start servers that have autoStart enabled and aren't already running
  for (const srv of servers) {
    const state = serverStates[srv.id];
    if (srv.autoStart && state?.status !== 'running') {
      console.log(`[AutoStart] Starting ${srv.name}...`);
      try {
        state.status = 'starting'; io.emit('serverStatus', { serverId: srv.id, status: 'starting' });
        state.process = spawnDayZServer(srv); state.pid = state.process.pid;
        addLog(srv.id, 'info', 'server', 'Auto-start initiated');
        setTimeout(async () => {
          const detectedPid = await detectRunningProcess(srv.executable);
          if (detectedPid) {
            state.pid = detectedPid; state.status = 'running'; state.startedAt = new Date().toISOString();
            io.emit('serverStatus', { serverId: srv.id, status: 'running' });
            addLog(srv.id, 'info', 'server', 'Auto-start: server is now running');
          }
        }, srv.startGracePeriod ? srv.startGracePeriod * 1000 : 8000);
      } catch (err) {
        console.error(`[AutoStart] Failed to start ${srv.name}:`, err.message);
        addLog(srv.id, 'error', 'server', 'Auto-start failed: ' + err.message);
      }
    }
  }
})();

servers.forEach(s => autoDetectMods(s.id));
setInterval(() => servers.forEach(s => autoDetectMods(s.id)), 5 * 60 * 1000);

setTimeout(() => {
  for (const srv of servers) {
    const state = serverStates[srv.id];
    if (state?.rcon && srv.rconPassword) state.rcon.connect().catch(() => {});
  }
}, 5000);

// ─── Start ───────────────────────────────────────────────
server.listen(CONFIG.port, () => {
  console.log(`🎮 DayZ Panel API v2.0 running on http://localhost:${CONFIG.port}`);
  console.log(`   ${servers.length} server(s) configured, ${users.length} user(s)`);
});

module.exports = { app, io, servers, CONFIG };
