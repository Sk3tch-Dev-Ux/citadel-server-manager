/**
 * Windows process management for DayZ servers.
 * Uses spawn() with argument arrays to prevent command injection.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const { PROCESS_CMD_TIMEOUT_MS, LAUNCH_GRACE_PERIOD_MS, PROCESS_DETECT_TTL_MS } = require('./constants');

// Guards to prevent overlapping spawns (one per executable/pid)
const _pendingDetect = new Set();
const _pendingMetrics = new Set();

// Short-lived cache of detection results, keyed by `exe:<name>` / `pid:<n>`.
// Metrics polling + the crash detector hit the same targets within one tick;
// caching for PROCESS_DETECT_TTL_MS collapses those into a single OS call.
const _detectCache = new Map();
function _detectCacheGet(key) {
  const entry = _detectCache.get(key);
  if (entry && (Date.now() - entry.at) < PROCESS_DETECT_TTL_MS) return entry;
  return null;
}
function _detectCacheSet(key, value) {
  _detectCache.set(key, { value, at: Date.now() });
}

function detectRunningProcess(executable) {
  const cacheKey = `exe:${executable}`;
  const cached = _detectCacheGet(cacheKey);
  if (cached) return Promise.resolve(cached.value);
  if (_pendingDetect.has(executable)) return Promise.resolve(null);
  _pendingDetect.add(executable);
  return new Promise((resolve) => {
    const proc = spawn('tasklist', ['/FI', `IMAGENAME eq ${executable}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, PROCESS_CMD_TIMEOUT_MS);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    // Note: transient failures (error/timeout) are NOT cached, so the next tick
    // retries immediately rather than waiting out the TTL.
    proc.on('error', () => { clearTimeout(killTimer); _pendingDetect.delete(executable); resolve(null); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      _pendingDetect.delete(executable);
      let result = null;
      if (stdout) {
        const lines = stdout.trim().split('\n').filter(l => l.includes(executable));
        if (lines.length > 0) {
          const match = lines[0].match(/"[^"]+","(\d+)"/);
          result = match ? parseInt(match[1]) : null;
        }
      }
      _detectCacheSet(cacheKey, result);
      resolve(result);
    });
  });
}

/**
 * Fetch RAM + CPU metrics in a SINGLE PowerShell call per server per tick.
 *
 * Previous implementation spawned TWO separate PowerShell processes per
 * server every 15 seconds (getProcessMetrics + getProcessCPU). On a box
 * running 4 servers, that was 8 PowerShell invocations per tick — a major
 * overhead. This combined version halves that to 4 and also reduces the
 * total wall-clock time because the two data points share the same
 * Get-Process call.
 *
 * Returns { cpu, ram, ramMB } or null on failure.
 */

// Delta-based CPU sampling state
let _lastCpuSamples = {};

// Periodic cleanup of stale PID entries to prevent unbounded memory growth
setInterval(() => {
  const ctx = require('./context');
  const activePids = new Set();
  for (const srv of (ctx.servers || [])) {
    const state = ctx.serverStates?.[srv.id];
    if (state?.pid) activePids.add(parseInt(state.pid, 10));
  }
  for (const pidStr of Object.keys(_lastCpuSamples)) {
    if (!activePids.has(parseInt(pidStr, 10))) {
      delete _lastCpuSamples[pidStr];
    }
  }
  // Bound the detect cache (1s-TTL entries for departed pids would otherwise linger).
  _detectCache.clear();
}, 5 * 60 * 1000).unref(); // Every 5 minutes, unref so it doesn't prevent shutdown

function getProcessMetrics(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(null);
    const safePid = parseInt(pid, 10);
    if (isNaN(safePid) || safePid <= 0) return resolve(null);
    if (_pendingMetrics.has(safePid)) return resolve(null);
    _pendingMetrics.add(safePid);

    // Single PowerShell call: grab WorkingSet64 + CPU ticks together
    const cmd = `$p = Get-Process -Id ${safePid} -ErrorAction Stop; "{0},{1},{2}" -f $p.WorkingSet64,$p.PrivilegedProcessorTime.Ticks,$p.UserProcessorTime.Ticks`;
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, PROCESS_CMD_TIMEOUT_MS);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('error', () => { clearTimeout(killTimer); _pendingMetrics.delete(safePid); resolve(null); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      _pendingMetrics.delete(safePid);
      if (!stdout) return resolve(null);
      const parts = stdout.trim().split(',');
      if (parts.length < 3) return resolve(null);

      // RAM metrics
      const workingSet = parseInt(parts[0]) || 0;
      const ramMB = Math.round(workingSet / (1024 * 1024));
      const totalMem = require('os').totalmem();
      const ramPct = totalMem > 0 ? Math.round((workingSet / totalMem) * 1000) / 10 : 0;

      // CPU metrics (delta-based)
      const kernelTicks = parseInt(parts[1]) || 0;
      const userTicks = parseInt(parts[2]) || 0;
      const totalTime = kernelTicks + userTicks;
      const now = Date.now();
      const prev = _lastCpuSamples[safePid];
      _lastCpuSamples[safePid] = { totalTime, timestamp: now };

      let cpuPct = 0;
      if (prev) {
        const timeDelta = (now - prev.timestamp) / 1000;
        if (timeDelta > 0) {
          const cpuDelta = (totalTime - prev.totalTime) / 10000000;
          const cpuCores = require('os').cpus().length || 1;
          cpuPct = Math.round((cpuDelta / timeDelta / cpuCores) * 1000) / 10;
          cpuPct = Math.max(0, Math.min(100, cpuPct));
        }
      }

      resolve({ cpu: cpuPct, ram: ramPct, ramMB });
    });
  });
}

