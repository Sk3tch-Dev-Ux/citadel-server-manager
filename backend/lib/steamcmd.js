/**
 * SteamCMD management - find, download, and use SteamCMD for mod/server downloads.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const ctx = require('./context');
const {
  STEAMCMD_INIT_TIMEOUT_MS,
  STEAMCMD_LOGIN_TIMEOUT_MS,
  STEAMCMD_DOWNLOAD_TIMEOUT_MS,
  STEAMCMD_UPDATE_TIMEOUT_MS,
} = require('./constants');

async function ensureSteamCMD() {
  if (ctx.steamCmdPath && fs.existsSync(ctx.steamCmdPath)) return ctx.steamCmdPath;
  const searchPaths = [
    'C:\\SteamCMD\\steamcmd.exe', 'C:\\steamcmd\\steamcmd.exe',
    path.join(__dirname, '..', '..', 'steamcmd', 'steamcmd.exe'),
  ];
  for (const p of searchPaths) { if (fs.existsSync(p)) { ctx.steamCmdPath = p; return p; } }
  // Auto-download
  const steamCmdDir = path.join(__dirname, '..', '..', 'steamcmd');
  const zipPath = path.join(steamCmdDir, 'steamcmd.zip');
  if (!fs.existsSync(steamCmdDir)) fs.mkdirSync(steamCmdDir, { recursive: true });
  const resp = await fetch('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip');
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await resp.arrayBuffer()));
  await new Promise((resolve, reject) => {
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${steamCmdDir.replace(/'/g, "''")}' -Force`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Expand-Archive exited with code ${code}`)));
  });
  const exePath = path.join(steamCmdDir, 'steamcmd.exe');
  if (!fs.existsSync(exePath)) throw new Error('steamcmd.exe not found after extraction');
  await new Promise((resolve) => {
    const proc = spawn(exePath, ['+quit'], { cwd: steamCmdDir });
    proc.on('exit', () => resolve()); proc.on('error', () => resolve());
    setTimeout(() => { try { proc.kill(); } catch (err) { logger.debug({ err }, 'SteamCMD init kill'); } resolve(); }, STEAMCMD_INIT_TIMEOUT_MS);
  });
  ctx.steamCmdPath = exePath;
  try { fs.unlinkSync(zipPath); } catch (err) { logger.debug({ err }, 'Failed to clean up steamcmd.zip'); }
  return exePath;
}

function findWorkshopContent(workshopId, serverInstallDir) {
  const appId = ctx.CONFIG.steam.appId;
  const cmdDir = ctx.steamCmdPath ? path.dirname(ctx.steamCmdPath) : '';
  const searchPaths = [
    serverInstallDir ? path.join(serverInstallDir, 'steamapps', 'workshop', 'content', appId, workshopId) : '',
    path.join(ctx.CONFIG.dayz.installDir, 'steamapps', 'workshop', 'content', appId, workshopId),
    cmdDir ? path.join(cmdDir, 'steamapps', 'workshop', 'content', appId, workshopId) : '',
    path.join(ctx.CONFIG.dayz.installDir, '..', '..', 'workshop', 'content', appId, workshopId),
  ].filter(Boolean);
  for (const p of searchPaths) {
    try { const resolved = path.resolve(p); if (fs.existsSync(resolved) && fs.readdirSync(resolved).length > 0) return resolved; } catch (err) { logger.debug({ err, path: p }, 'Workshop content search failed'); }
  }
  return null;
}

async function downloadWorkshopMod(workshopId, modName, serverId) {
  const cmdPath = await ensureSteamCMD();
  const appId = ctx.CONFIG.steam.appId;
  if (!ctx.steamCredentials.username) throw new Error('Steam credentials required.');
  if (!ctx.steamLoginValidated && !ctx.steamCredentials.password) throw new Error('Steam credentials required.');
  const args = [];
  if (ctx.steamLoginValidated) {
    // Use cached SteamCMD session — username-only login reuses the auth token
    args.push('+login', ctx.steamCredentials.username);
  } else {
    if (ctx.steamCredentials.guardCode) {
      args.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
    }
    args.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
  }
  const srv = ctx.servers.find(s => s.id === serverId);
  if (srv) args.push('+force_install_dir', srv.installDir);
  args.push('+workshop_download_item', appId, workshopId, 'validate', '+quit');

  if (ctx.io) ctx.io.emit('modInstallProgress', { serverId, workshopId, status: 'downloading', progress: 0, message: `Logging into Steam as ${ctx.steamCredentials.username}...` });

  return new Promise((resolve, reject) => {
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
    let output = ''; let needsSteamGuard = false;
    const emit = (status, progress, message) => {
      if (ctx.io) ctx.io.emit('modInstallProgress', { serverId, workshopId, status, progress, message });
    };
    const handleData = (data) => {
      const text = data.toString(); output += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim(); if (!trimmed) continue;
        if (trimmed.includes('Steam Guard') || trimmed.includes('Two-factor') || trimmed.includes('Enter the current code')) {
          needsSteamGuard = true;
          emit('steam_guard', 0, 'Steam Guard code required.');
          try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd during guard'); }
        } else if (trimmed.includes('Invalid Password') || trimmed.includes('Login Failure')) {
          emit('error', 0, 'Invalid Steam credentials.');
        } else if (trimmed.includes('Logged in OK') || trimmed.includes('Waiting for user info...OK')) {
          emit('downloading', 0, 'Logged in — starting download...');
        } else if (trimmed.includes('Downloading item')) {
          emit('downloading', 0, 'Downloading mod from Workshop...');
        } else if (/Update state.*preallocating/i.test(trimmed)) {
          emit('downloading', 2, 'Allocating disk space...');
        } else if (/Update state.*verifying/i.test(trimmed)) {
          emit('downloading', 95, 'Verifying download...');
        } else if (/Update state.*downloading.*progress:\s*[\d.]+\s*\((\d+)\s*\/\s*(\d+)\)/.test(trimmed)) {
          // Workshop download: "Update state (0x61) downloading, progress: 45.21 (12345678 / 27345678)"
          const m = trimmed.match(/progress:\s*[\d.]+\s*\((\d+)\s*\/\s*(\d+)\)/);
          if (m) {
            const current = parseInt(m[1]);
            const total = parseInt(m[2]);
            const pct = total > 0 ? Math.min(99, (current / total) * 100) : 0;
            emit('downloading', pct, `Downloading... ${pct.toFixed(0)}%`);
          }
        } else if (trimmed.match(/(\d+\.?\d*)\s*%/)) {
          // Fallback: app_update style "XX%" progress
          const pct = parseFloat(trimmed.match(/(\d+\.?\d*)\s*%/)[1]);
          emit('downloading', pct, `Downloading... ${pct.toFixed(0)}%`);
        } else if (trimmed.includes('Success. Downloaded item')) {
          emit('downloaded', 100, 'Download complete!');
        }
      }
    };
    proc.stdout?.on('data', handleData); proc.stderr?.on('data', handleData);
    const timeout = setTimeout(() => { try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd on timeout'); } reject(new Error('Download timed out')); }, STEAMCMD_DOWNLOAD_TIMEOUT_MS);
    proc.on('exit', () => {
      clearTimeout(timeout);
      if (needsSteamGuard) { ctx.steamLoginValidated = false; return reject(new Error('Steam Guard code required.')); }
      if (output.includes('Invalid Password') || output.includes('Login Failure')) { ctx.steamLoginValidated = false; return reject(new Error('Invalid Steam credentials.')); }
      const srvDir = ctx.servers.find(s => s.id === serverId)?.installDir;
      const contentPath = findWorkshopContent(workshopId, srvDir);
      if (contentPath) { ctx.steamLoginValidated = true; resolve(contentPath); }
      else reject(new Error('Download failed — content not found.'));
    });
    proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

/**
 * Validate Steam credentials by performing a real SteamCMD login.
 *
 * IMPORTANT: After a successful login (especially with a Steam Guard code),
 * SteamCMD caches an auth token in its config/ directory. Subsequent logins
 * with the same username from the same SteamCMD directory should reuse
 * the cached token WITHOUT needing a new guard code.
 *
 * To ensure the token is properly cached, we let SteamCMD fully complete
 * its login + quit cycle instead of killing it early.
 */
