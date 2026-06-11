const { safeError } = require('../lib/http-errors');
/**
 * Server deployment and rebuild (dangerzone) routes.
 *
 * Deployment structure:
 *   deployments/<ServerName>/
 *   ├── profiles/          ← RPT files, BattlEye, mod configs
 *   ├── mpmissions/        ← mission files per map (scaffolded + SteamCMD)
 *   ├── .backups/          ← server backups
 *   ├── ban.txt            ← ban list
 *   ├── whitelist.txt      ← whitelist
 *   ├── serverDZ.cfg       ← server config
 *   └── DayZServer_x64.exe ← installed by SteamCMD
 *
 * App IDs:
 *   223350  — DayZ Dedicated Server (stable)
 *   1042420 — DayZ Experimental Dedicated Server
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
const { scaffoldHookDirectory } = require('../lib/lifecycle-hooks');
const auth = require('../middleware/auth');
const { getSidecarPort } = require('../lib/sidecar-manager');
const { ensureFirewallRules } = require('../lib/firewall-manager');

/**
 * Scaffold the deployment directory structure.
 * Creates profiles/, .backups/, ban.txt, whitelist.txt.
 */
function scaffoldDeployment(installDir, map, opts = {}) {
  const dirs = [
    path.join(installDir, 'profiles'),
    path.join(installDir, 'profiles', 'BattlEye'),
    path.join(installDir, 'mpmissions'),
    path.join(installDir, '.backups'),
  ];
  // Create map-specific mission folder (e.g. mpmissions/dayzOffline.chernarusplus/)
  if (map) {
    dirs.push(path.join(installDir, 'mpmissions', `dayzOffline.${map}`));
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const placeholders = ['ban.txt', 'whitelist.txt'];
  for (const file of placeholders) {
    const filePath = path.join(installDir, file);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '');
  }
  // BattlEye RCON config. NOTE: the x64 server reads battleye\BEServer_x64.cfg
  // in the install root — an earlier scaffold wrote profiles\BattlEye\
  // beserver.cfg, a file DayZServer_x64 never reads (and with an empty
  // password when none was supplied, which BattlEye treats as RCON-disabled).
  // Only pre-seed when the operator provided a password at deploy time;
  // otherwise ensureRconConfig() (server-lifecycle) generates one and writes
  // the cfg on first start.
  if (opts.rconPassword) {
    const beDir = path.join(installDir, 'battleye');
    if (!fs.existsSync(beDir)) fs.mkdirSync(beDir, { recursive: true });
    const beCfgPath = path.join(beDir, 'BEServer_x64.cfg');
    if (!fs.existsSync(beCfgPath)) {
      fs.writeFileSync(beCfgPath, `RConPassword ${opts.rconPassword}\r\nRConPort ${opts.rconPort || 2305}\r\n`);
    }
  }
}

/**
 * Build default launch params for a DayZ server.
 * -ip=0.0.0.0  binds the server to all network interfaces (required for external connectivity)
 * -steamQueryPort  explicitly sets the Steam query port (required for server browser visibility)
 */
function buildLaunchParams(gamePort, queryPort) {
  const port = gamePort || 2302;
  const qPort = queryPort || (port + 1);
  return `-config=serverDZ.cfg -ip=0.0.0.0 -port=${port} -steamQueryPort=${qPort} -profiles=profiles -dologs -adminlog -netlog -freezecheck`;
}

/**
 * Build a complete serverDZ.cfg with all essential settings.
 */