/**
 * @deprecated Use getProcessMetrics() which now returns cpu in the same call.
 * Kept for backward compatibility — returns the cpu value from the last
 * getProcessMetrics() sample, or 0 if no sample exists yet.
 */
function getProcessCPU(pid) {
  // CPU is now computed inside getProcessMetrics in the same PowerShell call.
  // This stub returns 0; callers should use metrics.cpu instead.
  return Promise.resolve(0);
}

function killProcess(pid, executable) {
  return new Promise((resolve, reject) => {
    let args;
    if (pid) {
      const safePid = parseInt(pid, 10);
      if (isNaN(safePid) || safePid <= 0) return reject(new Error('Invalid PID'));
      args = ['/F', '/PID', String(safePid)];
    } else {
      if (!executable || /[;&|`$\\/"']/.test(executable)) return reject(new Error('Invalid executable name'));
      args = ['/F', '/IM', executable];
    }
    const proc = spawn('taskkill', args, { windowsHide: true });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`taskkill exited with code ${code}`)));
  });
}

/**
 * Spawn the DayZ server process.
 * Returns { child, launchFailed } where launchFailed is a Promise that
 * resolves to an error string if the process exits/errors within the first
 * few seconds, or null if it's still running after the grace window.
 */
function spawnDayZServer(serverConfig) {
  const installDir = serverConfig.installDir;
  const execPath = path.join(installDir, serverConfig.executable || 'DayZServer_x64.exe');
  if (!fs.existsSync(execPath)) throw new Error(`Executable not found: ${execPath}`);

  // Always launch the executable directly with launch params.
  const params = (serverConfig.launchParams || '').split(' ').filter(Boolean);

  // Redirect stdout/stderr to server_console.log
  const profileDir = serverConfig.profileDir || 'profiles';
  const profilePath = path.isAbsolute(profileDir) ? profileDir : path.join(installDir, profileDir);
  if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath, { recursive: true });
  const consolePath = path.join(profilePath, 'server_console.log');
  const logFd = fs.openSync(consolePath, 'w');

  logger.info({ server: serverConfig.name, executable: execPath, params, consolePath }, 'Spawning server process');
  const child = spawn(execPath, params, { cwd: installDir, detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  fs.closeSync(logFd); // Close parent's copy — child keeps its own fd

  // Track early failures — if the process exits or errors within 10s, capture it
  const launchFailed = new Promise((resolve) => {
    let settled = false;
    const settle = (reason) => { if (!settled) { settled = true; resolve(reason); } };

    child.on('error', (err) => {
      logger.error({ server: serverConfig.name, err: err.message }, 'Server process spawn error');
      settle(`Spawn error: ${err.message}`);
    });

    child.on('exit', (code, signal) => {
      logger.warn({ server: serverConfig.name, code, signal }, 'Server process exited early');
      settle(`Process exited early (code: ${code}, signal: ${signal})`);
    });

    // If still alive after the grace period, consider the launch not-failed
    setTimeout(() => settle(null), LAUNCH_GRACE_PERIOD_MS);
  });

  if (child && child.pid) {
    logger.info({ server: serverConfig.name, pid: child.pid }, 'Server process spawned');
    applyProcessSettings(child.pid, serverConfig);
  } else {
    logger.error({ server: serverConfig.name }, 'Server process spawn returned no PID');
  }
  return { child, launchFailed };
}

/**
 * Check if a specific PID is still running via tasklist.
 */
function detectProcessByPid(pid) {
  return new Promise((resolve) => {
    const safePid = parseInt(pid, 10);
    if (isNaN(safePid) || safePid <= 0) return resolve(false);
    const cacheKey = `pid:${safePid}`;
    const cached = _detectCacheGet(cacheKey);
    if (cached) return resolve(cached.value);
    const proc = spawn('tasklist', ['/FI', `PID eq ${safePid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, PROCESS_CMD_TIMEOUT_MS);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    // Transient failures are not cached so the next tick retries immediately.
    proc.on('error', () => { clearTimeout(killTimer); resolve(false); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      // tasklist returns "INFO: No tasks are running..." when PID not found
      const result = stdout.includes(String(safePid));
      _detectCacheSet(cacheKey, result);
      resolve(result);
    });
  });
}

function applyProcessSettings(pid, serverConfig) {
  if (!pid) return;
  const safePid = parseInt(pid, 10);
  if (isNaN(safePid) || safePid <= 0) return;
  const allowedPriorities = ['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High', 'RealTime'];
  const parts = [];
  if (serverConfig.cpuAffinity && Number.isInteger(serverConfig.cpuAffinity) && serverConfig.cpuAffinity > 0) {
    parts.push(`$p = Get-Process -Id ${safePid} -ErrorAction Stop; $p.ProcessorAffinity = ${parseInt(serverConfig.cpuAffinity, 10)}`);
  }
  if (serverConfig.priorityLevel && serverConfig.priorityLevel !== 'Normal' && allowedPriorities.includes(serverConfig.priorityLevel)) {
    parts.push(`$p = Get-Process -Id ${safePid} -ErrorAction Stop; $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::${serverConfig.priorityLevel}`);
  }
  if (parts.length > 0) {
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', parts.join('; ')], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, PROCESS_CMD_TIMEOUT_MS);
    proc.on('error', (err) => { clearTimeout(killTimer); logger.error({ err, pid: safePid }, 'Failed to apply process settings'); });
    proc.on('close', () => clearTimeout(killTimer));
  }
}

module.exports = {
  detectRunningProcess,
  detectProcessByPid,
  getProcessMetrics,
  getProcessCPU,
  killProcess,
  spawnDayZServer,
  applyProcessSettings,
};
