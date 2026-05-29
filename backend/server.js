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
const { ROOT: _root, WEB_DIST, ENV_FILE } = require('./lib/paths');
require('dotenv').config({ path: ENV_FILE });

// ─── Core modules ────────────────────────────────────────
const logger = require('./lib/logger');
const CONFIG = require('./lib/config');
const ctx = require('./lib/context');
const { loadJSON } = require('./lib/data-store');

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
  { id: 'moderator', name: 'Moderator', permissions: ['server.view','server.start','server.stop','server.restart','players.view','players.kick','priority.manage','mods.view','logs.view','metrics.view','chat.send','messenger.manage'], color: '#3b82f6', builtIn: true },
  { id: 'viewer', name: 'Viewer', permissions: ['server.view','players.view','mods.view','logs.view','metrics.view'], color: '#00ff6a', builtIn: true },
  // Audit H6 Layer 1. The Discord bot's API key used to grant unrestricted
  // access to every action in /api/discord/action — anyone with the key
  // could /restart, /rcon, /ban, etc. without a role check. We now gate
  // each action against this synthetic role's permissions.
  //
  // Default permissions are '*' so existing deployments are unchanged on
  // upgrade. Operators can narrow the role's permissions in the role
  // editor (Settings → Users & Roles) without a code change. For example:
  //
  //   permissions: ['server.view','server.restart','players.view','players.kick','chat.send']
  //
  // …would let the Discord bot show status, run a restart, kick a player,
  // and broadcast to chat — but block /rcon, /ban, world wipes, etc.
  { id: 'discord-bot', name: 'Discord Bot', permissions: ['*'], color: '#5865F2', builtIn: true, description: 'Permissions granted to /api/discord/action calls. Narrow this role to limit what the bot can do.' },
]);
// Back-fill the discord-bot role for installs that pre-date this change.
// The role being missing means the gate would always fail closed and the
// bot would stop working entirely — match the safe behavior (initial '*')
// so an upgrade is non-breaking.
if (!ctx.roles.find(r => r.id === 'discord-bot')) {
  ctx.roles.push({
    id: 'discord-bot',
    name: 'Discord Bot',
    permissions: ['*'],
    color: '#5865F2',
    builtIn: true,
    description: 'Permissions granted to /api/discord/action calls. Narrow this role to limit what the bot can do.',
  });
  // Persist so the new role shows up in the role editor immediately.
  try {
    require('./lib/data-store').saveJSON(CONFIG.dataDir, 'roles.json', ctx.roles);
    logger.info('Back-filled built-in "discord-bot" role into roles.json');
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to persist back-filled discord-bot role');
  }
}
ctx.webhooks = loadJSON(CONFIG.dataDir, 'webhooks.json', []);
ctx.auditLog = loadJSON(CONFIG.dataDir, 'audit.json', []);
ctx.watchList = loadJSON(CONFIG.dataDir, 'watchlist.json', []);
ctx.priorityQueue = loadJSON(CONFIG.dataDir, 'priority_queue.json', []);
ctx.banDatabase = loadJSON(CONFIG.dataDir, 'bans.json', []);
// Audit H6 Layer 3 — per-Discord-user → Citadel role mapping. When the
// bot's HMAC-signed call comes in (Layer 2 verified the identity), this
// map decides which role's permissions apply. Unmapped users fall back
// to the built-in 'discord-bot' role (Layer 1's default). Shape:
//   { '<discordUserId>': '<citadel-role-id>', ... }
ctx.discordUserRoles = loadJSON(CONFIG.dataDir, 'discord-user-roles.json', {});

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
  const certPath = path.join(_root, 'cert');
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
      // 'unsafe-inline' for scripts removed (React/Vite builds don't need it).
      // Styles keep 'unsafe-inline' for CSS-in-JS + Vite's injected styles.
      // cdnjs is allowed for socket.io and Font Awesome (Monaco is now bundled locally).
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      // Map tiles are now proxied through /api/maps/tiles/* — browser never
      // talks to xam.nu directly, so it doesn't need to be allowlisted here.
      // unpkg stays for Leaflet's default marker assets.
      imgSrc: ["'self'", 'data:', 'blob:', 'https://unpkg.com'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      // Monaco's workers are bundled as blob: URLs by Vite — still need this.
      workerSrc: ["'self'", 'blob:'],
      childSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,  // Allow image loading
}));
app.use(createCors(CONFIG.allowedOrigins));
app.use(express.json({ limit: '10mb' }));
app.use(secureCookies(useHttps));