async function validateSteamLogin(username, password, guardCode) {
  const cmdPath = await ensureSteamCMD();
  const args = [];
  if (guardCode) args.push('+set_steam_guard_code', guardCode);
  args.push('+login', username, password, '+quit');
  return new Promise((resolve) => {
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
    let output = ''; let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      // DON'T kill proc immediately on success — let SteamCMD finish its
      // login cycle and write the auth token to config/config.vdf.
      // Only kill on errors to avoid hanging.
      if (!result.success) {
        try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd after validation'); }
      }
      resolve(result);
    };
    const handleData = (data) => {
      const text = data.toString(); output += text;
      if (text.includes('Steam Guard') || text.includes('Two-factor') || text.includes('authenticator') || text.includes('Enter the current code'))
        done({ success: false, needsGuard: true, error: 'Steam Guard code required' });
      else if (text.includes('Invalid Password') || text.includes('Login Failure'))
        done({ success: false, error: 'Invalid username or password' });
      else if (text.includes('rate limit') || text.includes('too many'))
        done({ success: false, error: 'Too many attempts — wait and retry' });
      // Note: we no longer call done() on success from data events.
      // Instead, we wait for the process to exit cleanly so the auth
      // token is fully written to disk.
    };
    proc.stdout?.on('data', handleData); proc.stderr?.on('data', handleData);
    const timeout = setTimeout(() => {
      if (output.includes('Logged in OK') || output.includes('Waiting for user info...OK')) done({ success: true });
      else done({ success: false, error: 'Login timed out — SteamCMD did not respond within 60 seconds' });
    }, STEAMCMD_LOGIN_TIMEOUT_MS);  // Longer timeout to let SteamCMD fully complete
    proc.on('exit', () => {
      if (resolved) return;
      if (output.includes('Logged in OK') || output.includes('Waiting for user info...OK')) done({ success: true });
      else if (output.includes('Steam Guard') || output.includes('Enter the current code')) done({ success: false, needsGuard: true, error: 'Steam Guard code required' });
      else if (output.includes('Invalid Password')) done({ success: false, error: 'Invalid username or password' });
      else done({ success: true });
    });
    proc.on('error', (err) => done({ success: false, error: err.message }));
  });
}

