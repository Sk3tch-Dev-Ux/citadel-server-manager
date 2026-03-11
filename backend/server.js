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
const { activateLicense } = require('./lib/license');

// ─── Service mode detection ─────────────────────────────
const isServiceMode = process.env.CITADEL_SERVICE_MODE === '1';
if (isServiceMode) {
  logger.info('Running in Windows Service mode (CITADEL_SERVICE_MODE=1)');
}
ctx.isServiceMode = isServiceMode;

// ─── Wire CONFIG into context ────────────────────────────
ctx.CONFIG = CONFIG;

// ─── Load persistent data ────────────────────────────────
ctx.servers = loadJSON(CONFIG.dataDir, 'servers.json', []);
ctx.users = loadJSON(CONFIG.dataDir, 'users.json', []);
ctx.roles = loadJSON(CONFIG.dataDir, 'roles.json', [
  { id: 'admin', name: 'Admin', permissions: ['*'], color: '#ff3b3b', builtIn: true },
  { id: 'moderator', name: 'Moderator', permissions: ['server.view','server.start','server.stop','server.restart','players.view','players.kick','bans.manage','priority.manage','mods.view','logs.view','metrics.view','chat.send'], color: '#3b82f6', builtIn: true },
  { id: 'viewer', name: 'Viewer', permissions: ['server.view','players.view','mods.view','logs.view','metrics.view'], color: '#00ff6a', builtIn: true },
]);
ctx.webhooks = loadJSON(CONFIG.dataDir, 'webhooks.json', []);
ctx.auditLog = loadJSON(CONFIG.dataDir, 'audit.json', []);
ctx.watchList = loadJSON(CONFIG.dataDir, 'watchlist.json', []);
ctx.priorityQueue = loadJSON(CONFIG.dataDir, 'priority_queue.json', []);
ctx.banDatabase = loadJSON(CONFIG.dataDir, 'bans.json', []);
ctx.leaderboard = loadJSON(CONFIG.dataDir, 'leaderboard.json', []);
ctx.storeProducts = loadJSON(CONFIG.dataDir, 'store_products.json', []);
ctx.storePurchases = loadJSON(CONFIG.dataDir, 'store_purchases.json', []);

// Load notifications from disk (persisted across restarts)
const { loadNotifications } = require('./lib/notifications');
loadNotifications();

// ─── Runtime state from env ──────────────────────────────
const { resolveCredential } = require('./lib/credential-encryption');

ctx.steamCmdPath = CONFIG.steam.cmdPath;
ctx.steamCredentials = {
  username: CONFIG.steam.username || '',
  password: resolveCredential(CONFIG.steam.password || ''),
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
const { csrfProtection, verifyCsrfToken } = require('./middleware/csrf');
const cookieParser = require('cookie-parser');

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
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    // Preserve raw body for Stripe webhook signature verification
    if (req.originalUrl === '/api/store/webhook') req.rawBody = buf;
  },
}));
app.use(secureCookies(useHttps));
app.use(cookieParser()); // Parse cookies for CSRF middleware

// CSRF Protection (double-submit cookie pattern for SPA)
app.use(csrfProtection);                           // Generate + set CSRF token
app.use('/api/', verifyCsrfToken);                 // Verify for state-changing requests

// Rate limiting
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/discord/', discordLimiter);

// Health check endpoints (for load balancers / orchestrators / uptime monitors)
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));
app.get('/readyz', (req, res) => {
  const ready = ctx.servers.length > 0 || ctx.users.length > 0;
  res.status(ready ? 200 : 503).json({ ready });
});
require('./routes/health.routes')(app); // Comprehensive /api/health — no auth required

app.use(express.static(path.join(__dirname, '../web/dist')));

// ─── License Activation ──────────────────────────────────
const license = activateLicense(CONFIG.dataDir);
ctx.license = license;

