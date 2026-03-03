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

/**
 * Human-readable error messages for common SteamCMD exit codes.
 */
const STEAMCMD_ERRORS = {
  1: 'Unknown SteamCMD error — try restarting SteamCMD or check your install path.',
  2: 'SteamCMD is already running. Close any other SteamCMD instances and try again.',
  5: 'Invalid Steam credentials. Check your username and password in Settings → Steam.',
  6: 'Steam account is not authorized for this app. Ensure you own DayZ on this account.',
  7: 'Network timeout — SteamCMD could not reach Steam servers. Check your internet connection.',
  8: 'SteamCMD failed to install the app. Common causes: Steam credentials required (anonymous login not supported for DayZ), disk full, or SteamCMD needs to self-update. Configure your Steam credentials in Settings → Steam and try again.',
  10: 'SteamCMD is already updating. Wait for the current operation to finish.',
};

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
          ctx.io.emit(emitEvent, { serverId: srv.id, status: 'downloading', progress: pct, message: `Downloading... ${pct.toFixed(0)}%` });
        } else if (trimmed.includes('Update state')) {
          ctx.io.emit(emitEvent, { serverId: srv.id, status: 'downloading', message: trimmed });
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
        return reject(new Error('Steam Guard code required. Enter it in Settings → Steam and retry.'));
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

module.exports = function(app) {
  app.post('/api/deploy', auth('server.deploy'), requireLicense(), async (req, res) => {
    const { name, installDir, gameTitle, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map } = req.body;
    if (!name || !installDir) return res.status(400).json({ error: 'Name and install directory required' });

    // Pre-flight: DayZ DS requires authenticated Steam login
    if (!ctx.steamCredentials.username || !ctx.steamCredentials.password) {
      return res.status(400).json({
        error: 'Steam credentials required',
        message: 'DayZ Dedicated Server requires an authenticated Steam login. Configure your Steam credentials in Settings → Steam before deploying.',
        fix: 'settings.steam',
      });
    }

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

    // Background download with retry
    try {
      const cmdPath = await ensureSteamCMD();
      if (!fs.existsSync(resolvedDir)) fs.mkdirSync(resolvedDir, { recursive: true });

      // Step 1: Self-update SteamCMD (prevents exit code 8 on stale installs)
      ctx.io.emit('deployProgress', { serverId: srv.id, status: 'updating', message: 'Updating SteamCMD...' });
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn(cmdPath, ['+quit'], { cwd: path.dirname(cmdPath) });
          const t = setTimeout(() => { try { proc.kill(); } catch { /* ok */ } resolve(); }, 120000);
          proc.on('exit', () => { clearTimeout(t); resolve(); });
          proc.on('error', () => { clearTimeout(t); resolve(); }); // Non-fatal
        });
      } catch { /* SteamCMD self-update is best-effort */ }

      // Step 2: Build SteamCMD arguments
      // Note: Do NOT pass the guard code here if login was already validated.
      // SteamCMD caches the auth token in config/config.vdf after a successful
      // login. Re-sending a used guard code can actually cause auth failures.
      const args = ['+force_install_dir', resolvedDir];
      if (!ctx.steamLoginValidated && ctx.steamCredentials.guardCode) {
        args.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
      }
      args.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
      args.push('+app_update', appId, 'validate', '+quit');

      // Step 3: Download with retry (SteamCMD often needs 2 attempts for large downloads)
      const MAX_RETRIES = 3;
      let lastError;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          ctx.io.emit('deployProgress', {
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
            ctx.io.emit('deployProgress', { serverId: srv.id, status: 'retrying', message: `Attempt ${attempt} failed: ${err.message}. Retrying in 5s...` });
            await new Promise(r => setTimeout(r, 5000));
          }
        }
      }
      if (lastError) throw lastError;

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

    // Pre-flight: require Steam credentials
    if (!ctx.steamCredentials.username || !ctx.steamCredentials.password) {
      return res.status(400).json({
        error: 'Steam credentials required',
        message: 'DayZ Dedicated Server requires an authenticated Steam login. Configure your Steam credentials in Settings → Steam before rebuilding.',
        fix: 'settings.steam',
      });
    }

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

      // Build SteamCMD arguments (don't re-send guard code if already validated)
      const args = ['+force_install_dir', resolvedDir];
      if (!ctx.steamLoginValidated && ctx.steamCredentials.guardCode) {
        args.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
      }
      args.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
      args.push('+app_update', appId, 'validate', '+quit');

      // Download with retry
      const MAX_RETRIES = 3;
      let lastError;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          ctx.io.emit('dangerzoneProgress', {
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
            ctx.io.emit('dangerzoneProgress', { serverId: srv.id, status: 'retrying', message: `Attempt ${attempt} failed: ${err.message}. Retrying in 5s...` });
            await new Promise(r => setTimeout(r, 5000));
          }
        }
      }
      if (lastError) throw lastError;

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
