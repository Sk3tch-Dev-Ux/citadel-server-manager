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
  // Single seam for every server->client event.
  //
  // emitServer(...) is per-server data (players, metrics, console, killfeed,
  // backups, status). It is delivered ONLY to clients authorized for that
  // server (Audit C1): each socket joins 'server:<id>' rooms for the servers
  // its role.serverScope allows, and unrestricted/wildcard roles join the
  // 'servers:all' room (so they also receive servers created mid-session).
  // emitGlobal(...) is app-wide data (notifications, update banners) that must
  // always reach every connected client and is never server-scoped.
  emitServer(event, payload) {
    if (!this.io) return;
    const sid = payload && payload.serverId;
    if (sid) {
      // Union of the per-server room and the all-servers room (socket.io
      // de-dupes a socket that is in both). Scope-limited roles outside this
      // server's room never receive the event.
      this.io.to('server:' + sid).to('servers:all').emit(event, payload);
    } else {
      // No serverId on the payload — it can't be attributed to a server, so we
      // can't scope it. Preserve prior behavior (deliver to everyone) rather
      // than risk dropping a legitimately global event routed through here.
      this.io.emit(event, payload);
    }
  },
  emitGlobal(event, payload) {
    if (!this.io) return;
    this.io.emit(event, payload);
  },

};