// ─── Routes ──────────────────────────────────────────────
require('./routes/setup.routes')(app);
require('./routes/auth.routes')(app);
require('./routes/license.routes')(app);
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
require('./routes/bans.routes')(app);
require('./routes/actions.routes')(app);
require('./routes/items.routes')(app);
require('./routes/types-editor.routes')(app);
require('./routes/map.routes')(app);
require('./routes/compat.routes')(app);
require('./routes/store.routes')(app);
require('./routes/lb-perks.routes')(app);
require('./routes/system.routes')(app);
require('./routes/cloud.routes')(app);

// ─── License status ──────────────────────────────────────
const { isLicensed } = require('./lib/license');
if (!isLicensed()) logger.info('Running unlicensed — purchase at citadel.gg for $34.99 to unlock all features');

// ─── WebSocket (authenticated) ───────────────────────────
const { getMapData: getMapDataForSocket } = require('./lib/map-data');

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, CONFIG.jwtSecret);
    const user = ctx.users.find(u => u.id === decoded.id);
    if (!user) return next(new Error('User not found'));
    // SECURITY: Always fetch fresh role from database, not stale JWT claim
    // This prevents permission escalation via cached JWT tokens
    socket.user = {
      ...decoded,
      role: user.role,
      mustChangePassword: !!user.mustChangePassword
    };
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

io.on('connection', (socket) => {
  logger.debug({ userId: socket.user?.id }, 'WebSocket client connected');

  // Fire session.begin webhook
  fireWebhooks('session.begin', {
    serverName: 'Citadel Agent',
    serverId: 'agent',
    playerId: socket.user?.id,
    playerName: socket.user?.username || 'Unknown',
    reason: 'User connected to dashboard',
  }).catch(err => logger.error({ err }, 'Failed to fire session.begin webhook'));

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

    // Fire session.ended webhook
    fireWebhooks('session.ended', {
      serverName: 'Citadel Agent',
      serverId: 'agent',
      playerId: socket.user?.id,
      playerName: socket.user?.username || 'Unknown',
      reason: 'User disconnected from dashboard',
    }).catch(err => logger.error({ err }, 'Failed to fire session.ended webhook'));
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
const { fireWebhooks } = require('./lib/notifications');

// Only start the server if not in test mode
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    await startup();

    // Start all polling loops (metrics, mod detection, leaderboard, steam updates, RCON)
    await startAllPolling();

    // Start Cloud Agent (connects to Citadel Cloud if enabled)
    try {
      const cloudAgent = require('./lib/cloud-agent');
      ctx.cloudAgent = cloudAgent;
      if (cloudAgent.isEnabled()) {
        cloudAgent.startCloudAgent();
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Cloud Agent failed to initialize');
    }

    // Priority queue expiration cleanup (every 60s — lightweight array filter)
    setInterval(() => {
      try { require('./lib/priority-engine').cleanExpired(); } catch {}
    }, 60_000);

    // Listen
    server.listen(CONFIG.port, () => {
      logger.info(`Citadel v2.0 (All-In-One) running on ${useHttps ? 'https' : 'http'}://localhost:${CONFIG.port}`);
      logger.info(`${ctx.servers.length} server(s) configured, ${ctx.users.length} user(s)`);

      // Fire agent.ready webhook on successful startup
      fireWebhooks('agent.ready', {
        serverName: 'Citadel Agent',
        serverId: 'agent',
        reason: `Agent started on port ${CONFIG.port}`,
      }).catch(err => logger.error({ err }, 'Failed to fire agent.ready webhook'));
    });
  })().catch(err => {
    // eslint-disable-next-line no-console
    console.error('FATAL: Startup failed —', err.message || err);
    try { require('./lib/logger').fatal({ err }, 'Startup failed'); } catch {}
    process.exit(1);
  });
}

// ─── Graceful Shutdown ───────────────────────────────────
process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));

// ─── Uncaught Error Handlers ─────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  try { require('./lib/logger').error({ err: reason }, 'Unhandled promise rejection'); } catch {}
});
process.on('uncaughtException', (err) => {
  try { require('./lib/logger').fatal({ err }, 'Uncaught exception — shutting down'); } catch {}
  process.exit(1);
});

module.exports = { app, io, servers: ctx.servers, CONFIG };