/**
 * Update the DayZ dedicated server app via SteamCMD (+app_update 223350 validate).
 * Reuses cached Steam session when available.
 *
 * @param {string} serverId - Server ID (for logging and progress events)
 * @param {string} installDir - Server installation directory
 * @returns {Promise<void>} Resolves on success, rejects on failure
 */
async function updateServerApp(serverId, installDir) {
  const cmdPath = await ensureSteamCMD();
  if (!ctx.steamCredentials.username) throw new Error('Steam credentials required.');
  if (!ctx.steamLoginValidated && !ctx.steamCredentials.password) throw new Error('Steam credentials required.');

  const srv = ctx.servers.find(s => s.id === serverId);
  const appId = (srv && srv.gameTitle === 'DayZ, PC (Experimental)') ? '1042420' : '223350';
  const resolvedDir = path.resolve(installDir);

  const args = ['+force_install_dir', resolvedDir];
  if (ctx.steamLoginValidated) {
    args.push('+login', ctx.steamCredentials.username);
  } else {
    if (ctx.steamCredentials.guardCode) {
      args.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
    }
    args.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
  }
  args.push('+app_update', appId, 'validate', '+quit');

  if (ctx.io) ctx.io.emit('updateProgress', { serverId, state: 'updating', message: 'Updating game files via SteamCMD...' });

  return new Promise((resolve, reject) => {
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
    let output = '';

    const handleData = (data) => {
      const text = data.toString();
      output += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.includes('Steam Guard') || trimmed.includes('Two-factor') || trimmed.includes('Enter the current code')) {
          try { proc.kill(); } catch { /* ok */ }
        }
        const pctMatch = trimmed.match(/(\d+\.?\d*)\s*%/);
        if (pctMatch) {
          const pct = parseFloat(pctMatch[1]);
          if (ctx.io) ctx.io.emit('updateProgress', { serverId, state: 'updating', progress: pct, message: `Updating game... ${pct.toFixed(0)}%` });
        }
      }
    };

    proc.stdout?.on('data', handleData);
    proc.stderr?.on('data', handleData);

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch { /* ok */ }
      reject(new Error('Game update timed out after 60 minutes'));
    }, STEAMCMD_UPDATE_TIMEOUT_MS);

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (output.includes('Invalid Password') || output.includes('Login Failure')) {
        ctx.steamLoginValidated = false;
        return reject(new Error('Invalid Steam credentials.'));
      }
      if (output.includes('Steam Guard') || output.includes('Enter the current code')) {
        ctx.steamLoginValidated = false;
        return reject(new Error('Steam Guard code required.'));
      }
      // SteamCMD may exit with non-zero but still succeed if the files are present
      if (code === 0 || output.includes('Success! App') || output.includes('already up to date')) {
        ctx.steamLoginValidated = true;
        return resolve();
      }
      // Check if the executable exists post-update (success despite non-zero exit)
      const exePath = path.join(resolvedDir, 'DayZServer_x64.exe');
      if (fs.existsSync(exePath)) {
        ctx.steamLoginValidated = true;
        return resolve();
      }
      reject(new Error(`SteamCMD app_update failed (exit code ${code})`));
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Update a single workshop mod via SteamCMD.
 * Reuses cached Steam session when available.
 *
 * @param {string} serverId - Server ID (for logging and progress events)
 * @param {string} installDir - Server installation directory
 * @param {string} modId - Steam Workshop item ID
 * @returns {Promise<void>} Resolves on success, rejects on failure
 */
