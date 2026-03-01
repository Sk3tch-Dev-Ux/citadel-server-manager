/**
 * Citadel — Backend API v2.0
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
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const https = require('https');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { Server: SocketIO } = require('socket.io');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ─── Core modules ────────────────────────────────────────
const logger = require('./lib/logger');
const CONFIG = require('./lib/config');
const ctx = require('./lib/context');
const { loadJSON } = require('./lib/data-store');

// ─── Wire CONFIG into context ────────────────────────────
ctx.CONFIG = CONFIG;

// ─── Load persistent data ────────────────────────────────
ctx.servers = loadJSON(CONFIG.dataDir, 'servers.json', []);
ctx.users = loadJSON(CONFIG.dataDir, 'users.json', []);
ctx.roles = loadJSON(CONFIG.dataDir, 'roles.json', [
  { id: 'admin', name: 'Admin', permissions: ['*'], color: '#ff3b3b', builtIn: true },
  { id: 'moderator', name: 'Moderator', permissions: ['server.view','server.start','server.stop','server.restart','players.view','players.kick','mods.view','logs.view','metrics.view','chat.send'], color: '#3b82f6', builtIn: true },
  { id: 'viewer', name: 'Viewer', permissions: ['server.view','players.view','mods.view','logs.view','metrics.view'], color: '#00ff6a', builtIn: true },
]);
ctx.webhooks = loadJSON(CONFIG.dataDir, 'webhooks.json', []);
ctx.auditLog = loadJSON(CONFIG.dataDir, 'audit.json', []);
ctx.watchList = loadJSON(CONFIG.dataDir, 'watchlist.json', []);
ctx.priorityQueue = loadJSON(CONFIG.dataDir, 'priority_queue.json', []);
ctx.leaderboard = loadJSON(CONFIG.dataDir, 'leaderboard.json', []);

// ─── Runtime state from env ──────────────────────────────
ctx.steamCmdPath = CONFIG.steam.cmdPath;
ctx.steamCredentials = {
  username: CONFIG.steam.username || '',
  password: CONFIG.steam.password || '',
  guardCode: '',
};

// ─── Express + HTTP(S) ───────────────────────────────────
const app = express();
let server, useHttps = false;
try {
  const certPath = path.join(__dirname, '..', 'cert');
  server = https.createServer({
    key: fs.readFileSync(path.join(certPath, 'key.pem')),
    cert: fs.readFileSync(path.join(certPath, 'cert.pem')),
  }, app);
  useHttps = true;
} catch (err) {
  logger.warn('TLS certificates not found or invalid — running over HTTP (unencrypted)');
  if (err.code !== 'ENOENT') logger.debug({ err }, 'TLS init error details');
  server = http.createServer(app);
}

const io = new SocketIO(server, { cors: { origin: CONFIG.allowedOrigins, credentials: true } });
ctx.io = io;

// ─── Middleware ───────────────────────────────────────────
const { createCors, secureCookies } = require('./middleware/security');
const { apiLimiter, authLimiter, discordLimiter } = require('./middleware/rate-limit');

// Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],  // Vite needs inline during dev
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,  // Allow image loading
}));
app.use(createCors(CONFIG.allowedOrigins));
app.use(express.json({ limit: '10mb' }));
app.use(secureCookies(useHttps));
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/discord/', discordLimiter);

// Health check endpoint (for load balancers / orchestrators)
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));
app.get('/readyz', (req, res) => {
  const ready = ctx.servers.length > 0 || ctx.users.length > 0;
  res.status(ready ? 200 : 503).json({ ready });
});

app.use(express.static(path.join(__dirname, '../web/dist')));

// ─── Routes ──────────────────────────────────────────────
require('./routes/setup.routes')(app);
require('./routes/auth.routes')(app);
require('./routes/servers.routes')(app);
require('./routes/server-control.routes')(app);
require('./routes/rcon-players.routes')(app);
require('./routes/logs-metrics.routes')(app);
require('./routes/config.routes')(app);
require('./routes/mods.routes')(app);
require('./routes/files.routes')(app);
require('./routes/schedule.routes')(app);
require('./routes/messenger.routes')(app);
require('./routes/users.routes')(app);
require('./routes/roles.routes')(app);
require('./routes/audit.routes')(app);
require('./routes/webhooks.routes')(app);
require('./routes/notifications.routes')(app);
require('./routes/deploy.routes')(app);
require('./routes/steam.routes')(app);
require('./routes/workshop.routes')(app);
require('./routes/discord.routes')(app);
require('./routes/backup.routes')(app);
require('./routes/dangerzone.routes')(app);
require('./routes/watchlist.routes')(app);
require('./routes/priority-queue.routes')(app);
require('./routes/killfeed.routes')(app);
require('./routes/leaderboard.routes')(app);
require('./routes/actions.routes')(app);
require('./routes/map.routes')(app);
require('./routes/compat.routes')(app);

// ─── WebSocket (authenticated) ───────────────────────────
const { getMapData: getMapDataForSocket } = require('./lib/map-data');

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, CONFIG.jwtSecret);
    const user = ctx.users.find(u => u.id === decoded.id);
    if (!user) return next(new Error('User not found'));
    socket.user = decoded;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

io.on('connection', (socket) => {
  logger.debug({ userId: socket.user?.id }, 'WebSocket client connected');
  for (const srv of ctx.servers) {
    const state = ctx.serverStates[srv.id];
    if (state) {
      socket.emit('serverStatus', { serverId: srv.id, status: state.status });
      socket.emit('players', { serverId: srv.id, players: state.players });
      // Send initial map data for live map
      const mapData = getMapDataForSocket(srv.id);
      if (mapData) socket.emit('mapData', { serverId: srv.id, ...mapData });
    }
  }
  socket.on('disconnect', () => {
    logger.debug({ userId: socket.user?.id }, 'WebSocket client disconnected');
  });
});

// ─── SPA Fallback ────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/dist/index.html'));
});

// ─── Error handler (must be after all routes) ────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  logger.error({ err, method: req.method, url: req.url }, 'Unhandled server error');
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ─────────────────────────────────────────────
const { startup } = require('./lib/server-init');
const { startAllPolling, gracefulShutdown } = require('./lib/polling');

(async () => {
  await startup();

  // Start all polling loops (metrics, mod detection, leaderboard, steam updates, RCON)
  await startAllPolling();

  // Listen
  server.listen(CONFIG.port, () => {
    logger.info(`Citadel API v2.0 running on ${useHttps ? 'https' : 'http'}://localhost:${CONFIG.port}`);
    logger.info(`${ctx.servers.length} server(s) configured, ${ctx.users.length} user(s)`);
  });
})();

// ─── Graceful Shutdown ───────────────────────────────────
process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));

module.exports = { app, io, servers: ctx.servers, CONFIG };
