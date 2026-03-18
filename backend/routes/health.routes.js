/**
 * Health Check Routes — Enterprise-grade health diagnostics
 *
 * GET /api/health — Comprehensive health report (public, no auth required)
 * GET /api/health/ping — Ultra-lightweight health check (public, no auth required)
 *
 * Used by:
 *   - Load balancers / orchestrators (Kubernetes, Docker Compose, etc.)
 *   - Uptime monitoring services (Datadog, Pingdom, New Relic, etc.)
 *   - Internal dashboards and status pages
 *
 * No authentication required — returns minimal exposed data (no credentials, no paths).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ctx = require('../lib/context');
const logger = require('../lib/logger');
const { isLicensed } = require('../lib/license');

/**
 * Application version (from package.json)
 */
const APP_VERSION = '2.0.0';

/**
 * Server startup timestamp (recorded at first module load)
 */
const STARTUP_TIME = Date.now();

module.exports = function (app) {
  /**
   * GET /api/health/ping — Ultra-lightweight health check
   *
   * Response: { status: "ok", timestamp: "..." }
   * Size: ~50 bytes
   * Use case: Simple uptime monitors, load balancer health checks
   */
  app.get('/api/health/ping', (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/health — Comprehensive health diagnostics
   *
   * Performs health checks across all critical subsystems:
   *   - License status
   *   - Configured servers (online/offline count)
   *   - Disk space (free/used/total)
   *   - RCON connectivity
   *   - Recent backups
   *   - Pending mod updates
   *   - SteamCMD installation
   *   - Memory usage
   *
   * Overall status:
   *   - "healthy": all checks pass
   *   - "degraded": any check in "warn" state
   *   - "unhealthy": any check in "fail" state
   *
   * No authentication required. Does not expose sensitive data (no creds, no paths).
   */
  app.get('/api/health', async (req, res) => {
    try {
      const timestamp = new Date().toISOString();
      const uptime = Math.floor((Date.now() - STARTUP_TIME) / 1000);

      // ─── Run all checks in parallel (non-blocking) ──────────────
      const [
        licenseCheck,
        serversCheck,
        diskCheck,
        rconCheck,
        backupCheck,
        modUpdatesCheck,
        steamcmdCheck,
        memoryCheck,
      ] = await Promise.all([
        performLicenseCheck(),
        performServersCheck(),
        performDiskCheck(),
        performRconCheck(),
        performBackupCheck(),
        performModUpdatesCheck(),
        performSteamcmdCheck(),
        performMemoryCheck(),
      ]);

      // ─── Aggregate status from all checks ───────────────────────
      const checks = {
        license: licenseCheck,
        servers: serversCheck,
        disk: diskCheck,
        rcon: rconCheck,
        lastBackup: backupCheck,
        modUpdates: modUpdatesCheck,
        steamcmd: steamcmdCheck,
        memory: memoryCheck,
      };

      const overallStatus = calculateOverallStatus(checks);

      // ─── Build response ────────────────────────────────────────
      const response = {
        status: overallStatus,
        version: APP_VERSION,
        uptime,
        timestamp,
        checks,
      };

      const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
      res.status(statusCode).json(response);
    } catch (err) {
      logger.error({ err }, 'Health check failed unexpectedly');
      res.status(500).json({
        status: 'unhealthy',
        version: APP_VERSION,
        uptime: Math.floor((Date.now() - STARTUP_TIME) / 1000),
        timestamp: new Date().toISOString(),
        error: 'Internal error during health check',
      });
    }
  });
};

/**
 * Check license status (pass/fail)
 */
async function performLicenseCheck() {
  try {
    const licensed = isLicensed();
    return {
      status: licensed ? 'pass' : 'fail',
      licensed,
      message: licensed
        ? 'Valid license active'
        : 'Running unlicensed — upgrade at citadel.cc',
    };
  } catch (err) {
    logger.debug({ err }, 'License check error');
    return {
      status: 'fail',
      licensed: false,
      message: 'License check failed',
    };
  }
}

/**
 * Check server online/offline status
 */
async function performServersCheck() {
  try {
    const servers = ctx.servers || [];
    const states = ctx.serverStates || {};

    const online = servers.filter(srv => {
      const state = states[srv.id];
      return state?.status === 'running';
    });

    const details = servers.map(srv => {
      const state = states[srv.id];
      const status = state?.status === 'running' ? 'online' : 'offline';
      return {
        id: srv.id,
        name: srv.name,
        status,
        players: state?.players?.length || 0,
        maxPlayers: srv.maxPlayers || 60,
      };
    });

    const offline = servers.length - online.length;
    const checkStatus =
      servers.length === 0 ? 'warn' : offline === 0 ? 'pass' : offline > servers.length / 2 ? 'fail' : 'warn';

    return {
      status: checkStatus,
      total: servers.length,
      online: online.length,
      offline,
      details,
    };
  } catch (err) {
    logger.debug({ err }, 'Servers check error');
    return {
      status: 'fail',
      total: 0,
      online: 0,
      offline: 0,
      details: [],
    };
  }
}

/**
 * Check disk space (free/used/total)
 * Uses platform-specific commands to avoid npm dependencies.
 */
async function performDiskCheck() {
  try {
    const diskInfo = await getDiskInfoCrossPlatform();

    if (!diskInfo) {
      return {
        status: 'fail',
        freeGB: null,
        totalGB: null,
        usedPercent: null,
        message: 'Unable to determine disk space',
      };
    }

    const { freeGB, totalGB, usedPercent } = diskInfo;

    let status = 'pass';
    let message = 'OK';

    // Warn: <10GB free
    if (freeGB < 10) {
      status = 'warn';
      message = 'Low disk space';
    }
    // Fail: <2GB free
    if (freeGB < 2) {
      status = 'fail';
      message = 'Critical disk space';
    }

    return {
      status,
      freeGB: +freeGB.toFixed(2),
      totalGB: +totalGB.toFixed(2),
      usedPercent: +usedPercent.toFixed(1),
      message,
    };
  } catch (err) {
    logger.debug({ err }, 'Disk check error');
    return {
      status: 'fail',
      freeGB: null,
      totalGB: null,
      usedPercent: null,
      message: 'Disk check failed',
    };
  }
}

/**
 * Check RCON connectivity to servers
 */
async function performRconCheck() {
  try {
    const servers = ctx.servers || [];
    const states = ctx.serverStates || {};

    let connected = 0;
    for (const srv of servers) {
      const state = states[srv.id];
      if (state?.rcon?.loggedIn) {
        connected++;
      }
    }

    const status = servers.length === 0 ? 'warn' : connected === servers.length ? 'pass' : 'warn';

    return {
      status,
      connectedServers: connected,
      totalServers: servers.length,
    };
  } catch (err) {
    logger.debug({ err }, 'RCON check error');
    return {
      status: 'fail',
      connectedServers: 0,
      totalServers: 0,
    };
  }
}

/**
 * Check backup freshness (from backup-config files)
 */
async function performBackupCheck() {
  try {
    const dataDir = ctx.CONFIG?.dataDir;
    if (!dataDir) {
      return {
        status: 'fail',
        timestamp: null,
        ageHours: null,
        message: 'Data directory not configured',
      };
    }

    // Find the most recent backup timestamp across all servers
    let latestBackupTime = null;
    const backupFiles = fs.readdirSync(dataDir).filter(f => f.startsWith('backup-') && f.endsWith('.json'));

    for (const file of backupFiles) {
      try {
        const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
        const config = JSON.parse(content);
        if (config.lastBackupAt) {
          const time = new Date(config.lastBackupAt).getTime();
          if (!latestBackupTime || time > latestBackupTime) {
            latestBackupTime = time;
          }
        }
      } catch {
        // Skip malformed backup config files
      }
    }

    if (!latestBackupTime) {
      return {
        status: 'fail',
        timestamp: null,
        ageHours: null,
        message: 'No backup found',
      };
    }

    const ageMs = Date.now() - latestBackupTime;
    const ageHours = +(ageMs / 3600000).toFixed(1);

    let status = 'pass';
    let message = 'Recent backup';

    // Warn: >24h old
    if (ageHours > 24) {
      status = 'warn';
      message = `Backup stale (${ageHours.toFixed(1)}h old)`;
    }
    // Fail: >72h old
    if (ageHours > 72) {
      status = 'fail';
      message = `Backup very stale (${ageHours.toFixed(1)}h old)`;
    }

    return {
      status,
      timestamp: new Date(latestBackupTime).toISOString(),
      ageHours,
      message,
    };
  } catch (err) {
    logger.debug({ err }, 'Backup check error');
    return {
      status: 'fail',
      timestamp: null,
      ageHours: null,
      message: 'Backup check failed',
    };
  }
}

/**
 * Check for pending mod updates
 */
async function performModUpdatesCheck() {
  try {
    const servers = ctx.servers || [];
    const states = ctx.serverStates || {};

    let pendingUpdates = 0;
    for (const srv of servers) {
      const state = states[srv.id];
      if (state?.modUpdates && state.modUpdates.length > 0) {
        pendingUpdates += state.modUpdates.length;
      }
    }

    return {
      status: 'pass',
      pendingUpdates,
      lastCheck: new Date().toISOString(),
    };
  } catch (err) {
    logger.debug({ err }, 'Mod updates check error');
    return {
      status: 'pass',
      pendingUpdates: 0,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Check SteamCMD installation status
 */
async function performSteamcmdCheck() {
  try {
    const steamCmdPath = ctx.steamCmdPath || ctx.CONFIG?.steam?.cmdPath;

    // Windows
    if (process.platform === 'win32') {
      const installed = steamCmdPath && fs.existsSync(steamCmdPath);
      return {
        status: installed ? 'pass' : 'fail',
        installed,
        path: installed ? undefined : undefined, // Don't expose path publicly
      };
    }

    // Linux/Mac: check if steamcmd is in PATH
    if (process.platform === 'linux' || process.platform === 'darwin') {
      const installed = await checkCommandExists('steamcmd');
      return {
        status: installed ? 'pass' : 'fail',
        installed,
      };
    }

    return {
      status: 'fail',
      installed: false,
    };
  } catch (err) {
    logger.debug({ err }, 'SteamCMD check error');
    return {
      status: 'fail',
      installed: false,
    };
  }
}

/**
 * Check Node.js memory usage
 */
async function performMemoryCheck() {
  try {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    const usedPercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);

    let status = 'pass';
    // Warn: >80% heap used
    if (usedPercent > 80) {
      status = 'warn';
    }
    // Fail: >95% heap used
    if (usedPercent > 95) {
      status = 'fail';
    }

    return {
      status,
      heapUsedMB,
      heapTotalMB,
      rssMB,
      usedPercent,
    };
  } catch (err) {
    logger.debug({ err }, 'Memory check error');
    return {
      status: 'fail',
      heapUsedMB: null,
      heapTotalMB: null,
      rssMB: null,
      usedPercent: null,
    };
  }
}

/**
 * Get disk space information (cross-platform)
 * Windows: Uses PowerShell Get-PSDrive
 * Linux/Mac: Uses df -k
 *
 * @returns { freeGB, totalGB, usedPercent } or null if unable to determine
 */
function getDiskInfoCrossPlatform() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Windows: PowerShell Get-PSDrive
      exec(
        'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | ConvertTo-Json"',
        { timeout: 5000, windowsHide: true },
        (err, stdout) => {
          if (err) {
            logger.debug({ err }, 'PowerShell disk check failed');
            resolve(null);
            return;
          }
          try {
            let drives = JSON.parse(stdout);
            if (!Array.isArray(drives)) drives = [drives];

            let totalUsed = 0;
            let totalFree = 0;
            for (const d of drives) {
              totalUsed += d.Used || 0;
              totalFree += d.Free || 0;
            }

            const totalGB = (totalUsed + totalFree) / 1073741824;
            const usedPercent = (totalUsed / (totalUsed + totalFree)) * 100;
            const freeGB = totalFree / 1073741824;

            resolve({ freeGB, totalGB, usedPercent });
          } catch {
            logger.debug('Failed to parse PowerShell disk output');
            resolve(null);
          }
        }
      );
    } else {
      // Linux/Mac: df -k /
      exec('df -k / 2>/dev/null || df -k .', { timeout: 5000 }, (err, stdout) => {
        if (err) {
          logger.debug({ err }, 'df disk check failed');
          resolve(null);
          return;
        }
        try {
          const lines = stdout.trim().split('\n');
          if (lines.length < 2) {
            resolve(null);
            return;
          }

          // Parse: Filesystem 1K-blocks Used Avail Use% Mounted
          const parts = lines[1].split(/\s+/);
          if (parts.length < 4) {
            resolve(null);
            return;
          }

          const totalKB = parseInt(parts[1], 10);
          const usedKB = parseInt(parts[2], 10);
          const freeKB = parseInt(parts[3], 10);

          const totalGB = totalKB / 1048576;
          const freeGB = freeKB / 1048576;
          const usedPercent = (usedKB / totalKB) * 100;

          resolve({ freeGB, totalGB, usedPercent });
        } catch {
          logger.debug('Failed to parse df output');
          resolve(null);
        }
      });
    }
  });
}

/**
 * Check if a command exists in PATH (Linux/Mac)
 */
function checkCommandExists(cmd) {
  return new Promise((resolve) => {
    const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    exec(checkCmd, { timeout: 1000 }, (err) => {
      resolve(!err);
    });
  });
}

/**
 * Calculate overall health status from individual check results
 *
 * Rules:
 *   - "unhealthy" if any check has status === "fail"
 *   - "degraded" if any check has status === "warn"
 *   - "healthy" if all checks have status === "pass" or "info"
 */
function calculateOverallStatus(checks) {
  for (const check of Object.values(checks)) {
    if (check?.status === 'fail') {
      return 'unhealthy';
    }
  }

  for (const check of Object.values(checks)) {
    if (check?.status === 'warn') {
      return 'degraded';
    }
  }

  return 'healthy';
}
