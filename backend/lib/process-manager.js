/**
 * Windows process management for DayZ servers.
 * Uses spawn() with argument arrays to prevent command injection.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

function detectRunningProcess(executable) {
  return new Promise((resolve) => {
    const proc = spawn('tasklist', ['/FI', `IMAGENAME eq ${executable}`, '/FO', 'CSV', '/NH'], { windowsHide: true });
    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
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
    const psScript = `try { $p = Get-Process -Id ${safePid} -ErrorAction Stop; $cpuCores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum; if (-not $cpuCores) { $cpuCores = [Environment]::ProcessorCount }; $totalMem = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory; $ws = $p.WorkingSet64; $cpu = 0; try { $sample1 = $p.TotalProcessorTime.TotalMilliseconds; Start-Sleep -Milliseconds 500; $p.Refresh(); $sample2 = $p.TotalProcessorTime.TotalMilliseconds; $cpu = [math]::Round(($sample2 - $sample1) / 500 * 100 / $cpuCores, 1) } catch { $cpu = 0 }; $ramPct = [math]::Round($ws / $totalMem * 100, 1); Write-Output "CPU=$cpu,RAM=$ramPct,RAMMB=$([math]::Round($ws/1MB))" } catch { Write-Output 'ERROR' }`;
    const proc = spawn('powershell', ['-NoProfile', '-Command', psScript], { windowsHide: true, timeout: 8000 });
    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      if (!stdout || stdout.trim() === 'ERROR') return resolve(null);
      const output = stdout.trim();
      const cpuMatch = output.match(/CPU=([\d.]+)/);
      const ramMatch = output.match(/RAM=([\d.]+)/);
      const ramMBMatch = output.match(/RAMMB=(\d+)/);
      resolve({
        cpu: cpuMatch ? parseFloat(cpuMatch[1]) : 0,
        ram: ramMatch ? parseFloat(ramMatch[1]) : 0,
        ramMB: ramMBMatch ? parseInt(ramMBMatch[1]) : 0,
      });
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
    const proc = spawn('powershell', ['-NoProfile', '-Command', parts.join('; ')], { windowsHide: true, timeout: 5000 });
    proc.on('error', (err) => logger.error({ err, pid: safePid }, 'Failed to apply process settings'));
  }
}

module.exports = {
  detectRunningProcess,
  getProcessMetrics,
  killProcess,
  spawnDayZServer,
  applyProcessSettings,
};
