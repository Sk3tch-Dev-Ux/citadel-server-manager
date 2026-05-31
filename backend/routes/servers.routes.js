const { safeError } = require('../lib/http-errors');
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
const { detectMissionFolder } = require('../lib/mission-folder');
const { detectRunningProcess, killProcess, spawnDayZServer } = require('../lib/process-manager');
const { startSidecar, stopSidecar } = require('../lib/sidecar-manager');
const { restartServer } = require('../lib/server-lifecycle');
const { stopTailing } = require('../lib/rpt-tailer');
const auth = require('../middleware/auth');
const { ensureFirewallRules, removeFirewallRules } = require('../lib/firewall-manager');

/**
 * Map template names from serverDZ.cfg to our map config keys.
 *
 * The `template` field in serverDZ.cfg varies across servers — some use
 * the full "dayzoffline.X" prefix, others just the map name, and modded
 * maps often use their own naming convention. This table covers all
 * known variants so the interactive map auto-selects correctly.
 */
const TEMPLATE_TO_MAP = {
  // ─── Official Maps ───────────────────────────────────────
  'dayzoffline.chernarusplus': 'chernarusplus',
  'chernarusplus':             'chernarusplus',
  'chernarus':                 'chernarusplus',
  'dayzoffline.enoch':         'enoch',
  'enoch':                     'enoch',
  'livonia':                   'enoch',
  'dayzoffline.sakhal':        'sakhal',
  'sakhal':                    'sakhal',

  // ─── Popular Community Maps ──────────────────────────────
  'deerisle':                  'deerisle',
  'deer_isle':                 'deerisle',
  'namalsk':                   'namalsk',
  'namalskisland':             'namalsk',
  'takistanplus':              'takistanplus',
  'takistan':                  'takistanplus',
  'banov':                     'banov',
  'esseker':                   'esseker',
  'rostow':                    'rostow',
  'alteria':                   'alteria',
  'pripyat':                   'pripyat',
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

  // Lightweight endpoint that returns just the detected mission folder name for
  // a server. Used by the FilesPage template picker (audit N12) to substitute
  // the `<your-mission>` placeholder with a real folder name from serverDZ.cfg
  // so admins don't have to know their own folder layout.
  app.get('/api/servers/:id/mission-folder', auth.authForServer('server.view'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      const missionFolder = detectMissionFolder(srv.installDir);
      res.json({ missionFolder: missionFolder || null });
    } catch (err) {
      safeError(res, err, 'Failed to detect mission folder');
    }
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

  app.post('/api/servers', auth('server.deploy'), async (req, res) => {
    const { name, installDir, executable, launchParams, ip, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map, gameTitle } = req.body;
    if (!name || !installDir) return res.status(400).json({ error: 'Name and installDir required' });

    // Validate DayZ server binary exists in the install directory
    const resolvedDir = installDir.replace(/\//g, '\\');
    if (!fs.existsSync(resolvedDir)) {
      return res.status(400).json({ error: `Install directory does not exist: ${resolvedDir}` });
    }
    const exeToCheck = executable || 'DayZServer_x64.exe';
    const exePath = path.join(resolvedDir, exeToCheck);
    if (!fs.existsSync(exePath)) {
      // Also check fallback name
      const fallbackExe = exeToCheck === 'DayZServer_x64.exe' ? 'DayZServer.exe' : 'DayZServer_x64.exe';
      if (!fs.existsSync(path.join(resolvedDir, fallbackExe))) {
        return res.status(400).json({
          error: `DayZ server executable not found at ${resolvedDir}. Ensure DayZ Dedicated Server is installed in this directory.`,
        });
      }
    }
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
    const allowed = ['name','installDir','executable','launchParams','launchParamsList','ip','gamePort','queryPort','rconPort','rconPassword','maxPlayers','map','gameTitle','profileDir','networkInterface','autoStart','cpuAffinity','priorityLevel','processIntegrityChecks','integrityCheckMods','startGracePeriod','healthMonitoring','healthMinFPS','healthMaxRAM','healthAction','shutdownForModUpdates','shutdownForTitleUpdates','ignoreModUpdates','notifications','cftoolsServerApiId','cftoolsBanlistId','inHouseApiUrl','inHouseApiKey','autoUpdateEnabled','updateCountdownSeconds','updateWarningIntervals','engineAutoTune','dzsaPublish'];
    // Migrate old field name: ignoreServerModUpdates → ignoreModUpdates
    if (req.body.ignoreServerModUpdates !== undefined && req.body.ignoreModUpdates === undefined) {
      req.body.ignoreModUpdates = req.body.ignoreServerModUpdates;
    }
    // Validate notifications object structure if provided
    if (req.body.notifications && typeof req.body.notifications === 'object') {
      const validTypes = ['shutdown', 'gameUpdate', 'modUpdate'];
      for (const type of validTypes) {
        const n = req.body.notifications[type];
        if (n && typeof n === 'object') {
          if (n.duration !== undefined) n.duration = Math.max(0, parseInt(n.duration) || 0);
          if (n.interval !== undefined) n.interval = Math.max(1, parseInt(n.interval) || 5);
          if (n.message !== undefined) n.message = String(n.message);
          if (n.enabled !== undefined) n.enabled = !!n.enabled;
          if (n.kickOnCountdown !== undefined) n.kickOnCountdown = !!n.kickOnCountdown;
          if (n.lockOnCountdown !== undefined) n.lockOnCountdown = !!n.lockOnCountdown;
        }
      }
    }
    const dzsaWas = srv.dzsaPublish === true;
    for (const key of allowed) { if (req.body[key] !== undefined) srv[key] = req.body[key]; }
    // Clean up legacy field if canonical name is now set
    if (srv.ignoreModUpdates !== undefined) delete srv.ignoreServerModUpdates;
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    // Reconcile the DZSA endpoint if the toggle changed and the server is up.
    if (req.body.dzsaPublish !== undefined && (srv.dzsaPublish === true) !== dzsaWas) {
      const running = ctx.serverStates[srv.id]?.status === 'running';
      const dzsa = require('../lib/dzsa-publisher');
      if (srv.dzsaPublish === true && running) dzsa.start(srv); else dzsa.stop(srv.id);
    }
    // Update firewall rules if ports or name changed
    if (req.body.gamePort || req.body.queryPort || req.body.rconPort || req.body.name) {
      ensureFirewallRules(srv.name, { gamePort: srv.gamePort, queryPort: srv.queryPort, rconPort: srv.rconPort }).catch(() => {});
    }
    addAudit(req.user.id, req.user.username, 'server.update', `Updated server: ${srv.name}`);
    const { rconPassword: _, ...safeSrv } = srv;
    res.json(safeSrv);
  });

  // ─── DZSA Launcher publishing status ───────────────────────────
  app.get('/api/servers/:id/dzsa', auth('server.view'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const dzsa = require('../lib/dzsa-publisher');
    res.json({
      enabled: srv.dzsaPublish === true,
      publishing: dzsa.isPublishing(srv.id),
      port: dzsa.dzsaPort(srv),
      url: dzsa.publicUrl(srv),
      modCount: dzsa.buildModList(srv.id).length,
    });
  });

  // ─── Engine auto-tuning (dayzsetting.xml job system) ───────────
  // Preview the values Citadel would write for this host's CPU.
  app.get('/api/servers/:id/engine-tuning', auth('server.deploy'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const tuner = require('../lib/engine-tuner');
    res.json({
      enabled: srv.engineAutoTune !== false,
      recommended: tuner.computeJobSystem(),
    });
  });

  // Apply the tuning to dayzsetting.xml now (also runs automatically on start).
  app.post('/api/servers/:id/engine-tuning/apply', auth('server.deploy'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const result = require('../lib/engine-tuner').applyEngineTuning(srv);
    addAudit(req.user.id, req.user.username, 'server.engine_tune', `Engine tuning applied to ${srv.name}`);
    res.json(result);
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
    // Release lifecycle/crash/dzsa per-server state so the maps don't leak.
    try { require('../lib/server-lifecycle').forget(req.params.id); } catch { /* optional */ }
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
