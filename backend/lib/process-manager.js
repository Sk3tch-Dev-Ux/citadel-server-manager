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
    // Use wmic for lightweight metrics (no visible window, faster than PowerShell)
    const proc = spawn('wmic', [
      'process', 'where', `ProcessId=${safePid}`,
      'get', 'WorkingSetSize,KernelModeTime,UserModeTime', '/format:csv',
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 5000);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('error', () => { clearTimeout(killTimer); _pendingMetrics.delete(safePid); resolve(null); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      _pendingMetrics.delete(safePid);
      if (!stdout) return resolve(null);
      const lines = stdout.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'));
      if (lines.length < 1) return resolve(null);
      // CSV format: Node,KernelModeTime,UserModeTime,WorkingSetSize
      const parts = lines[lines.length - 1].split(',');
      if (parts.length < 4) return resolve(null);
      const workingSet = parseInt(parts[3]) || 0;
      const ramMB = Math.round(workingSet / (1024 * 1024));
      // Estimate CPU from kernel+user time (delta between polls is handled by metrics history)
      // For now use wmic percentage from a separate quick call, or approximate from working set
      const totalMem = require('os').totalmem();
      const ramPct = totalMem > 0 ? Math.round((workingSet / totalMem) * 1000) / 10 : 0;
      resolve({ cpu: 0, ram: ramPct, ramMB });
    });
  });
}

// Separate lightweight CPU sampling using wmic (called less frequently)
let _lastCpuSamples = {};
function getProcessCPU(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(0);
    const safePid = parseInt(pid, 10);
    if (isNaN(safePid) || safePid <= 0) return resolve(0);
    const proc = spawn('wmic', [
      'process', 'where', `ProcessId=${safePid}`,
      'get', 'KernelModeTime,UserModeTime', '/format:csv',
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 3000);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('error', () => { clearTimeout(killTimer); resolve(0); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      if (!stdout) return resolve(0);
      const lines = stdout.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'));
      if (lines.length < 1) return resolve(0);
      const parts = lines[lines.length - 1].split(',');
      if (parts.length < 3) return resolve(0);
      const kernelTime = parseInt(parts[1]) || 0;
      const userTime = parseInt(parts[2]) || 0;
      const totalTime = kernelTime + userTime; // in 100-nanosecond intervals
      const now = Date.now();
      const prev = _lastCpuSamples[safePid];
      _lastCpuSamples[safePid] = { totalTime, timestamp: now };
      if (!prev) return resolve(0);
      const timeDelta = (now - prev.timestamp) / 1000; // seconds
      if (timeDelta <= 0) return resolve(0);
      const cpuDelta = (totalTime - prev.totalTime) / 10000000; // convert 100ns to seconds
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

  // Always launch the executable directly — never use batch files.
  // Batch files often contain their own restart loops (goto :start)
  // which conflict with the panel's own lifecycle management.
  const params = (serverConfig.launchParams || '').split(' ').filter(Boolean);

  // If there's a startBat, try to extract launch params from it
  // so we capture any mod lists or custom flags the user configured
  if (serverConfig.startBat) {
    const batPath = path.join(installDir, serverConfig.startBat);
    if (fs.existsSync(batPath)) {
      const extracted = extractBatParams(batPath, serverConfig.executable || 'DayZServer_x64.exe');
      if (extracted && extracted.length > 0) {
        // Use bat params if they contain more detail (e.g. mod lists)
        logger.info({ server: serverConfig.name, params: extracted }, 'Using launch params extracted from batch file');
        params.length = 0;
        params.push(...extracted);
      }
    }
  }

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

/**
 * Extract launch parameters from a .bat file by finding the line that
 * launches the server executable and parsing out its arguments.
 */
function extractBatParams(batPath, executable) {
  try {
    const content = fs.readFileSync(batPath, 'utf8');
    const exeName = executable.replace(/\.exe$/i, '');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip comments, empty lines, and kill/management commands
      if (!trimmed || trimmed.startsWith('::') || trimmed.startsWith('REM ')) continue;
      if (/^(taskkill|timeout|goto|title|cd|echo|set)\b/i.test(trimmed)) continue;
      // Look for lines that reference the executable (start command or direct invocation)
      if (trimmed.toLowerCase().includes(exeName.toLowerCase())) {
        // Extract everything after the executable reference
        // Handle: start "title" /min "DayZServer_x64.exe" -config=... -mod=...
        // Handle: DayZServer_x64.exe -config=... -mod=...
        const exePattern = new RegExp(`["']?${exeName}(?:\\.exe)?["']?\\s+(.+)`, 'i');
        const match = trimmed.match(exePattern);
        if (match) {
          // Parse the params, respecting quoted strings
          const paramStr = match[1].trim();
          const params = [];
          let current = '';
          let inQuotes = false;
          for (let i = 0; i < paramStr.length; i++) {
            const ch = paramStr[i];
            if (ch === '"') { inQuotes = !inQuotes; current += ch; }
            else if (ch === ' ' && !inQuotes) {
              if (current) { params.push(current); current = ''; }
            } else { current += ch; }
          }
          if (current) params.push(current);
          // Resolve batch variables like %serverConfig%, %serverPort%, etc.
          const vars = {};
          for (const vLine of content.split('\n')) {
            const setMatch = vLine.trim().match(/^set\s+(\w+)\s*=\s*(.+)/i);
            if (setMatch) vars[setMatch[1].toLowerCase()] = setMatch[2].trim().replace(/^"(.*)"$/, '$1');
          }
          return params.map(p => p.replace(/%(\w+)%/g, (_, name) => vars[name.toLowerCase()] || `%${name}%`));
        }
      }
    }
  } catch (err) {
    logger.warn({ err, batPath }, 'Failed to parse batch file for launch params');
  }
  return null;
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