// cookieParser MUST run before csrfProtection — csrfProtection reads
// req.cookies['csrf-token'] and the matching nonce. Without parsing first,
// req.cookies is undefined and the optional-chaining inside csrf.js silently
// papers over a missing cookie on the first request of every session.
app.use(cookieParser());

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
require('./routes/maps.routes')(app);   // /api/maps/tiles/* tile proxy — no auth required

app.use(express.static(WEB_DIST));

// ─── Routes ──────────────────────────────────────────────
require('./routes/setup.routes')(app);
require('./routes/citadel-license.routes')(app);
require('./routes/cloud-bridge.routes')(app);
require('./routes/cloud-bans.routes')(app);
require('./routes/cftools-import.routes')(app);
require('./routes/auth.routes')(app);
require('./routes/servers.routes')(app);
require('./routes/server-control.routes')(app);
require('./routes/rcon-players.routes')(app);
require('./routes/logs-metrics.routes')(app);
require('./routes/config.routes')(app);
require('./routes/mods.routes')(app);
require('./routes/files.routes')(app);
require('./routes/users.routes')(app);
require('./routes/roles.routes')(app);
require('./routes/audit.routes')(app);
// Webhook config UI + CRUD moved to Citadel Cloud (citadels.cc/cloud).
// fireWebhooks() in lib/notifications.js is now an internal-only event
// emitter — the outbound HTTP delivery layer was removed when the
// management surface went away. See lib/notifications.js for the stub.
require('./routes/notifications.routes')(app);
require('./routes/deploy.routes')(app);
require('./routes/steam.routes')(app);
require('./routes/workshop.routes')(app);
require('./routes/discord.routes')(app);
require('./routes/discord-user-roles.routes')(app);
require('./routes/backup.routes')(app);
require('./routes/dangerzone.routes')(app);
require('./routes/pvp.routes')(app);
require('./routes/player-profiles.routes')(app);
require('./routes/priority-queue.routes')(app);
require('./routes/actions.routes')(app);
require('./routes/items.routes')(app);
require('./routes/types-editor.routes')(app);
require('./routes/events-editor.routes')(app);
require('./routes/globals-editor.routes')(app);
require('./routes/spawnabletypes-editor.routes')(app);
require('./routes/spawnpoints-editor.routes')(app);
require('./routes/limits-editor.routes')(app);
require('./routes/economycore-editor.routes')(app);
require('./routes/mod-config.routes')(app);
require('./routes/expansion-docs.routes')(app);
require('./routes/expansion-quests.routes')(app);
require('./routes/expansion-trader.routes')(app);
require('./routes/expansion-loadouts.routes')(app);
require('./routes/compat.routes')(app);
require('./routes/lb-perks.routes')(app);
// Restart scheduling moved to Citadel Cloud (citadels.cc/cloud). The Agent
// still exposes /api/server-control/restart for Cloud to call when a
// schedule fires; nothing in the Agent owns the schedule any more.
require('./routes/system.routes')(app);
require('./routes/updates.routes')(app);

// Start the host-metrics sampler so history is available as soon as the
// System Dashboard opens, and so threshold alerts fire regardless of
// whether anyone is viewing the dashboard.
try {
  require('./lib/system-metrics-sampler').start();
} catch (err) {
  require('./lib/logger').warn({ err: err.message }, 'system-metrics: failed to start sampler');
}
require('./routes/citadel-bridge.routes')(app);

