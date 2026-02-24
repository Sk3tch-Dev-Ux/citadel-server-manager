/**
 * SteamCMD management - find, download, and use SteamCMD for mod/server downloads.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const ctx = require('./context');

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
  const fetch = (await import('node-fetch')).default;
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
    setTimeout(() => { try { proc.kill(); } catch (err) { logger.debug({ err }, 'SteamCMD init kill'); } resolve(); }, 120000);
  });
  ctx.steamCmdPath = exePath;
  try { fs.unlinkSync(zipPath); } catch (err) { logger.debug({ err }, 'Failed to clean up steamcmd.zip'); }
  return exePath;
}

function findWorkshopContent(workshopId) {
  const appId = ctx.CONFIG.steam.appId;
  const cmdDir = ctx.steamCmdPath ? path.dirname(ctx.steamCmdPath) : '';
  const searchPaths = [
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
  if (!ctx.steamCredentials.username || !ctx.steamCredentials.password) throw new Error('Steam credentials required.');
  const args = [];
  if (ctx.steamCredentials.guardCode) args.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
  args.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
  const srv = ctx.servers.find(s => s.id === serverId);
  if (srv) args.push('+force_install_dir', srv.installDir);
  args.push('+workshop_download_item', appId, workshopId, 'validate', '+quit');

  if (ctx.io) ctx.io.emit('modInstallProgress', { serverId, workshopId, status: 'downloading', progress: 0, message: `Logging into Steam as ${ctx.steamCredentials.username}...` });

  return new Promise((resolve, reject) => {
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
    let output = ''; let needsSteamGuard = false;
    const handleData = (data) => {
      const text = data.toString(); output += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim(); if (!trimmed) continue;
        if (trimmed.includes('Steam Guard') || trimmed.includes('Two-factor') || trimmed.includes('Enter the current code')) {
          needsSteamGuard = true;
          if (ctx.io) ctx.io.emit('modInstallProgress', { serverId, workshopId, status: 'steam_guard', progress: 0, message: 'Steam Guard code required.' });
          try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd during guard'); }
        } else if (trimmed.includes('Invalid Password') || trimmed.includes('Login Failure')) {
          if (ctx.io) ctx.io.emit('modInstallProgress', { serverId, workshopId, status: 'error', progress: 0, message: 'Invalid Steam credentials.' });
        } else if (trimmed.match(/(\d+\.?\d*)\s*%/)) {
          const pct = parseFloat(trimmed.match(/(\d+\.?\d*)\s*%/)[1]);
          if (ctx.io) ctx.io.emit('modInstallProgress', { serverId, workshopId, status: 'downloading', progress: pct, message: `Downloading... ${pct.toFixed(0)}%` });
        } else if (trimmed.includes('Success. Downloaded item')) {
          if (ctx.io) ctx.io.emit('modInstallProgress', { serverId, workshopId, status: 'downloaded', progress: 100, message: 'Download complete!' });
        }
      }
    };
    proc.stdout?.on('data', handleData); proc.stderr?.on('data', handleData);
    const timeout = setTimeout(() => { try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd on timeout'); } reject(new Error('Download timed out')); }, 30 * 60 * 1000);
    proc.on('exit', () => {
      clearTimeout(timeout);
      if (needsSteamGuard) { ctx.steamLoginValidated = false; return reject(new Error('Steam Guard code required.')); }
      if (output.includes('Invalid Password') || output.includes('Login Failure')) { ctx.steamLoginValidated = false; return reject(new Error('Invalid Steam credentials.')); }
      const contentPath = findWorkshopContent(workshopId);
      if (contentPath) { ctx.steamLoginValidated = true; resolve(contentPath); }
      else reject(new Error('Download failed — content not found.'));
    });
    proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

async function validateSteamLogin(username, password, guardCode) {
  const cmdPath = await ensureSteamCMD();
  const args = [];
  if (guardCode) args.push('+set_steam_guard_code', guardCode);
  args.push('+login', username, password, '+quit');
  return new Promise((resolve) => {
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
    let output = ''; let resolved = false;
    const done = (result) => { if (resolved) return; resolved = true; clearTimeout(timeout); try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd after validation'); } resolve(result); };
    const handleData = (data) => {
      const text = data.toString(); output += text;
      if (text.includes('Steam Guard') || text.includes('Two-factor') || text.includes('authenticator') || text.includes('Enter the current code'))
        done({ success: false, needsGuard: true, error: 'Steam Guard code required' });
      else if (text.includes('Logged in OK') || text.includes('Waiting for user info...OK'))
        done({ success: true });
      else if (text.includes('Invalid Password') || text.includes('Login Failure'))
        done({ success: false, error: 'Invalid username or password' });
      else if (text.includes('rate limit') || text.includes('too many'))
        done({ success: false, error: 'Too many attempts — wait and retry' });
    };
    proc.stdout?.on('data', handleData); proc.stderr?.on('data', handleData);
    const timeout = setTimeout(() => {
      if (output.includes('Logged in OK') || output.includes('Waiting for user info...OK')) done({ success: true });
      else done({ success: false, error: 'Login timed out' });
    }, 30000);
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

module.exports = { ensureSteamCMD, findWorkshopContent, downloadWorkshopMod, validateSteamLogin };
