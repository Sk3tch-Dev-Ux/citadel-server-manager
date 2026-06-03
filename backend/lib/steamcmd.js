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
const { ROOT } = require('./paths');
const { withSteamLock } = require('./steamcmd-lock');

/**
 * Extract a zip into a directory. Audit M15 — replaces a PowerShell
 * `Expand-Archive` shell-string call that was awkward to quote and put
 * unsanitised paths into a `-Command` argument.
 *
 * Uses Windows' built-in tar.exe (bsdtar, ships with Windows 10+ since
 * 1803). No shell, no string interpolation — argv is structured. Falls
 * back to PowerShell ZipFile.ExtractToDirectory via -File-loaded script
 * if tar isn't available, which preserves behavior on older Windows.
 */
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    // Path 1: tar -xf zip -C dir. Built-in on Windows 10 1803+ and POSIX.
    // -xf reads from FILE; -C cd's to DIR before extracting.
    const tar = spawn('tar', ['-xf', zipPath, '-C', destDir], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    tar.stderr?.on('data', (d) => { stderr += d.toString(); });
    tar.on('error', (err) => {
      // tar not on PATH (rare on modern Windows; possible on stripped images).
      logger.debug({ err: err.message }, 'tar unavailable, falling back to PowerShell ZipFile');
      _extractZipPowerShellFallback(zipPath, destDir).then(resolve, reject);
    });
    tar.on('close', (code) => {
      if (code === 0) return resolve();
      // Some tar builds don't read .zip; try the fallback.
      logger.debug({ code, stderr }, 'tar -xf failed, falling back to PowerShell ZipFile');
      _extractZipPowerShellFallback(zipPath, destDir).then(resolve, reject);
    });
  });
}

/**
 * PowerShell fallback. Uses .NET's ZipFile.ExtractToDirectory via a tiny
 * one-line script passed through -EncodedCommand so paths don't have to
 * be embedded in a quoted shell string. Only invoked when tar fails.
 */
