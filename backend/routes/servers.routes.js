/**
 * Server CRUD routes (list, create, update, delete, detect).
 */
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { addAudit } = require('../lib/audit');
const { initServerState } = require('../lib/server-init');
const { readServerConfig } = require('../lib/dayz-config');
const { detectRunningProcess, killProcess, spawnDayZServer } = require('../lib/process-manager');
const { startSidecar, stopSidecar } = require('../lib/sidecar-manager');
const { restartServer } = require('../lib/server-lifecycle');
const { stopTailing } = require('../lib/rpt-tailer');
const auth = require('../middleware/auth');
const requireLicense = require('../middleware/license');
const { ensureFirewallRules, removeFirewallRules } = require('../lib/firewall-manager');

// Map template names from serverDZ.cfg to our map values
const TEMPLATE_TO_MAP = {
  'dayzoffline.chernarusplus': 'chernarusplus',
  'dayzoffline.enoch': 'enoch',
  'chernarusplus': 'chernarusplus',
  'enoch': 'enoch',
  'deerisle': 'deerisle',
  'namalsk': 'namalsk',
  'sakhal': 'sakhal',
  'takistanplus': 'takistanplus',
};

module.exports = function(app) {
  // Detect existing DayZ server installation from a directory path
  app.post('/api/servers/detect', auth('server.deploy'), (req, res) => {
    const { installDir } = req.body;
    if (!installDir) return res.status(400).json({ error: 'installDir required' });

    const dir = installDir.replace(/\//g, '\\');
    if (!fs.existsSync(dir)) return res.json({ found: false, reason: 'Directory does not exist' });

    // Check for server executable
    const exeNames = ['DayZServer_x64.exe', 'DayZServer.exe'];
    let executable = '';
    for (const exe of exeNames) {
      if (fs.existsSync(path.join(dir, exe))) { executable = exe; break; }
    }

    // Check for serverDZ.cfg
    const hasCfg = fs.existsSync(path.join(dir, 'serverDZ.cfg'));

    if (!executable && !hasCfg) {
      return res.json({ found: false, reason: 'No DayZ server executable or serverDZ.cfg found in this directory' });
    }

    const result = { found: true, executable, hasCfg };

    // Parse serverDZ.cfg if it exists
    if (hasCfg) {
      const cfg = readServerConfig(dir);
      result.config = {};
      if (cfg.hostname) result.config.name = cfg.hostname;
      if (cfg.maxPlayers) result.config.maxPlayers = cfg.maxPlayers;
      if (cfg.template) result.config.map = TEMPLATE_TO_MAP[cfg.template.toLowerCase()] || cfg.template;
      if (cfg.steamQueryPort) result.config.queryPort = cfg.steamQueryPort;

      // Detect if experimental based on directory or config hints
      const dirLower = dir.toLowerCase();
      if (dirLower.includes('experimental') || dirLower.includes('exp')) {
        result.config.gameTitle = 'DayZ, PC (Experimental)';
      }
    }

    // Check for mods directory
    const modsDir = path.join(dir, 'keys');
    if (fs.existsSync(modsDir)) {
      try {
        const keyFiles = fs.readdirSync(modsDir).filter(f => f.endsWith('.bikey') && f !== 'dayz.bikey');
        result.modCount = keyFiles.length;
      } catch { result.modCount = 0; }
    }

    res.json(result);
  });

  app.get('/api/servers', auth(), (req, res) => {
    const result = ctx.servers.map(s => {
      const state = ctx.serverStates[s.id] || {};
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

  app.post('/api/servers', auth('server.deploy'), requireLicense(), async (req, res) => {
    const { name, installDir, executable, launchParams, ip, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map, gameTitle } = req.body;
    if (!name || !installDir) return res.status(400).json({ error: 'Name and installDir required' });
    const srv = {
      id: uuid(), name, installDir: installDir.replace(/\//g, '\\'),
      executable: executable || 'DayZServer_x64.exe',
      launchParams: launchParams || `-config=serverDZ.cfg -ip=0.0.0.0 -port=${gamePort || 2302} -steamQueryPort=${queryPort || ((gamePort || 2302) + 1)} -profiles=profiles -dologs -adminlog -netlog -freezecheck`,
      ip: ip || '0.0.0.0', gamePort: gamePort || 2302, queryPort: queryPort || 2303,
      rconPort: rconPort || 2305, rconPassword: rconPassword || '',
      maxPlayers: maxPlayers || 60, map: map || 'chernarusplus',
      gameTitle: gameTitle || 'DayZ, PC', profileDir: 'profiles', createdAt: new Date().toISOString(),
    };
    ctx.servers.push(srv);
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    initServerState(srv.id);
    // Auto-apply firewall rules for the new server's ports
    ensureFirewallRules(srv.name, { gamePort: srv.gamePort, queryPort: srv.queryPort, rconPort: srv.rconPort }).catch(() => {});
    addAudit(req.user.id, req.user.username, 'server.create', `Created server: ${name}`);
    const { rconPassword: _, ...safe } = srv;
    res.json(safe);
  });

  app.patch('/api/servers/:id', auth('server.deploy'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const allowed = ['name','installDir','executable','launchParams','launchParamsList','ip','gamePort','queryPort','rconPort','rconPassword','maxPlayers','map','gameTitle','profileDir','networkInterface','autoStart','cpuAffinity','priorityLevel','processIntegrityChecks','integrityCheckMods','startGracePeriod','healthMonitoring','healthMinFPS','healthMaxRAM','healthAction','shutdownForModUpdates','shutdownForTitleUpdates','ignoreServerModUpdates','cftoolsServerApiId','cftoolsBanlistId','inHouseApiUrl','inHouseApiKey','autoUpdateEnabled','updateCountdownSeconds','updateWarningIntervals'];
    for (const key of allowed) { if (req.body[key] !== undefined) srv[key] = req.body[key]; }
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    // Update firewall rules if ports or name changed
    if (req.body.gamePort || req.body.queryPort || req.body.rconPort || req.body.name) {
      ensureFirewallRules(srv.name, { gamePort: srv.gamePort, queryPort: srv.queryPort, rconPort: srv.rconPort }).catch(() => {});
    }
    addAudit(req.user.id, req.user.username, 'server.update', `Updated server: ${srv.name}`);
    const { rconPassword: _, ...safeSrv } = srv;
    res.json(safeSrv);
  });

  // ─── Batch Operations (start/stop/restart multiple servers) ───
  app.post('/api/servers/batch', auth('server.start'), async (req, res) => {
    const { action, serverIds } = req.body;
    if (!action || !Array.isArray(serverIds) || serverIds.length === 0) {
      return res.status(400).json({ error: 'action and serverIds[] required' });
    }
    if (!['start', 'stop', 'restart'].includes(action)) {
      return res.status(400).json({ error: 'action must be start, stop, or restart' });
    }

    const results = [];
    for (const id of serverIds) {
      const srv = ctx.servers.find(s => s.id === id);
      if (!srv) { results.push({ id, success: false, error: 'Server not found' }); continue; }
      const state = ctx.serverStates[srv.id];
      if (!state) { results.push({ id, success: false, error: 'State not initialized' }); continue; }

      try {
        if (action === 'start') {
          if (state.status === 'running') { results.push({ id, success: true, message: 'Already running' }); continue; }
          state.status = 'starting';
          ctx.io.emit('serverStatus', { serverId: id, status: 'starting' });
          const { child, launchFailed } = spawnDayZServer(srv);
          if (child && child.pid) {
            state.pid = child.pid; state.process = child;
            const failReason = await launchFailed;
            if (failReason) {
              state.status = 'stopped'; state.pid = null; state.process = null;
              ctx.io.emit('serverStatus', { serverId: id, status: 'stopped' });
              results.push({ id, success: false, error: failReason });
            } else {
              state.status = 'running'; state.startedAt = new Date().toISOString();
              ctx.io.emit('serverStatus', { serverId: id, status: 'running' });
              startSidecar(srv);
              addAudit(req.user.id, req.user.username, 'server.start', `Batch started server: ${srv.name}`);
              results.push({ id, success: true, message: 'Started' });
            }
          } else {
            state.status = 'stopped';
            ctx.io.emit('serverStatus', { serverId: id, status: 'stopped' });
            results.push({ id, success: false, error: 'Failed to start' });
          }
        } else if (action === 'stop') {
          if (state.status === 'stopped') { results.push({ id, success: true, message: 'Already stopped' }); continue; }
          state.status = 'stopping';
          ctx.io.emit('serverStatus', { serverId: id, status: 'stopping' });
          stopSidecar(srv.id);
          if (state.pid) await killProcess(state.pid);
          state.status = 'stopped'; state.pid = null; state.startedAt = null;
          ctx.io.emit('serverStatus', { serverId: id, status: 'stopped' });
          addAudit(req.user.id, req.user.username, 'server.stop', `Batch stopped server: ${srv.name}`);
          results.push({ id, success: true, message: 'Stopped' });
        } else if (action === 'restart') {
          addAudit(req.user.id, req.user.username, 'server.restart', `Batch restarted server: ${srv.name}`);
          restartServer(srv.id, 'Batch restart');
          results.push({ id, success: true, message: 'Restarting' });
        }
      } catch (err) {
        results.push({ id, success: false, error: err.message || 'Unknown error' });
      }
    }

    res.json({ results });
  });

  app.delete('/api/servers/:id', auth('server.deploy'), (req, res) => {
    const idx = ctx.servers.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Server not found' });
    const name = ctx.servers[idx].name;
    if (ctx.serverStates[req.params.id]?.status === 'running') return res.status(400).json({ error: 'Stop the server first' });
    // Clean up all active resources for this server
    stopSidecar(req.params.id);
    stopTailing(req.params.id);
    if (ctx.serverStates[req.params.id]?.rcon) {
      try { ctx.serverStates[req.params.id].rcon.disconnect(); } catch { /* ok */ }
    }
    delete ctx.serverStates[req.params.id];
    ctx.servers.splice(idx, 1);
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    // Clean up firewall rules for deleted server
    removeFirewallRules(name).catch(() => {});
    addAudit(req.user.id, req.user.username, 'server.delete', `Deleted server: ${name}`);
    res.json({ message: 'Server deleted' });
  });
};