function buildServerDZCfg(name, maxPlayers, map, queryPort) {
  const template = map || 'chernarusplus';
  // Map template names to proper mission folder names
  const TEMPLATE_MAP = {
    'chernarusplus': 'dayzOffline.chernarusplus',
    'enoch': 'dayzOffline.enoch',
    'sakhal': 'dayzOffline.sakhal',
  };
  const missionTemplate = TEMPLATE_MAP[template.toLowerCase()] || `dayzOffline.${template}`;

  return [
    `hostname = "${name}";`,
    `password = "";`,
    `passwordAdmin = "";`,
    `maxPlayers = ${maxPlayers || 60};`,
    `steamQueryPort = ${queryPort || 2303};`,
    `verifySignatures = 2;`,
    `forceSameBuild = 1;`,
    `disableThirdPerson = 0;`,
    `disableCrosshair = 0;`,
    `disablePersonalLight = 1;`,
    `lightingConfig = 0;`,
    `serverTime = "SystemTime";`,
    `serverTimeAcceleration = 1;`,
    `serverNightTimeAcceleration = 1;`,
    `serverTimePersistent = 0;`,
    `guaranteedUpdates = 1;`,
    `loginQueueConcurrentPlayers = 5;`,
    `loginQueueMaxPlayers = 500;`,
    `instanceId = 1;`,
    `storageAutoFix = 1;`,
    `respawnTime = 5;`,
    `timeStampFormat = "Short";`,
    `allowFilePatching = 1;`,
    `disableVoN = 0;`,
    `vonCodecQuality = 20;`,
    ``,
    `class Missions`,
    `{`,
    `    class DayZ`,
    `    {`,
    `        template = "${missionTemplate}";`,
    `    };`,
    `};`,
    ``,
  ].join('\n');
}

/**
 * Human-readable error messages for common SteamCMD exit codes.
 */
const STEAMCMD_ERRORS = {
  1: 'Unknown SteamCMD error — try restarting SteamCMD or check your install path.',
  2: 'SteamCMD is already running. Close any other SteamCMD instances and try again.',
  5: 'Invalid Steam credentials. Update your username and password in Settings → Steam.',
  6: 'Steam account is not authorized for this app. Ensure you own DayZ on this account.',
  7: 'Network timeout — SteamCMD could not reach Steam servers. Check your internet connection.',
  8: 'SteamCMD failed to install the app. This app may require an authenticated Steam account. Configure your credentials in Settings → Steam, or check disk space and try again.',
  10: 'SteamCMD is already updating. Wait for the current operation to finish.',
};

/**
 * Build SteamCMD login arguments.
 * Uses authenticated login if credentials are available, falls back to anonymous.
 */
function buildLoginArgs() {
  if (ctx.steamLoginValidated && ctx.steamCredentials.username) {
    // Cached session: username-only leverages saved auth token
    return ['+login', ctx.steamCredentials.username];
  }
  if (ctx.steamCredentials.username && ctx.steamCredentials.password) {
    // Fresh login with full credentials
    const args = [];
    if (ctx.steamCredentials.guardCode) {
      args.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
    }
    args.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
    return args;
  }
  // No credentials — anonymous fallback
  return ['+login', 'anonymous'];
}

/**
 * Run a single SteamCMD download attempt.
 * Returns a promise that resolves on success or rejects with a descriptive error.
 */
