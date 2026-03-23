/**
 * CitadelSocket — WebSocket integration for the CitadelBridge.
 *
 * When a client subscribes to a server's live dashboard, starts the bridge
 * polling and pushes real-time updates via socket.io events:
 *   - citadel:players   — player positions/health
 *   - citadel:metrics   — server FPS, entity counts
 *   - citadel:events    — new events as they appear
 *   - citadel:vehicles  — vehicle updates
 *   - citadel:world     — world events (heli crashes, etc.)
 *
 * Automatically stops polling when no clients are connected (resource saving).
 */
const logger = require('./logger');
const ctx = require('./context');
const { getBridge } = require('./citadel-bridge');

/** Track which sockets are subscribed to which server's citadel feed */
const _subscriptions = new Map(); // socketId → serverId

/**
 * Initialize Citadel WebSocket handlers on the socket.io instance.
 * Call this once after io is ready (in server.js).
 */
function initCitadelSocket(io) {
  io.on('connection', (socket) => {
    // ─── Subscribe to a server's citadel live feed ──────
    socket.on('citadel:subscribe', (data) => {
      const serverId = data?.serverId;
      if (!serverId) return;

      // Verify the server exists
      const srv = ctx.servers.find(s => s.id === serverId);
      if (!srv) {
        socket.emit('citadel:error', { error: 'Server not found' });
        return;
      }

      // Unsubscribe from any previous server
      const prevServerId = _subscriptions.get(socket.id);
      if (prevServerId && prevServerId !== serverId) {
        _unsubscribe(socket);
      }

      // Get or create bridge
      const bridge = getBridge(serverId);
      if (!bridge) {
        socket.emit('citadel:error', { error: 'Could not create bridge' });
        return;
      }

      // Join a socket.io room for this server's citadel feed
      const room = `citadel:${serverId}`;
      socket.join(room);
      _subscriptions.set(socket.id, serverId);

      // Add subscriber (starts polling if first)
      bridge.addSubscriber();

      logger.debug({ userId: socket.user?.id, serverId }, 'CitadelSocket: client subscribed');

      // Send initial state immediately
      const status = bridge.getStatus();
      socket.emit('citadel:status', { serverId, ...status });

      if (status.active) {
        const players = bridge.getPlayers();
        if (players) socket.emit('citadel:players', { serverId, players });

        const metrics = bridge.getMetrics();
        if (metrics && Object.keys(metrics).length) socket.emit('citadel:metrics', { serverId, metrics });

        const vehicles = bridge.getVehicles();
        if (vehicles) socket.emit('citadel:vehicles', { serverId, vehicles });

        const worldEvents = bridge.getWorldEvents();
        if (worldEvents) socket.emit('citadel:world', { serverId, events: worldEvents });

        const recentEvents = bridge.getRecentEvents(50);
        if (recentEvents.length) socket.emit('citadel:events', { serverId, events: recentEvents, initial: true });
      }

      // Wire up bridge events to the socket room (only once per bridge)
      _ensureBridgeListeners(bridge, serverId, io);
    });

    // ─── Unsubscribe from citadel feed ──────────────────
    socket.on('citadel:unsubscribe', () => {
      _unsubscribe(socket);
    });

    // ─── Clean up on disconnect ─────────────────────────
    socket.on('disconnect', () => {
      _unsubscribe(socket);
    });
  });
}

/** Track which bridges already have listeners attached */
const _bridgeListenersAttached = new Set();

function _ensureBridgeListeners(bridge, serverId, io) {
  if (_bridgeListenersAttached.has(serverId)) return;
  _bridgeListenersAttached.add(serverId);

  const room = `citadel:${serverId}`;

  bridge.on('players', (players) => {
    io.to(room).emit('citadel:players', { serverId, players });
  });

  bridge.on('metrics', (metrics) => {
    io.to(room).emit('citadel:metrics', { serverId, metrics });
  });

  bridge.on('vehicles', (vehicles) => {
    io.to(room).emit('citadel:vehicles', { serverId, vehicles });
  });

  bridge.on('worldEvents', (events) => {
    io.to(room).emit('citadel:world', { serverId, events });
  });

  bridge.on('events', (newEvents) => {
    io.to(room).emit('citadel:events', { serverId, events: newEvents, initial: false });
  });
}

function _unsubscribe(socket) {
  const serverId = _subscriptions.get(socket.id);
  if (!serverId) return;

  socket.leave(`citadel:${serverId}`);
  _subscriptions.delete(socket.id);

  const bridge = getBridge(serverId);
  if (bridge) {
    bridge.removeSubscriber();
  }

  logger.debug({ userId: socket.user?.id, serverId }, 'CitadelSocket: client unsubscribed');
}

module.exports = { initCitadelSocket };