// ─── OpenAPI spec (auto-generated from the live route table) ───
// Registered AFTER all routes so the introspected table is complete.
// Auth-gated (any authenticated user) — exposes the API surface, so not public.
try {
  const auth = require('./middleware/auth');
  const { extractRoutes, generateOpenApi } = require('./lib/openapi');
  const pkg = require('./package.json');

  app.get('/api/openapi.json', auth(), (_req, res) => {
    res.json(generateOpenApi(extractRoutes(app), {
      title: 'Citadel Agent API',
      version: pkg.version,
    }));
  });

  // Minimal Swagger UI page (loaded from CDN — no bundled dependency).
  app.get('/api/docs', auth(), (_req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Citadel Agent API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>window.onload=()=>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#swagger-ui'});</script>
</body></html>`);
  });
} catch (err) {
  require('./lib/logger').warn({ err: err.message }, 'Failed to register OpenAPI routes');
}

// ─── WebSocket (authenticated) ───────────────────────────
//
// Audit M11 — token comes from either:
//   - the auth-token cookie (preferred — set by /api/auth/login on the
//     same origin, sent automatically by browsers on the WS handshake), or
//   - socket.handshake.auth.token (compat for the desktop app and any
//     legacy clients that explicitly opt into Bearer-style auth).
//
// Cookie parsing on the handshake is one-shot: socket.io exposes the
// raw cookie header via socket.handshake.headers.cookie. We do a tiny
// parse here rather than pulling in the cookie module because the
// expected shape is just "name1=val1; name2=val2".
function extractTokenFromHandshake(handshake) {
  // 1. Prefer the cookie set by /api/auth/login.
  const rawCookies = handshake?.headers?.cookie;
  if (typeof rawCookies === 'string' && rawCookies.length > 0) {
    for (const part of rawCookies.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const name = part.slice(0, eq).trim();
      if (name === 'auth-token') {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
  }
  // 2. Fall back to handshake.auth.token (desktop / legacy).
  const authToken = handshake?.auth?.token;
  if (typeof authToken === 'string' && authToken.length > 0) return authToken;
  return null;
}

io.use((socket, next) => {
  const token = extractTokenFromHandshake(socket.handshake);
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

// ─── WebSocket Rate Limiting ─────────────────────────────
// Per-USER rate limit (not per-socket) so opening multiple tabs or reconnecting
// can't reset the counter. Bucket is keyed by authenticated user ID; if the
// socket has no user (shouldn't happen after auth middleware) we fall back to
// the raw socket id so anonymous abuse still gets throttled.
const WS_RATE_WINDOW_MS = 10_000;
const WS_RATE_MAX_MESSAGES = 120; // bumped from 60 — legit use w/ many tabs could exceed

/** @type {Map<string, { count: number, windowStart: number }>} */
const _wsRateBuckets = new Map();

// Sweep stale buckets every minute so the map doesn't grow unbounded
setInterval(() => {
  const cutoff = Date.now() - WS_RATE_WINDOW_MS * 6;
  for (const [key, bucket] of _wsRateBuckets) {
    if (bucket.windowStart < cutoff) _wsRateBuckets.delete(key);
  }
}, 60_000).unref();

io.on('connection', (socket) => {
  const rateKey = `u:${socket.user?.id || `s:${socket.id}`}`;

  const _originalOnEvent = socket.onevent;
  socket.onevent = function(packet) {
    const now = Date.now();
    let bucket = _wsRateBuckets.get(rateKey);
    if (!bucket || now - bucket.windowStart > WS_RATE_WINDOW_MS) {
      bucket = { count: 0, windowStart: now };
      _wsRateBuckets.set(rateKey, bucket);
    }
    bucket.count++;
    if (bucket.count > WS_RATE_MAX_MESSAGES) {
      logger.warn({ userId: socket.user?.id, rateKey, count: bucket.count }, 'WebSocket rate limit exceeded');
      socket.emit('error', { message: 'Rate limit exceeded' });
      return; // Drop the message
    }
    _originalOnEvent.call(socket, packet);
  };

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

// ─── Citadel Bridge WebSocket ─────────────────────────────
const { initCitadelSocket } = require('./lib/citadel-socket');
initCitadelSocket(io);

// ─── 404 for unknown API paths ───────────────────────────
// Audit L31. Without this, the SPA catch-all below returns index.html for
// every misnamed /api/* request — JSON clients (the bot, the desktop
// wrapper) try to JSON.parse HTML and surface a confusing error. Keep this
// above the SPA fallback so it wins for anything under /api.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found', path: req.originalUrl });
});

// ─── SPA Fallback ────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(WEB_DIST, 'index.html'));
});

// ─── Error handler (must be after all routes) ────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  logger.error({ err, method: req.method, url: logger.sanitizeUrl(req.url) }, 'Unhandled server error');
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ─────────────────────────────────────────────
const { startup } = require('./lib/server-init');
const { startAllPolling, gracefulShutdown } = require('./lib/polling');
const { fireWebhooks } = require('./lib/notifications');
// The Citadel Discord bot was extracted into its own repository (citadel-bot)
// in May 2026 as part of the Agent / Cloud product split. The Agent no longer
// spawns the bot as a child process — customers who want the bot run it
// separately (self-hosted, or via Citadel Cloud once that hosts it).
//
// The Agent still exposes /api/discord/* so a relocated bot can call into
// the local server, so bot-manager remains importable for graceful-shutdown
// callers (lib/polling.js) — its functions are no-ops without a running
// child process. To re-enable the legacy auto-spawn path, set
// CITADEL_AGENT_SPAWN_BOT=1 in your .env.
const botManager = require('./lib/bot-manager');

// Only start the server if not in test mode
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    await startup();

    // Start all polling loops (metrics, mod detection, leaderboard, steam updates, RCON)
    await startAllPolling();

    // Priority queue expiration cleanup (every 60s — lightweight array filter)
    setInterval(() => {
      try { require('./lib/priority-engine').cleanExpired(); } catch {}
    }, 60_000);

    // Restart scheduling moved to Citadel Cloud — no in-Agent cron loop.
    // The lib's initialize() is now a no-op log; polling.js's shutdown()
    // call still works (no timers to clear). Existing data/restart-schedules.json
    // is left on disk so users can inspect what was configured before the
    // move; nothing reads it any more.

    // Start background license refresh (loads cached license, re-verifies on interval)
    try { require('./lib/license').startBackgroundRefresh(); } catch (err) {
      logger.error({ err }, 'Failed to start license background refresh');
    }

    // Start telemetry flush loop (P2.3a) — diagnostic events buffered to
    // data/telemetry-queue.json get POSTed to citadels.cc every 30s when
    // enabled. No-op when telemetry is disabled in data/telemetry.json.
    try { require('./lib/telemetry').startBackgroundFlush(); } catch (err) {
      logger.error({ err }, 'Failed to start telemetry flush loop');
    }

    // Start Cloud Bans sync loop (P3.6) — pulls the community ban list
    // from citadels.cc hourly when an active Citadel Cloud subscription
    // is present. No-op for free / unactivated installs.
    try { require('./lib/cloud-bans').startBackgroundSync(); } catch (err) {
      logger.error({ err }, 'Failed to start cloud-bans sync loop');
    }

    // Start Citadel self-update checker (polls citadels.cc for new versions)
    try { require('./lib/update-checker').startUpdateChecker(); } catch (err) {
      logger.error({ err }, 'Failed to start update checker');
    }

    // Watch citadel.config.json for external edits and hot-reload safe sections
    // (logging level, polling/backup intervals) without requiring a restart.
    try { require('./lib/config-watcher').start(); } catch (err) {
      logger.error({ err }, 'Failed to start config watcher');
    }

    // Start the cloud-bridge supervisor — opens a WS per linked DayZ server
    // (one CloudWsClient instance per ctx.servers row with a saved key) and
    // keeps them connected. Reconciles on a 5s tick; per-server routes also
    // call reconcileOne() directly for instant updates.
    try { require('./lib/cloud-bridge/supervisor').start(); } catch (err) {
      logger.error({ err }, 'Failed to start cloud-bridge supervisor');
    }

    // Listen
    server.listen(CONFIG.port, CONFIG.bindHost, () => {
      // Discord bot was extracted to the citadel-bot repo. The Agent no
      // longer launches it by default — customers run citadel-bot
      // separately, or wait for Citadel Cloud to host it.
      //
      // Legacy escape hatch: setting CITADEL_AGENT_SPAWN_BOT=1 still spawns
      // a bundled bot. Will be removed in a future release once Cloud takes
      // over the hosting story.
      const legacySpawnBot = process.env.CITADEL_AGENT_SPAWN_BOT === '1';
      if (legacySpawnBot) botManager.startBot();

      const proto = useHttps ? 'https' : 'http';
      const isLoopback = CONFIG.bindHost === '127.0.0.1' || CONFIG.bindHost === '::1' || CONFIG.bindHost === 'localhost';
      const displayHost = isLoopback ? 'localhost' : CONFIG.bindHost;
      const accessScope = isLoopback ? 'loopback only' : `bound to ${CONFIG.bindHost}`;
      const botLine = legacySpawnBot
        ? (process.env.DISCORD_BOT_TOKEN ? '⚠ Legacy in-Agent' : '⚠ Legacy (no token)')
        : 'Moved → citadel-bot repo';

      // Startup banner
      /* eslint-disable no-console */
      console.log('');
      console.log('┌─────────────────────────────────────────────┐');
      console.log('│              Citadel Agent                   │');
      console.log('├───────────────┬─────────────────────────────┤');
      console.log(`│ Dashboard     │ ${(proto + '://' + displayHost + ':' + CONFIG.port).padEnd(28)}│`);
      console.log(`│ Access        │ ${accessScope.padEnd(28)}│`);
      console.log(`│ Discord Bot   │ ${botLine.padEnd(28)}│`);
      console.log(`│ Sidecar       │ ${'Managed per-server'.padEnd(28)}│`);
      console.log(`│ Servers       │ ${(ctx.servers.length + ' configured').padEnd(28)}│`);
      console.log('└───────────────┴─────────────────────────────┘');
      console.log('');
      /* eslint-enable no-console */

      // Fire agent.ready webhook on successful startup
      fireWebhooks('agent.ready', {
        serverName: 'Citadel Agent',
        serverId: 'agent',
        reason: `Agent started on ${CONFIG.bindHost}:${CONFIG.port}`,
      }).catch(err => logger.error({ err }, 'Failed to fire agent.ready webhook'));
    });
  })().catch(err => {
    // eslint-disable-next-line no-console
    console.error('FATAL: Startup failed —', err.message || err);
    try { require('./lib/logger').fatal({ err }, 'Startup failed'); } catch {}

    // When running as an NSSM service, do NOT call process.exit(1).
    // If the process exits too quickly, NSSM enters a PAUSED state that
    // the user cannot recover from without manual intervention.
    // Instead, keep the process alive and serve an error page so the
    // admin can diagnose the issue via the dashboard URL.
    if (isServiceMode) {
      const errApp = express();
      const errMsg = `Citadel startup failed: ${err.message || err}. Check data/service.log for details.`;
      errApp.get('*', (_req, res) => res.status(503).json({ error: errMsg }));
      const errServer = http.createServer(errApp);
      errServer.listen(CONFIG.port, CONFIG.bindHost, () => {
        // eslint-disable-next-line no-console
        console.error(`Service is alive on ${CONFIG.bindHost}:${CONFIG.port} but in error state. Fix the issue and restart the service.`);
      });
    } else {
      process.exit(1);
    }
  });
}

// ─── Graceful Shutdown ───────────────────────────────────
process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));

// ─── Uncaught Error Handlers ─────────────────────────────
//
// Symmetric handling: BOTH unhandledRejection and uncaughtException are
// fatal. Previously the rejection branch only logged and kept the process
// alive, which masked async bugs and risked running the rest of the app
// against state corrupted by the failure that produced the rejection.
//
// In service mode (NSSM) the supervisor restarts us on exit. In dev the
// developer sees the crash — both are better than silently continuing.
//
// Tests skip exit so jest doesn't tear the worker down.
process.on('unhandledRejection', (reason, _promise) => {
  try { require('./lib/logger').fatal({ err: reason }, 'Unhandled promise rejection — shutting down'); } catch {}
  if (process.env.NODE_ENV !== 'test') process.exit(1);
});
process.on('uncaughtException', (err) => {
  try { require('./lib/logger').fatal({ err }, 'Uncaught exception — shutting down'); } catch {}
  if (process.env.NODE_ENV !== 'test') process.exit(1);
});

module.exports = { app, io, servers: ctx.servers, CONFIG };