function runSteamCMD(cmdPath, args, resolvedDir, srv, emitEvent = 'deployProgress') {
  return new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });

    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.match(/(\d+\.?\d*)\s*%/)) {
          const pct = parseFloat(trimmed.match(/(\d+\.?\d*)\s*%/)[1]);
          ctx.emitServer(emitEvent, { serverId: srv.id, status: 'downloading', progress: pct, message: `Downloading... ${pct.toFixed(0)}%` });
        } else if (trimmed.includes('Update state')) {
          ctx.emitServer(emitEvent, { serverId: srv.id, status: 'downloading', message: trimmed });
        }
      }
    });
    proc.stderr?.on('data', (data) => { output += data.toString(); });

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd on deploy timeout'); }
      reject(new Error('Deploy timed out after 60 minutes'));
    }, 60 * 60 * 1000);

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      // Success: clean exit or the server exe was installed despite non-zero code
      if (code === 0 || fs.existsSync(path.join(resolvedDir, 'DayZServer_x64.exe'))) {
        return resolve();
      }
      // Parse SteamCMD output for specific errors
      if (output.includes('Invalid Password') || output.includes('Login Failure')) {
        return reject(new Error('Invalid Steam credentials. Update them in Settings → Steam.'));
      }
      if (output.includes('Steam Guard') || output.includes('Two-factor') || output.includes('Enter the current code')) {
        return reject(new Error('Steam Guard code required. Re-verify your Steam login in Settings → Steam.'));
      }
      if (output.includes('No subscription') || output.includes('not authorized')) {
        return reject(new Error('This Steam account does not own DayZ. A DayZ purchase is required to download the dedicated server.'));
      }
      // Fallback to exit code lookup
      const friendly = STEAMCMD_ERRORS[code] || `SteamCMD exited with code ${code}. Check SteamCMD logs for details.`;
      reject(new Error(friendly));
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to launch SteamCMD: ${err.message}`));
    });
  });
}

/** Per-server deploy rate limiter — prevents duplicate deploys within cooldown window */
const deployLocks = new Map(); // serverId -> timestamp
const DEPLOY_COOLDOWN = 5 * 60 * 1000; // 5 minutes

module.exports = function(app) {
  app.post('/api/deploy', auth('server.deploy'), async (req, res) => {
    const { name, installDir, gameTitle, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map } = req.body;
    if (!name || !installDir) return res.status(400).json({ error: 'Name and install directory required' });

    const appId = gameTitle === 'DayZ, PC (Experimental)' ? '1042420' : '223350';

    // Ensure each server gets its own subdirectory — if installDir is a bare
    // deployments base (no server-specific folder), append a sanitized server name
    let finalDir = installDir;
    const baseName = path.basename(path.resolve(installDir));
    if (baseName === 'deployments' || baseName === 'Citadel' || finalDir.endsWith('\\') || finalDir.endsWith('/')) {
      const sanitized = name.trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
      if (sanitized) finalDir = path.join(installDir, sanitized);
    }
    const resolvedDir = path.resolve(finalDir);

    // Rate limit: prevent duplicate deploys to the same directory within cooldown window
    const deployKey = `deploy:${resolvedDir}`;
    const lastDeploy = deployLocks.get(deployKey);
    if (lastDeploy && (Date.now() - lastDeploy) < DEPLOY_COOLDOWN) {
      const remainSec = Math.ceil((DEPLOY_COOLDOWN - (Date.now() - lastDeploy)) / 1000);
      return res.status(429).json({ error: `A deploy was recently started for this directory. Please wait ${remainSec}s before retrying.` });
    }
    deployLocks.set(deployKey, Date.now());

    addAudit(req.user.id, req.user.username, 'server.deploy', `Deploying ${name} to ${resolvedDir}`);
    ctx.emitServer('deployProgress', { status: 'starting', message: 'Preparing deployment...' });

    const srv = {
      id: uuid(), name, installDir: resolvedDir,
      executable: 'DayZServer_x64.exe',
      launchParams: buildLaunchParams(gamePort, queryPort),
      ip: '0.0.0.0', gamePort: gamePort || 2302, queryPort: queryPort || 2303,
      rconPort: rconPort || 2305, rconPassword: rconPassword || '',
      maxPlayers: maxPlayers || 60, map: map || 'chernarusplus',
      gameTitle: gameTitle || 'DayZ, PC', profileDir: 'profiles', createdAt: new Date().toISOString(), deploying: true,
    };
    ctx.servers.push(srv);
    saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    initServerState(srv.id);
    res.json({ message: 'Deployment started', server: srv });

    // Background download with retry
    try {
      const cmdPath = await ensureSteamCMD();
      if (!fs.existsSync(resolvedDir)) fs.mkdirSync(resolvedDir, { recursive: true });

      // Step 1: Self-update SteamCMD (prevents exit code 8 on stale installs)
      ctx.emitServer('deployProgress', { serverId: srv.id, status: 'updating', message: 'Updating SteamCMD...' });
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn(cmdPath, ['+quit'], { cwd: path.dirname(cmdPath) });
          const t = setTimeout(() => { try { proc.kill(); } catch { /* ok */ } resolve(); }, 120000);
          proc.on('exit', () => { clearTimeout(t); resolve(); });
          proc.on('error', () => { clearTimeout(t); resolve(); }); // Non-fatal
        });
      } catch { /* SteamCMD self-update is best-effort */ }

      // Step 2: Build SteamCMD arguments
      // Uses authenticated login if credentials are configured, anonymous otherwise.
      const args = ['+force_install_dir', resolvedDir, ...buildLoginArgs()];
      args.push('+app_update', appId, 'validate', '+quit');

      // Step 3: Download with retry (SteamCMD often needs 2 attempts for large downloads)
      const MAX_RETRIES = 3;
      let lastError;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          ctx.emitServer('deployProgress', {
            serverId: srv.id, status: 'downloading',
            message: attempt === 1
              ? 'Downloading DayZ Server via SteamCMD...'
              : `Retrying download (attempt ${attempt}/${MAX_RETRIES})...`,
          });
          await runSteamCMD(cmdPath, args, resolvedDir, srv);
          lastError = null;
          break; // Success
        } catch (err) {
          lastError = err;
          logger.warn({ attempt, error: err.message }, 'SteamCMD deploy attempt failed');
          // Don't retry on credential or authorization errors — those won't self-resolve
          if (err.message.includes('credentials') || err.message.includes('Steam Guard') || err.message.includes('not own')) {
            break;
          }
          if (attempt < MAX_RETRIES) {
            ctx.emitServer('deployProgress', { serverId: srv.id, status: 'retrying', message: `Attempt ${attempt} failed: ${err.message}. Retrying in 5s...` });
            await new Promise(r => setTimeout(r, 5000));
          }
        }
      }
      if (lastError) throw lastError;

      // Scaffold deployment directory structure (including BattlEye config)
      scaffoldDeployment(resolvedDir, map || 'chernarusplus', { rconPort: srv.rconPort, rconPassword: srv.rconPassword });

      // Scaffold lifecycle hooks directory
      scaffoldHookDirectory(resolvedDir);

      // Open firewall ports so server is reachable from the internet
      ensureFirewallRules(srv.name, { gamePort: srv.gamePort, queryPort: srv.queryPort, rconPort: srv.rconPort })
        .catch(err => logger.warn({ err }, 'Firewall rule setup failed (non-fatal)'));

      // Configure sidecar API URL for this server
      const sidecarPort = getSidecarPort(srv);
      srv.inHouseApiUrl = `http://127.0.0.1:${sidecarPort}`;

      // Write server config — always overwrite on fresh deploy since SteamCMD
      // installs a bare default serverDZ.cfg that lacks steamQueryPort and other essentials
      const cfgPath = path.join(resolvedDir, 'serverDZ.cfg');
      fs.writeFileSync(cfgPath, buildServerDZCfg(name, maxPlayers, map, srv.queryPort));
      srv.deploying = false;
      saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
      ctx.serverStates[srv.id].config = readServerConfig(resolvedDir);
      ctx.emitServer('deployProgress', { serverId: srv.id, status: 'complete', message: 'Deployment complete!' });
    } catch (err) {
      ctx.emitServer('deployProgress', { serverId: srv.id, status: 'error', message: err.message });
      srv.deploying = false; srv.deployError = err.message;
      saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    }
  });

  app.post('/api/servers/:id/rebuild', auth('server.rebuild'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    // Rate limit: prevent duplicate rebuilds for the same server within cooldown window
    const rebuildKey = `rebuild:${srv.id}`;
    const lastRebuild = deployLocks.get(rebuildKey);
    if (lastRebuild && (Date.now() - lastRebuild) < DEPLOY_COOLDOWN) {
      const remainSec = Math.ceil((DEPLOY_COOLDOWN - (Date.now() - lastRebuild)) / 1000);
      return res.status(429).json({ error: `A rebuild was recently started for this server. Please wait ${remainSec}s before retrying.` });
    }
    deployLocks.set(rebuildKey, Date.now());

    const resolvedDir = path.resolve(srv.installDir);
    addAudit(req.user.id, req.user.username, 'server.rebuild', `Rebuilding ${srv.name} at ${resolvedDir}`);
    ctx.emitServer('dangerzoneProgress', { serverId: srv.id, status: 'starting', message: 'Preparing to wipe and reinstall server...' });
    try {
      const state = ctx.serverStates[srv.id];
      if (state && state.pid) {
        await killProcess(state.pid, srv.executable);
        state.status = 'stopped'; state.pid = null; state.players = []; state.startedAt = null;
        ctx.emitServer('serverStatus', { serverId: srv.id, status: 'stopped' });
      }
      if (fs.existsSync(resolvedDir)) {
        const entries = fs.readdirSync(resolvedDir);
        for (const entry of entries) {
          if (entry === '.backups') continue;
          fs.rmSync(path.join(resolvedDir, entry), { recursive: true, force: true });
        }
      }
      ctx.emitServer('dangerzoneProgress', { serverId: srv.id, status: 'wiping', message: 'Directory wiped. Reinstalling via SteamCMD...' });
      const cmdPath = await ensureSteamCMD();
      const appId = srv.gameTitle === 'DayZ, PC (Experimental)' ? '1042420' : '223350';

      // Uses authenticated login if credentials are configured, anonymous otherwise
      const args = ['+force_install_dir', resolvedDir, ...buildLoginArgs()];
      args.push('+app_update', appId, 'validate', '+quit');

      // Download with retry
      const MAX_RETRIES = 3;
      let lastError;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          ctx.emitServer('dangerzoneProgress', {
            serverId: srv.id, status: 'downloading',
            message: attempt === 1
              ? 'Downloading DayZ Server via SteamCMD...'
              : `Retrying download (attempt ${attempt}/${MAX_RETRIES})...`,
          });
          await runSteamCMD(cmdPath, args, resolvedDir, srv, 'dangerzoneProgress');
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          logger.warn({ attempt, error: err.message }, 'SteamCMD rebuild attempt failed');
          if (err.message.includes('credentials') || err.message.includes('Steam Guard') || err.message.includes('not own')) break;
          if (attempt < MAX_RETRIES) {
            ctx.emitServer('dangerzoneProgress', { serverId: srv.id, status: 'retrying', message: `Attempt ${attempt} failed: ${err.message}. Retrying in 5s...` });
            await new Promise(r => setTimeout(r, 5000));
          }
        }
      }
      if (lastError) throw lastError;

      // Scaffold deployment directory structure (including BattlEye config)
      scaffoldDeployment(resolvedDir, srv.map || 'chernarusplus', { rconPort: srv.rconPort, rconPassword: srv.rconPassword });

      // Scaffold lifecycle hooks directory
      scaffoldHookDirectory(resolvedDir);

      // Write server config — always overwrite on rebuild since SteamCMD
      // installs a bare default that lacks steamQueryPort and other essentials
      const cfgPath = path.join(resolvedDir, 'serverDZ.cfg');
      fs.writeFileSync(cfgPath, buildServerDZCfg(srv.name, srv.maxPlayers, srv.map, srv.queryPort));
      ctx.emitServer('dangerzoneProgress', { serverId: srv.id, status: 'complete', message: 'Rebuild complete!' });
      addNotification(srv.id, 'server.rebuild', 'Server Rebuilt', `${srv.name} wiped and reinstalled`, 'danger');
      addAudit(req.user.id, req.user.username, 'server.rebuild', `Completed rebuild for ${srv.name}`);
      res.json({ message: 'Rebuild complete!' });
    } catch (err) {
      ctx.emitServer('dangerzoneProgress', { serverId: srv.id, status: 'error', message: err.message });
      addAudit(req.user.id, req.user.username, 'server.rebuild', `Rebuild failed for ${srv.name}: ${err.message}`);
      safeError(err, req, res, { status: 500 });
    }
  });
};
