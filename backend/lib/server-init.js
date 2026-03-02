/**
 * Server state initialization, default server migration, and admin user creation.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const logger = require('./logger');
const ctx = require('./context');
const { loadJSON, saveJSON } = require('./data-store');
const { readServerConfig } = require('./dayz-config');
const { autoDetectMods } = require('./mod-manager');
const RCONClient = require('./rcon-client');

/**
 * Initialize runtime state for a single server.
 * Creates the serverStates entry with RCON client, empty metrics, etc.
 */
function initServerState(serverId) {
  if (ctx.serverStates[serverId]) return;
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv) return;
  // Load persisted scheduler/messenger/backup data
  const schedulerData = loadJSON(ctx.CONFIG.dataDir, `scheduler-${serverId}.json`, { jobs: [] });
  const messengerData = loadJSON(ctx.CONFIG.dataDir, `messenger-${serverId}.json`, { enabled: true, messages: [] });
  const backupData = loadJSON(ctx.CONFIG.dataDir, `backup-${serverId}.json`, {
    enabled: false, backupAtStartup: false, intervalMinutes: 60, maxKeepDays: 7, paths: ['mpmissions', 'profiles'], lastBackupAt: null,
  });

  ctx.serverStates[serverId] = {
    status: 'stopped', pid: null, process: null, players: [],
    logs: [], metricsHistory: { cpu: [], ram: [], players: [], fps: [], timestamps: [] },
    modList: [], config: {}, scheduledRestarts: [], chatMessages: [], banList: [],
    rcon: srv.rconPassword ? new RCONClient(srv.ip, srv.rconPort, srv.rconPassword) : null,
    startedAt: null,
    cftools: { lastSessionPoll: null, gameSessions: [] },
    inhouse: { sessions: [], lastPoll: null },
    scheduler: { jobs: schedulerData.jobs || [], pendingActions: new Map() },
    messenger: { enabled: messengerData.enabled !== false, messages: messengerData.messages || [], lastSent: new Map() },
    backup: { config: backupData, lastBackupAt: backupData.lastBackupAt || null, inProgress: false },
  };
  if (fs.existsSync(srv.installDir)) {
    ctx.serverStates[serverId].config = readServerConfig(srv.installDir);
    autoDetectMods(serverId);
  }
}

/**
 * Check if initial setup wizard has been completed.
 */
function isSetupComplete() {
  const setupFlagPath = path.join(ctx.CONFIG.dataDir, 'setup_complete.json');
  return fs.existsSync(setupFlagPath);
}

/**
 * Migrate: if no servers exist but .env has a DayZ install, create the default one.
 * Only runs after setup is complete — during first run, the setup wizard handles this.
 */
function migrateDefaultServer() {
  if (!isSetupComplete()) return;
  if (ctx.servers.length > 0) return;
  if (!ctx.CONFIG.dayz.installDir || !fs.existsSync(ctx.CONFIG.dayz.installDir)) return;
  const defaultServer = {
    id: uuid(),
    name: readServerConfig(ctx.CONFIG.dayz.installDir).hostname || 'DayZ Server',
    installDir: ctx.CONFIG.dayz.installDir,
    executable: ctx.CONFIG.dayz.executable || 'DayZServer_x64.exe',
    startBat: ctx.CONFIG.dayz.startBat || '',
    launchParams: ctx.CONFIG.dayz.launchParams || '',
    ip: ctx.CONFIG.dayz.ip || '127.0.0.1',
    gamePort: 2302, queryPort: 2303,
    rconPort: ctx.CONFIG.dayz.rconPort || 2305,
    rconPassword: ctx.CONFIG.dayz.rconPassword || '',
    maxPlayers: 60, map: 'chernarusplus',
    gameTitle: 'DayZ, PC', profileDir: ctx.CONFIG.dayz.profileDir || '',
    createdAt: new Date().toISOString(),
  };
  ctx.servers.push(defaultServer);
  saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
  logger.info({ name: defaultServer.name }, 'Created default server from .env config');
}

/**
 * Create the default admin user if no users exist.
 * Only runs after setup is complete — during first run, the setup wizard handles this.
 */
async function createDefaultAdmin() {
  if (!isSetupComplete()) return;
  if (ctx.users.length > 0) return;
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin', 10);
  ctx.users.push({
    id: uuid(), username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: hash, role: 'admin', isRoot: true, createdAt: new Date().toISOString(),
    description: 'This is the root user. It can not be modified or deleted.',
  });
  saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users.map(u => ({ ...u })));
  logger.info('Created default admin user');
}

/**
 * Run the full startup sequence:
 * 1. Migrate default server if needed
 * 2. Initialize all server states
 * 3. Create default admin
 */
async function startup() {
  migrateDefaultServer();
  ctx.servers.forEach(s => initServerState(s.id));
  await createDefaultAdmin();
}

module.exports = { initServerState, migrateDefaultServer, createDefaultAdmin, startup };