async function updateWorkshopMod(serverId, installDir, modId) {
  const cmdPath = await ensureSteamCMD();
  const appId = ctx.CONFIG.steam.appId;
  if (!ctx.steamCredentials.username) throw new Error('Steam credentials required.');
  if (!ctx.steamLoginValidated && !ctx.steamCredentials.password) throw new Error('Steam credentials required.');

  const args = [];
  if (ctx.steamLoginValidated) {
    args.push('+login', ctx.steamCredentials.username);
  } else {
    if (ctx.steamCredentials.guardCode) {
      args.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
    }
    args.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
  }

  const srv = ctx.servers.find(s => s.id === serverId);
  if (srv) args.push('+force_install_dir', srv.installDir);
  args.push('+workshop_download_item', appId, String(modId), 'validate', '+quit');

  if (ctx.io) ctx.io.emit('updateProgress', { serverId, state: 'updating', message: `Updating mod ${modId} via SteamCMD...` });

  return new Promise((resolve, reject) => {
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
    let output = '';

    const handleData = (data) => {
      const text = data.toString();
      output += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.includes('Steam Guard') || trimmed.includes('Two-factor') || trimmed.includes('Enter the current code')) {
          try { proc.kill(); } catch { /* ok */ }
        }
        const pctMatch = trimmed.match(/(\d+\.?\d*)\s*%/);
        if (pctMatch) {
          const pct = parseFloat(pctMatch[1]);
          if (ctx.io) ctx.io.emit('updateProgress', { serverId, state: 'updating', progress: pct, message: `Updating mod... ${pct.toFixed(0)}%` });
        }
      }
    };

    proc.stdout?.on('data', handleData);
    proc.stderr?.on('data', handleData);

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch { /* ok */ }
      reject(new Error('Mod update timed out after 30 minutes'));
    }, STEAMCMD_DOWNLOAD_TIMEOUT_MS);

    proc.on('exit', () => {
      clearTimeout(timeout);
      if (output.includes('Invalid Password') || output.includes('Login Failure')) {
        ctx.steamLoginValidated = false;
        return reject(new Error('Invalid Steam credentials.'));
      }
      if (output.includes('Steam Guard') || output.includes('Enter the current code')) {
        ctx.steamLoginValidated = false;
        return reject(new Error('Steam Guard code required.'));
      }
      if (output.includes('Success. Downloaded item')) {
        ctx.steamLoginValidated = true;
        return resolve();
      }
      // Check if workshop content exists
      const contentPath = findWorkshopContent(String(modId), installDir);
      if (contentPath) {
        ctx.steamLoginValidated = true;
        return resolve();
      }
      reject(new Error(`Workshop mod update failed for item ${modId}`));
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

module.exports = { ensureSteamCMD, findWorkshopContent, downloadWorkshopMod, validateSteamLogin, updateServerApp, updateWorkshopMod };
