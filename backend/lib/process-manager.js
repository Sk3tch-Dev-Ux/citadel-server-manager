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

function spawnDayZServer(serverConfig) {
  const installDir = serverConfig.installDir;
  let child;
  if (serverConfig.startBat) {
    const batPath = path.join(installDir, serverConfig.startBat);
    if (!fs.existsSync(batPath)) throw new Error(`Start batch file not found: ${batPath}`);
    child = spawn('cmd.exe', ['/c', batPath], {
      cwd: installDir, detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.unref();
  } else {
    const execPath = path.join(installDir, serverConfig.executable);
    const params = (serverConfig.launchParams || '').split(' ').filter(Boolean);
    if (!fs.existsSync(execPath)) throw new Error(`Executable not found: ${execPath}`);
    child = spawn(execPath, params, { cwd: installDir, detached: true, stdio: 'ignore' });
    child.unref();
  }
  if (child && child.pid) {
    applyProcessSettings(child.pid, serverConfig);
  }
  return child;
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
  getProcessMetrics,
  getProcessCPU,
  killProcess,
  spawnDayZServer,
  applyProcessSettings,
};
