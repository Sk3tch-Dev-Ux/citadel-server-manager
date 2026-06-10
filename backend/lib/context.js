/**
 * Singleton application context.
 * All modules require this to access shared state.
 * CommonJS require() caching guarantees a single instance.
 */
module.exports = {
  // ─── Persistent Data (loaded from JSON at startup) ─────
  servers: [],
  users: [],
  roles: [],
  webhooks: [],
  auditLog: [],
  watchList: [],
  priorityQueue: [],
  banDatabase: [],
  notifications: [],
  // ─── Runtime State ─────────────────────────────────────
  serverStates: {},
  activeInstalls: {},
  steamCredentials: { username: '', password: '', guardCode: '' },
  steamLoginValidated: false,
  steamCmdPath: '',

  // ─── Set during bootstrap ─────────────────────────────
  CONFIG: null,
  io: null,

  // ─── Realtime emit helpers (Socket.IO) ────────────────
  // Single seam for every server->client event. Today both broadcast
  // globally (clients already filter by serverId in the payload), exactly as
  // the previous direct ctx.io.emit(...) calls did -- so routing call sites
  // through these changes nothing at runtime. The split is deliberate
  // groundwork: emitServer(...) marks per-server events that can later be
  // scoped to a 'server:<id>' room by flipping the one commented line below,
  // while emitGlobal(...) marks app-wide events (notifications, update
  // banners) that must always reach every connected client.
  emitServer(event, payload) {
    if (!this.io) return;
    // Future (per-server rooms): this.io.to('server:' + (payload && payload.serverId)).emit(event, payload);
    this.io.emit(event, payload);
  },
  emitGlobal(event, payload) {
    if (!this.io) return;
    this.io.emit(event, payload);
  },

};
