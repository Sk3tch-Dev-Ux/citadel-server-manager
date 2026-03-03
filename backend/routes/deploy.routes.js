/**
 * Server deployment and rebuild (dangerzone) routes.
 *
 * Deployment structure (modeled after CFTools Architect):
 *   deployments/<ServerName>/
 *   ├── profiles/          ← RPT files, BattlEye, mod configs
 *   ├── .backups/          ← server backups
 *   ├── ban.txt            ← ban list
 *   ├── whitelist.txt      ← whitelist
 *   ├── serverDZ.cfg       ← server config
 *   └── DayZServer_x64.exe ← installed by SteamCMD
 *
 * No batch files. The executable is always spawned directly.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuid } = require('uuid');
const logger = require('../lib/logger');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { ensureSteamCMD } = require('../lib/steamcmd');
const { readServerConfig } = require('../lib/dayz-config');
const { killProcess } = require('../lib/process-manager');
const { initServerState } = require('../lib/server-init');
const { addAudit } = require('../lib/audit');
const { addNotification } = require('../lib/notifications');
const auth = require('../middleware/auth');
const requireLicense = require('../middleware/license');

/**
 * Scaffold the deployment directory structure.
 * Creates profiles/, .backups/, ban.txt, whitelist.txt.
 */
function scaffoldDeployment(installDir) {
  const dirs = [
    path.join(installDir, 'profiles'),
    path.join(installDir, 'profiles', 'BattlEye'),
    path.join(installDir, '.backups'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const placeholders = ['ban.txt', 'whitelist.txt'];
  for (const file of placeholders) {
    const filePath = path.join(installDir, file);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '');
  }
}

/**
 * Build default launch params for a DayZ server.
 */
function buildLaunchParams(gamePort) {
  return `-config=serverDZ.cfg -port=${gamePort || 2302} -profiles=profiles -dologs -adminlog -netlog -freezecheck`;
}

module.exports = function(app) {
  app.post('/api/deploy', auth('server.deploy'), requireLicense(), async (req, res) => {
    const { name, installDir, gameTitle, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map } = req.body;
    if (!name || !installDir) return res.status(400).json({ error: 'Name and install directory required' });

    const appId = gameTitle === 'DayZ, PC (Experimental)' ? '1024020' : '223350';
    const resolvedDir = path.resolve(installDir);

    addAudit(req.user.id, req.user.username, 'server.deploy', `Deploying ${name} to ${resolvedDir}`);
    ctx.io.emit('deployProgress', { status: 'starting', message: 'Preparing deployment...' });

    const srv = {
      id: uuid(), name, installDir: resolvedDir,
      executable: 'DayZServer_x64.exe',
      launchParams: buildLaunchParams(gamePort),
      ip: '127.0.0.1', gamePort: gamePort || 2302, queryPort: queryPort || 2303,
      rconPort: rconPort || 2305, rconPassword: rconPassword || '',
      maxPlayers: maxPlayers || 60, map: map || 'chernarusplus',
      gameTitle: gameTitle || 'DayZ, PC', profileDir: 'profiles', createdAt: new Date().toISOString(), deploying: true,
    };
    ctx.servers.push(srv);
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    initServerState(srv.id);
    res.json({ message: 'Deployment started', server: srv });

    // Background download
    try {
      const cmdPath = await ensureSteamCMD();
      if (!fs.existsSync(resolvedDir)) fs.mkdirSync(resolvedDir, { recursive: true });
      ctx.io.emit('deployProgress', { serverId: srv.id, status: 'downloading', message: 'Downloading DayZ Server via SteamCMD...' });

      const args = ['+force_install_dir', resolvedDir];
      if (ctx.steamCredentials.username && ctx.steamCredentials.password) {
        if (ctx.steamCredentials.guardCode) args.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
        args.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
      } else { args.push('+login', 'anonymous'); }
      args.push('+app_update', appId, 'validate', '+quit');

      await new Promise((resolve, reject) => {
        const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
        proc.stdout?.on('data', (data) => {
          for (const line of data.toString().split('\n')) {
            const trimmed = line.trim();
            if (trimmed.match(/(\d+\.?\d*)\s*%/)) {
              const pct = parseFloat(trimmed.match(/(\d+\.?\d*)\s*%/)[1]);
              ctx.io.emit('deployProgress', { serverId: srv.id, status: 'downloading', progress: pct, message: `Downloading... ${pct.toFixed(0)}%` });
            } else if (trimmed.includes('Update state')) {
              ctx.io.emit('deployProgress', { serverId: srv.id, status: 'downloading', message: trimmed });
            }
          }
        });
        proc.stderr?.on('data', () => {});
        const timeout = setTimeout(() => { try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd on deploy timeout'); } reject(new Error('Deploy timed out')); }, 60 * 60 * 1000);
        proc.on('exit', (code) => {
          clearTimeout(timeout);
          if (code === 0 || fs.existsSync(path.join(resolvedDir, 'DayZServer_x64.exe'))) resolve();
          else reject(new Error(`SteamCMD exit code: ${code}`));
        });
        proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });

      // Scaffold deployment directory structure
      scaffoldDeployment(resolvedDir);

      // Create default config
      const cfgPath = path.join(resolvedDir, 'serverDZ.cfg');
      if (!fs.existsSync(cfgPath)) {
        fs.writeFileSync(cfgPath, `hostname = "${name}";\npassword = "";\npasswordAdmin = "";\nmaxPlayers = ${maxPlayers || 60};\nverifySignatures = 2;\nforceSameBuild = 1;\ndisableThirdPerson = 0;\nserverTime = "SystemTime";\nserverTimeAcceleration = 1;\nserverTimePersistent = 0;\nguaranteedUpdates = 1;\nloginQueueConcurrentPlayers = 5;\nloginQueueMaxPlayers = 500;\ninstanceId = 1;\nstorageAutoFix = 1;\nrespawnTime = 5;\ntimeStampFormat = "Short";\ntemplate = "${map || 'chernarusplus'}";\n`);
      }
      srv.deploying = false;
      saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
      ctx.serverStates[srv.id].config = readServerConfig(resolvedDir);
      ctx.io.emit('deployProgress', { serverId: srv.id, status: 'complete', message: 'Deployment complete!' });
    } catch (err) {
      ctx.io.emit('deployProgress', { serverId: srv.id, status: 'error', message: err.message });
      srv.deploying = false; srv.deployError = err.message;
      saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    }
  });

  app.post('/api/servers/:id/rebuild', auth('server.rebuild'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const resolvedDir = path.resolve(srv.installDir);
    addAudit(req.user.id, req.user.username, 'server.rebuild', `Rebuilding ${srv.name} at ${resolvedDir}`);
    ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'starting', message: 'Preparing to wipe and reinstall server...' });
    try {
      const state = ctx.serverStates[srv.id];
      if (state && state.pid) {
        await killProcess(state.pid, srv.executable);
        state.status = 'stopped'; state.pid = null; state.players = []; state.startedAt = null;
        ctx.io.emit('serverStatus', { serverId: srv.id, status: 'stopped' });
      }
      if (fs.existsSync(resolvedDir)) {
        const entries = fs.readdirSync(resolvedDir);
        for (const entry of entries) {
          if (entry === '.backups') continue;
          fs.rmSync(path.join(resolvedDir, entry), { recursive: true, force: true });
        }
      }
      ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'wiping', message: 'Directory wiped. Reinstalling via SteamCMD...' });
      const cmdPath = await ensureSteamCMD();
      const appId = srv.gameTitle === 'DayZ, PC (Experimental)' ? '1024020' : '223350';
      const args = ['+force_install_dir', resolvedDir];
      if (ctx.steamCredentials.username && ctx.steamCredentials.password) {
        if (ctx.steamCredentials.guardCode) args.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
        args.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
      } else { args.push('+login', 'anonymous'); }
      args.push('+app_update', appId, 'validate', '+quit');
      await new Promise((resolve, reject) => {
        const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
        proc.stdout?.on('data', (data) => {
          for (const line of data.toString().split('\n')) {
            const trimmed = line.trim();
            if (trimmed.match(/(\d+\.?\d*)\s*%/)) {
              const pct = parseFloat(trimmed.match(/(\d+\.?\d*)\s*%/)[1]);
              ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'downloading', progress: pct, message: `Downloading... ${pct.toFixed(0)}%` });
            } else if (trimmed.includes('Update state')) {
              ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'downloading', message: trimmed });
            }
          }
        });
        proc.stderr?.on('data', () => {});
        const timeout = setTimeout(() => { try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd on rebuild timeout'); } reject(new Error('Rebuild timed out')); }, 60 * 60 * 1000);
        proc.on('exit', (code) => {
          clearTimeout(timeout);
          if (code === 0 || fs.existsSync(path.join(resolvedDir, 'DayZServer_x64.exe'))) resolve();
          else reject(new Error(`SteamCMD exit code: ${code}`));
        });
        proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });
      // Scaffold deployment directory structure
      scaffoldDeployment(resolvedDir);

      const cfgPath = path.join(resolvedDir, 'serverDZ.cfg');
      if (!fs.existsSync(cfgPath)) {
        fs.writeFileSync(cfgPath, `hostname = "${srv.name}";\npassword = "";\npasswordAdmin = "";\nmaxPlayers = ${srv.maxPlayers || 60};\nverifySignatures = 2;\nforceSameBuild = 1;\ndisableThirdPerson = 0;\nserverTime = "SystemTime";\nserverTimeAcceleration = 1;\nserverTimePersistent = 0;\nguaranteedUpdates = 1;\nloginQueueConcurrentPlayers = 5;\nloginQueueMaxPlayers = 500;\ninstanceId = 1;\nstorageAutoFix = 1;\nrespawnTime = 5;\ntimeStampFormat = "Short";\ntemplate = "${srv.map || 'chernarusplus'}";\n`);
      }
      ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'complete', message: 'Rebuild complete!' });
      addNotification(srv.id, 'server.rebuild', 'Server Rebuilt', `${srv.name} wiped and reinstalled`, 'danger');
      addAudit(req.user.id, req.user.username, 'server.rebuild', `Completed rebuild for ${srv.name}`);
      res.json({ message: 'Rebuild complete!' });
    } catch (err) {
      ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'error', message: err.message });
      addAudit(req.user.id, req.user.username, 'server.rebuild', `Rebuild failed for ${srv.name}: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });
};
