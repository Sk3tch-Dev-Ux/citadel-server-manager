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
  leaderboard: [],
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
};
