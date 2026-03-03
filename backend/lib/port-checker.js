/**
 * Port conflict detection utility.
 *
 * Checks whether specific ports are available by:
 * 1. Checking against other Citadel-managed servers in ctx.servers
 * 2. Checking system-wide via PowerShell Get-NetTCPConnection
 *
 * Exports: checkPortAvailability(ports[], currentServerId?)
 */
const { spawn } = require('child_process');
const logger = require('./logger');
const ctx = require('./context');

/**
 * Check if ports are available for a server to use.
 *
 * @param {number[]} ports - Array of port numbers to check
 * @param {string} [currentServerId] - Exclude this server from conflict checks
 *   (useful when checking ports for a server that already owns them)
 * @returns {Promise<{available: boolean, conflicts: Array<{port: number, usedBy: string, pid: number|null}>}>}
 */
async function checkPortAvailability(ports, currentServerId) {
  const conflicts = [];

  // 1. Check against other Citadel-managed servers
  for (const port of ports) {
    for (const srv of ctx.servers) {
      if (currentServerId && srv.id === currentServerId) continue;

      const state = ctx.serverStates[srv.id];
      // Only consider servers that are running or starting
      if (!state || (state.status !== 'running' && state.status !== 'starting')) continue;

      const srvPorts = [
        parseInt(srv.gamePort) || 0,
        parseInt(srv.queryPort) || 0,
        parseInt(srv.rconPort) || 0,
      ];

      if (srvPorts.includes(port)) {
        conflicts.push({
          port,
          usedBy: `Citadel server "${srv.name}"`,
          pid: state.pid || null,
        });
      }
    }
  }

  // 2. Check system-wide for ports in use via PowerShell
  const systemConflicts = await checkSystemPorts(ports);
  for (const sc of systemConflicts) {
    // Avoid duplicate if already found as a Citadel server
    const alreadyFound = conflicts.some(c => c.port === sc.port);
    if (!alreadyFound) {
      conflicts.push(sc);
    }
  }

  return {
    available: conflicts.length === 0,
    conflicts,
  };
}

/**
 * Check ports against system-wide TCP connections using PowerShell.
 * Returns an array of { port, usedBy, pid } for ports that are in use.
 *
 * @param {number[]} ports
 * @returns {Promise<Array<{port: number, usedBy: string, pid: number|null}>>}
 */
function checkSystemPorts(ports) {
  return new Promise((resolve) => {
    if (!ports || ports.length === 0) return resolve([]);

    // Build a PowerShell command that checks each port
    const portList = ports.map(p => parseInt(p, 10)).filter(p => p > 0 && p <= 65535);
    if (portList.length === 0) return resolve([]);

    // Query all listening TCP connections for the requested ports
    const psCommand = portList.map(p =>
      `Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue | Select-Object -Property LocalPort,OwningProcess | ForEach-Object { "$($_.LocalPort),$($_.OwningProcess)" }`
    ).join('; ');

    const proc = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-Command', psCommand,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    const killTimer = setTimeout(() => {
      try { proc.kill(); } catch { /* ok */ }
      resolve([]); // Fail open — if PowerShell hangs, allow the start
    }, 10000);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });

    proc.on('error', () => {
      clearTimeout(killTimer);
      logger.warn('PowerShell port check failed — skipping system port check');
      resolve([]);
    });

    proc.on('close', () => {
      clearTimeout(killTimer);
      const results = [];

      if (stdout.trim()) {
        const lines = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 2) {
            const port = parseInt(parts[0], 10);
            const pid = parseInt(parts[1], 10);
            if (port > 0 && pid > 0) {
              results.push({
                port,
                usedBy: `System process (PID: ${pid})`,
                pid,
              });
            }
          }
        }
      }

      resolve(results);
    });
  });
}

module.exports = { checkPortAvailability };