function _extractZipPowerShellFallback(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    // Build a script that takes paths from environment variables — no
    // string interpolation in the script body, so quoting can't go wrong.
    const script =
      'Add-Type -Assembly System.IO.Compression.FileSystem; ' +
      '[System.IO.Compression.ZipFile]::ExtractToDirectory($env:CITADEL_ZIP_SRC, $env:CITADEL_ZIP_DST)';
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, CITADEL_ZIP_SRC: zipPath, CITADEL_ZIP_DST: destDir },
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Zip extraction failed (powershell exit ${code})`)));
  });
}

async function ensureSteamCMD() {
  if (ctx.steamCmdPath && fs.existsSync(ctx.steamCmdPath)) return ctx.steamCmdPath;
  const searchPaths = [
    'C:\\SteamCMD\\steamcmd.exe', 'C:\\steamcmd\\steamcmd.exe',
    path.join(ROOT, 'steamcmd', 'steamcmd.exe'),
  ];
  for (const p of searchPaths) { if (fs.existsSync(p)) { ctx.steamCmdPath = p; return p; } }
  // Auto-download
  const steamCmdDir = path.join(ROOT, 'steamcmd');
  const zipPath = path.join(steamCmdDir, 'steamcmd.zip');
  if (!fs.existsSync(steamCmdDir)) fs.mkdirSync(steamCmdDir, { recursive: true });
  const resp = await fetch('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip');
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await resp.arrayBuffer()));
  await extractZip(zipPath, steamCmdDir);
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

/**
 * Recursively find the newest mtime (ms) under a directory tree.
 * Returns 0 if the path doesn't exist or can't be walked. Used to detect
 * whether SteamCMD actually wrote new bytes during an update.
 */
function newestMtimeMs(dir) {
  let newest = 0;
  try {
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      let st;
      try { st = fs.statSync(cur); } catch { continue; }
      if (st.mtimeMs > newest) newest = st.mtimeMs;
      if (st.isDirectory()) {
        let kids = [];
        try { kids = fs.readdirSync(cur); } catch { kids = []; }
        for (const k of kids) stack.push(path.join(cur, k));
      }
    }
  } catch (err) {
    logger.debug({ err, dir }, 'newestMtimeMs walk failed');
  }
  return newest;
}

/**
 * Capture a fingerprint of a workshop item's on-disk state BEFORE/AFTER a
 * SteamCMD run so we can tell a *real* update from a false success.
 *
 * A genuine `+workshop_download_item ... validate` that fetches a new version
 * advances either:
 *   - the content tree's newest mtime (new/updated files written), or
 *   - the per-app workshop manifest (`appworkshop_<appid>.acf`) which SteamCMD
 *     rewrites with the new timeupdated/manifest build id on every real pull.
 *
 * We sample both. The manifest lives at
 * <installDir>/steamapps/workshop/appworkshop_<appid>.acf (and possibly under
 * the SteamCMD dir for the default install location), so we check the same set
 * of base dirs that findWorkshopContent() searches.
 *
 * @returns {{ exists: boolean, contentMtime: number, manifestMtime: number, manifestSize: number }}
 */
function captureWorkshopState(workshopId, serverInstallDir) {
  const appId = ctx.CONFIG.steam.appId;
  const contentPath = findWorkshopContent(String(workshopId), serverInstallDir);
  const contentMtime = contentPath ? newestMtimeMs(contentPath) : 0;

  const cmdDir = ctx.steamCmdPath ? path.dirname(ctx.steamCmdPath) : '';
  const manifestCandidates = [
    serverInstallDir ? path.join(serverInstallDir, 'steamapps', 'workshop', `appworkshop_${appId}.acf`) : '',
    path.join(ctx.CONFIG.dayz.installDir, 'steamapps', 'workshop', `appworkshop_${appId}.acf`),
    cmdDir ? path.join(cmdDir, 'steamapps', 'workshop', `appworkshop_${appId}.acf`) : '',
  ].filter(Boolean);

  let manifestMtime = 0;
  let manifestSize = 0;
  for (const m of manifestCandidates) {
    try {
      const st = fs.statSync(m);
      if (st.mtimeMs > manifestMtime) manifestMtime = st.mtimeMs;
      // Size can change too when the manifest's timeupdated/build id advances.
      manifestSize += st.size;
    } catch { /* manifest may not exist yet — that's fine */ }
  }

  return {
    exists: !!contentPath,
    contentMtime,
    manifestMtime,
    manifestSize,
  };
}

/**
 * Decide whether a SteamCMD run produced a *real* update, given the output and
 * before/after on-disk fingerprints.
 *
 * Returns { updated: boolean, reason: string }.
 *
 * Design decision (documented per task A): the dedicated Update button is only
 * surfaced once polling has detected a newer Workshop time_updated, so by the
 * time we run an update SteamCMD *should* have something new to fetch. If it
 * fetches nothing — login timed out, the run stalled, or SteamCMD trusted a
 * stale cached manifest and skipped the download — neither the explicit
 * "Success. Downloaded item" marker appears NOR does any on-disk fingerprint
 * advance. We treat that as a failure-to-update (not a benign no-op), because
 * silently reporting success is exactly the bug that makes "@CitadelAdmin won't
 * update". A force-update of a genuinely-current mod is not the surfaced path,
 * so this is the correct trade-off.
 */
function classifyUpdateResult(output, before, after) {
  if (output.includes('Success. Downloaded item')) {
    return { updated: true, reason: 'success-marker' };
  }
  // New content appeared where there was none before.
  if (after.exists && !before.exists) {
    return { updated: true, reason: 'content-created' };
  }
  // Content bytes were rewritten (newer mtime than before the run).
  if (after.contentMtime > before.contentMtime) {
    return { updated: true, reason: 'content-mtime-advanced' };
  }
  // The per-app workshop manifest advanced (timeupdated/build id rewritten).
  if (after.manifestMtime > before.manifestMtime || after.manifestSize !== before.manifestSize) {
    return { updated: true, reason: 'manifest-advanced' };
  }
  return { updated: false, reason: 'no-change' };
}

async function _downloadWorkshopModImpl(workshopId, modName, serverId) {
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

  // Fingerprint state before the run. For a download we accept either the
  // success marker OR newly-appeared/advanced content — but NOT pre-existing,
  // untouched content (that would mask a login-timeout false success the same
  // way the update path did).
  const dlSrvDir = ctx.servers.find(s => s.id === serverId)?.installDir;
  const before = captureWorkshopState(workshopId, dlSrvDir);

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
      const after = captureWorkshopState(workshopId, dlSrvDir);
      const verdict = classifyUpdateResult(output, before, after);
      const contentPath = findWorkshopContent(workshopId, dlSrvDir);
      if (verdict.updated && contentPath) {
        ctx.steamLoginValidated = true;
        logger.info({ workshopId, reason: verdict.reason }, 'Workshop mod download verified');
        return resolve(contentPath);
      }
      // Pre-existing but untouched content, or no content at all → not a real
      // download. Surface a clear, retryable error (the retry wrapper will
      // back off and try again on this transient/timeout case).
      reject(new Error(
        'SteamCMD did not fetch the mod (possible login timeout or stalled download). ' +
        'Retrying may help; if it persists, clear steamapps/workshop/appworkshop_' + appId + '.acf to force a re-pull.'
      ));
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
async function _validateSteamLoginImpl(username, password, guardCode) {
  const cmdPath = await ensureSteamCMD();
  const args = [];
  if (guardCode) args.push('+set_steam_guard_code', guardCode);
  args.push('+login', username, password, '+quit');
  return new Promise((resolve) => {
    const proc = spawn(cmdPath, args, { cwd: path.dirname(cmdPath) });
    let output = ''; let resolved = false; let loginStallTimer = null;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (loginStallTimer) clearTimeout(loginStallTimer);
      logger.debug({ result: { ...result, error: result.error }, steamcmdOutput: output.substring(0, 500) }, 'Steam login validation result');
      // DON'T kill proc immediately on success — let SteamCMD finish its
      // login cycle and write the auth token to config/config.vdf.
      // Only kill on errors to avoid hanging.
      if (!result.success) {
        try { proc.kill(); } catch (err) { logger.debug({ err }, 'Kill steamcmd after validation'); }
      }
      resolve(result);
    };
    const isGuardRequired = (text) =>
      text.includes('Steam Guard') || text.includes('Two-factor') || text.includes('Two Factor') ||
      text.includes('authenticator') || text.includes('Enter the current code') ||
      text.includes('Account Logon Denied') || text.includes('Logon Denied');
    const isLoginSuccess = (text) =>
      text.includes('Logged in OK') || text.includes('Waiting for user info...OK');
    const isLoginFailed = (text) =>
      text.includes('Invalid Password') || text.includes('Login Failure') || text.includes('FAILED login');
    const isRateLimited = (text) =>
      text.includes('rate limit') || text.includes('too many') || text.includes('Rate Limit');

    const handleData = (data) => {
      const text = data.toString(); output += text;
      logger.debug({ chunk: text.trim().substring(0, 300) }, 'SteamCMD output chunk');

      if (isLoginSuccess(text)) {
        // Clear stall timer immediately on success
        if (loginStallTimer) { clearTimeout(loginStallTimer); loginStallTimer = null; }
        // Don't resolve yet — let exit handler do it so SteamCMD can cache token
      } else if (isGuardRequired(text)) {
        done({ success: false, needsGuard: true, error: 'Steam Guard code required — check your email' });
      } else if (isLoginFailed(text)) {
        done({ success: false, error: 'Invalid username or password' });
      } else if (isRateLimited(text)) {
        done({ success: false, error: 'Too many attempts — wait and retry' });
      }

      // Stall detection: SteamCMD often hangs silently when waiting for a
      // Steam Guard code (no "Steam Guard" text, just blocks on stdin).
      // If we see "Logging in" but get no success/failure within 20s, assume guard.
      // Increased from 10s to 20s to reduce false positives on slow connections.
      if (text.includes('Logging in') && !loginStallTimer) {
        loginStallTimer = setTimeout(() => {
          if (!resolved && !isLoginSuccess(output)) {
            logger.info({ steamcmdOutput: output.substring(0, 500) }, 'SteamCMD stalled after login attempt — assuming Steam Guard required');
            done({ success: false, needsGuard: true, error: 'Steam Guard code required — check your email or authenticator app' });
          }
        }, 20_000);
      }
    };
    proc.stdout?.on('data', handleData); proc.stderr?.on('data', handleData);
    const timeout = setTimeout(() => {
      logger.warn({ steamcmdOutput: output.substring(0, 500) }, 'SteamCMD login timed out');
      if (isLoginSuccess(output)) done({ success: true });
      else if (isGuardRequired(output)) done({ success: false, needsGuard: true, error: 'Steam Guard code required — check your email' });
      else done({ success: false, needsGuard: true, error: 'Login timed out — this usually means Steam Guard is required. Check your email for a code.' });
    }, STEAMCMD_LOGIN_TIMEOUT_MS);
    proc.on('exit', (code) => {
      if (resolved) return;
      logger.info({ exitCode: code, steamcmdOutput: output.substring(0, 800) }, 'SteamCMD login process exited');
      if (isLoginSuccess(output)) done({ success: true });
      else if (isGuardRequired(output)) done({ success: false, needsGuard: true, error: 'Steam Guard code required — check your email' });
      else if (isLoginFailed(output)) done({ success: false, error: 'Invalid username or password' });
      else if (isRateLimited(output)) done({ success: false, error: 'Too many attempts — wait and retry' });
      // FAILED without specific match = most likely guard/auth issue
      else if (output.includes('FAILED')) done({ success: false, needsGuard: true, error: 'Steam login failed — a Steam Guard code may be required. Check your email.' });
      else done({ success: false, needsGuard: true, error: 'Steam login did not succeed — a Steam Guard code may be required. Check your email.' });
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
async function _updateServerAppImpl(serverId, installDir) {
  const cmdPath = await ensureSteamCMD();

  const srv = ctx.servers.find(s => s.id === serverId);
  const appId = (srv && srv.gameTitle === 'DayZ, PC (Experimental)') ? '1042420' : '223350';
  const resolvedDir = path.resolve(installDir);

  // Use authenticated login if credentials are available, anonymous as fallback
  const loginArgs = [];
  if (ctx.steamLoginValidated && ctx.steamCredentials.username) {
    loginArgs.push('+login', ctx.steamCredentials.username);
  } else if (ctx.steamCredentials.username && ctx.steamCredentials.password) {
    if (ctx.steamCredentials.guardCode) loginArgs.push('+set_steam_guard_code', ctx.steamCredentials.guardCode);
    loginArgs.push('+login', ctx.steamCredentials.username, ctx.steamCredentials.password);
  } else {
    loginArgs.push('+login', 'anonymous');
  }
  const args = ['+force_install_dir', resolvedDir, ...loginArgs];
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
      // SteamCMD may exit with non-zero but still succeed if the files are present
      if (code === 0 || output.includes('Success! App') || output.includes('already up to date')) {
        return resolve();
      }
      // Check if the executable exists post-update (success despite non-zero exit)
      const exePath = path.join(resolvedDir, 'DayZServer_x64.exe');
      if (fs.existsSync(exePath)) {
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
async function _updateWorkshopModImpl(serverId, installDir, modId) {
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

  // Fingerprint the on-disk state BEFORE the run so we can tell a real update
  // from a false success (login timeout / stalled fetch / stale cached manifest).
  const srvDirForState = srv ? srv.installDir : installDir;
  const before = captureWorkshopState(modId, srvDirForState);

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
      // ── Hard auth failures: never retry these (see updateWorkshopModWithRetry) ──
      if (output.includes('Invalid Password') || output.includes('Login Failure')) {
        ctx.steamLoginValidated = false;
        return reject(new Error('Invalid Steam credentials.'));
      }
      if (output.includes('Steam Guard') || output.includes('Enter the current code')) {
        ctx.steamLoginValidated = false;
        return reject(new Error('Steam Guard code required.'));
      }

      // ── Real-vs-false update detection ──
      // Compare the on-disk fingerprint captured before the run against now.
      // A genuine update advances content mtime / manifest, or prints the
      // explicit success marker. Anything else means SteamCMD fetched nothing.
      const after = captureWorkshopState(modId, srvDirForState);
      const verdict = classifyUpdateResult(output, before, after);
      if (verdict.updated) {
        ctx.steamLoginValidated = true;
        logger.info({ modId, reason: verdict.reason }, 'Workshop mod update verified');
        return resolve();
      }

      // Nothing was fetched. Distinguish SteamCMD's own "already up to date" /
      // timeout phrasing for a clearer message, but still treat it as a
      // failure-to-update (the Update button is only shown when a newer version
      // was detected upstream — so "no new bytes" is wrong here).
      logger.warn({ modId, before, after, steamcmdOutput: output.substring(0, 500) }, 'Workshop mod update did not fetch a new version');
      const lower = output.toLowerCase();
      if (/already up to date|no update available|nothing to do/.test(lower)) {
        return reject(new Error(
          'SteamCMD reported the item already up to date but a newer Workshop version was expected. ' +
          'The cached manifest may be stale — clear steamapps/workshop/appworkshop_' + appId + '.acf to force a re-pull, then try again.'
        ));
      }
      if (/timeout|timed out|connection|no subscription|failed to install/.test(lower)) {
        return reject(new Error(
          'SteamCMD did not fetch a new version (possible login timeout or connection issue). ' +
          'Try again; if it persists, clear steamapps/workshop/appworkshop_' + appId + '.acf to force a re-pull.'
        ));
      }
      reject(new Error(
        'SteamCMD did not fetch a new version (possible login timeout or already-cached manifest). ' +
        'Try again; if it persists, clear steamapps/workshop/appworkshop_' + appId + '.acf to force a re-pull.'
      ));
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Wrapper around downloadWorkshopMod with automatic retry on transient failures.
 * Retries up to 2 times with 5s/15s delays. Does NOT retry on auth failures.
 */
async function downloadWorkshopModWithRetry(workshopId, modName, serverId, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await downloadWorkshopMod(workshopId, modName, serverId);
    } catch (err) {
      lastError = err;
      // Don't retry auth failures
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('guard') || msg.includes('credential') || msg.includes('password') || msg.includes('rate limit')) {
        throw err;
      }
      if (attempt < maxRetries) {
        const delay = attempt === 0 ? 5000 : 15000;
        logger.warn({ workshopId, modName, attempt: attempt + 1, error: err.message }, `Mod download failed, retrying in ${delay / 1000}s...`);
        if (ctx.io) ctx.io.emit('modInstallProgress', { serverId, workshopId, status: 'retrying', progress: 0, message: `Download failed — retrying (attempt ${attempt + 2}/${maxRetries + 1})...` });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Wrapper around updateWorkshopMod with automatic retry on transient failures.
 * Mirrors downloadWorkshopModWithRetry: up to 2 retries with 5s/15s delays.
 *
 * Does NOT retry on auth failures (guard / credential / password / rate limit)
 * — those need user action. DOES retry on the "did not fetch a new version"
 * false-success error and on timeouts / transient errors, which is exactly the
 * login-timeout class of failure that root cause (A) now surfaces instead of
 * silently reporting success.
 *
 * Calls the *locked* updateWorkshopMod per attempt so the single-flight
 * withSteamLock mutex is released during the inter-retry backoff (consistent
 * with how the download path does it) — we never sleep while holding the lock.
 */
async function updateWorkshopModWithRetry(serverId, installDir, modId, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await updateWorkshopMod(serverId, installDir, modId);
    } catch (err) {
      lastError = err;
      const msg = (err.message || '').toLowerCase();
      // Don't retry auth failures — they require the user to re-enter creds/guard.
      if (msg.includes('guard') || msg.includes('credential') || msg.includes('password') || msg.includes('rate limit')) {
        throw err;
      }
      if (attempt < maxRetries) {
        const delay = attempt === 0 ? 5000 : 15000;
        logger.warn({ modId, serverId, attempt: attempt + 1, error: err.message }, `Mod update failed, retrying in ${delay / 1000}s...`);
        if (ctx.io) ctx.io.emit('updateProgress', { serverId, state: 'updating', message: `Update failed — retrying (attempt ${attempt + 2}/${maxRetries + 1})...` });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ─── SteamCMD concurrency lock ──────────────────────────────
// Every SteamCMD invocation is serialized through a single global mutex so two
// processes never share the staging dir / auth-token cache at once. The retry
// wrapper calls the locked downloadWorkshopMod per attempt, so the lock is
// released during the inter-retry backoff (not held while sleeping).
function downloadWorkshopMod(workshopId, modName, serverId) {
  return withSteamLock('downloadWorkshopMod', () => _downloadWorkshopModImpl(workshopId, modName, serverId));
}
function validateSteamLogin(username, password, guardCode) {
  return withSteamLock('validateSteamLogin', () => _validateSteamLoginImpl(username, password, guardCode));
}
function updateServerApp(serverId, installDir) {
  return withSteamLock('updateServerApp', () => _updateServerAppImpl(serverId, installDir));
}
function updateWorkshopMod(serverId, installDir, modId) {
  return withSteamLock('updateWorkshopMod', () => _updateWorkshopModImpl(serverId, installDir, modId));
}

module.exports = { ensureSteamCMD, findWorkshopContent, captureWorkshopState, classifyUpdateResult, downloadWorkshopMod: downloadWorkshopModWithRetry, validateSteamLogin, updateServerApp, updateWorkshopMod: updateWorkshopModWithRetry };
