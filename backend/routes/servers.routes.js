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
const auth = require('../middleware/auth');

// Map template names from serverDZ.cfg to our map values
const TEMPLATE_TO_MAP = {
  'dayzoffline.chernarusplus': 'chernarusplus',
  'dayzoffline.enoch': 'enoch',
  'chernarusplus': 'chernarusplus',
  'enoch': 'enoch',
  'deerisle': 'deerisle',
  'namalsk': 'namalsk',
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

    // Check for .bat files
    const batFiles = [];
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.toLowerCase().endsWith('.bat')) batFiles.push(f);
      }
    } catch { /* ignore read errors */ }

    if (!executable && !hasCfg) {
      return res.json({ found: false, reason: 'No DayZ server executable or serverDZ.cfg found in this directory' });
    }

    const result = { found: true, executable, hasCfg, batFiles };

    // Parse serverDZ.cfg if it exists
    if (hasCfg) {
      const cfg = readServerConfig(dir);
      result.config = {};
      if (cfg.hostname) result.config.name = cfg.hostname;
      if (cfg.maxPlayers) result.config.maxPlayers = cfg.maxPlayers;
      if (cfg.template) result.config.map = TEMPLATE_TO_MAP[cfg.template.toLowerCase()] || cfg.template;
      if (cfg.steamQueryPort) result.config.queryPort = cfg.steamQueryPort;

      // Try to detect game port from launch params in .bat files
      for (const bat of batFiles) {
        try {
          const content = fs.readFileSync(path.join(dir, bat), 'utf8');
          const portMatch = content.match(/-port=(\d+)/);
          if (portMatch) { result.config.gamePort = parseInt(portMatch[1], 10); break; }
        } catch { /* ignore */ }
      }

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

  app.post('/api/servers', auth('server.deploy'), async (req, res) => {
    const { name, installDir, executable, startBat, launchParams, ip, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map, gameTitle } = req.body;
    if (!name || !installDir) return res.status(400).json({ error: 'Name and installDir required' });
    const srv = {
      id: uuid(), name, installDir: installDir.replace(/\//g, '\\'),
      executable: executable || 'DayZServer_x64.exe', startBat: startBat || '',
      launchParams: launchParams || '-config=serverDZ.cfg -port=2302 -dologs -adminlog -netlog -freezecheck',
      ip: ip || '127.0.0.1', gamePort: gamePort || 2302, queryPort: queryPort || 2303,
      rconPort: rconPort || 2305, rconPassword: rconPassword || '',
      maxPlayers: maxPlayers || 60, map: map || 'chernarusplus',
      gameTitle: gameTitle || 'DayZ, PC', profileDir: '', createdAt: new Date().toISOString(),
    };
    ctx.servers.push(srv);
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    initServerState(srv.id);
    addAudit(req.user.id, req.user.username, 'server.create', `Created server: ${name}`);
    res.json(srv);
  });

  app.patch('/api/servers/:id', auth('server.deploy'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const allowed = ['name','installDir','executable','startBat','launchParams','launchParamsList','ip','gamePort','queryPort','rconPort','rconPassword','maxPlayers','map','gameTitle','profileDir','networkInterface','autoStart','cpuAffinity','priorityLevel','processIntegrityChecks','integrityCheckMods','startGracePeriod','healthMonitoring','healthMinFPS','healthMaxRAM','healthAction','shutdownForModUpdates','shutdownForTitleUpdates','ignoreServerModUpdates','cftoolsServerApiId','cftoolsBanlistId','inHouseApiUrl','inHouseApiKey'];
    for (const key of allowed) { if (req.body[key] !== undefined) srv[key] = req.body[key]; }
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    addAudit(req.user.id, req.user.username, 'server.update', `Updated server: ${srv.name}`);
    res.json(srv);
  });

  app.delete('/api/servers/:id', auth('server.deploy'), (req, res) => {
    const idx = ctx.servers.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Server not found' });
    const name = ctx.servers[idx].name;
    if (ctx.serverStates[req.params.id]?.status === 'running') return res.status(400).json({ error: 'Stop the server first' });
    delete ctx.serverStates[req.params.id];
    ctx.servers.splice(idx, 1);
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    addAudit(req.user.id, req.user.username, 'server.delete', `Deleted server: ${name}`);
    res.json({ message: 'Server deleted' });
  });
};
