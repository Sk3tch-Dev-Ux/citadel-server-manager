/**
 * Windows process management for DayZ servers.
 * Uses spawn() with argument arrays to prevent command injection.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

// Guards to prevent overlapping spawns (one per executable/pid)
const _pendingDetect = new Set();
const _pendingMetrics = new Set();

function detectRunningProcess(executable) {
  if (_pendingDetect.has(executable)) return Promise.resolve(null);
  _pendingDetect.add(executable);
  return new Promise((resolve) => {
    const proc = spawn('tasklist', ['/FI', `IMAGENAME eq ${executable}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 5000);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('error', () => { clearTimeout(killTimer); _pendingDetect.delete(executable); resolve(null); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      _pendingDetect.delete(executable);
      if (!stdout) return resolve(null);
      const lines = stdout.trim().split('\n').filter(l => l.includes(executable));
      if (lines.length > 0) {
        const match = lines[0].match(/"[^"]+","(\d+)"/);
        return resolve(match ? parseInt(match[1]) : null);
      }
      resolve(null);
    });
  });
}

function getProcessMetrics(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(null);
    const safePid = parseInt(pid, 10);
    if (isNaN(safePid) || safePid <= 0) return resolve(null);
    if (_pendingMetrics.has(safePid)) return resolve(null);
    _pendingMetrics.add(safePid);
    // Use PowerShell Get-Process (wmic is deprecated/removed on Win 11)
    const cmd = `$p = Get-Process -Id ${safePid} -ErrorAction Stop; "{0},{1},{2}" -f $p.WorkingSet64,$p.PrivilegedProcessorTime.Ticks,$p.UserProcessorTime.Ticks`;
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 5000);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('error', () => { clearTimeout(killTimer); _pendingMetrics.delete(safePid); resolve(null); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      _pendingMetrics.delete(safePid);
      if (!stdout) return resolve(null);
      const parts = stdout.trim().split(',');
      if (parts.length < 3) return resolve(null);
      const workingSet = parseInt(parts[0]) || 0;
      const ramMB = Math.round(workingSet / (1024 * 1024));
      const totalMem = require('os').totalmem();
      const ramPct = totalMem > 0 ? Math.round((workingSet / totalMem) * 1000) / 10 : 0;
      resolve({ cpu: 0, ram: ramPct, ramMB });
    });
  });
}

// Delta-based CPU sampling using PowerShell Get-Process
let _lastCpuSamples = {};
function getProcessCPU(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(0);
    const safePid = parseInt(pid, 10);
    if (isNaN(safePid) || safePid <= 0) return resolve(0);
    const cmd = `$p = Get-Process -Id ${safePid} -ErrorAction Stop; "{0},{1}" -f $p.PrivilegedProcessorTime.Ticks,$p.UserProcessorTime.Ticks`;
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 3000);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('error', () => { clearTimeout(killTimer); resolve(0); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      if (!stdout) return resolve(0);
      const parts = stdout.trim().split(',');
      if (parts.length < 2) return resolve(0);
      const kernelTicks = parseInt(parts[0]) || 0;
      const userTicks = parseInt(parts[1]) || 0;
      const totalTime = kernelTicks + userTicks; // in 100-nanosecond ticks
      const now = Date.now();
      const prev = _lastCpuSamples[safePid];
      _lastCpuSamples[safePid] = { totalTime, timestamp: now };
      if (!prev) return resolve(0);
      const timeDelta = (now - prev.timestamp) / 1000; // seconds
      if (timeDelta <= 0) return resolve(0);
      const cpuDelta = (totalTime - prev.totalTime) / 10000000; // convert 100ns ticks to seconds
      const cpuCores = require('os').cpus().length || 1;
      const cpuPct = Math.round((cpuDelta / timeDelta / cpuCores) * 1000) / 10;
      resolve(Math.max(0, Math.min(100, cpuPct)));
    });
  });
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

  logger.info({ server: serverConfig.name, executable: execPath, params }, 'Spawning server process');
  const child = spawn(execPath, params, { cwd: installDir, detached: true, stdio: 'ignore' });
  child.unref();

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

    // If still alive after 10s, consider the launch not-failed
    setTimeout(() => settle(null), 10000);
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
    const proc = spawn('tasklist', ['/FI', `PID eq ${safePid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 5000);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('error', () => { clearTimeout(killTimer); resolve(false); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      // tasklist returns "INFO: No tasks are running..." when PID not found
      resolve(stdout.includes(String(safePid)));
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
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 5000);
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
