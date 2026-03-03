/**
 * System metrics routes — host-level CPU, RAM, Disk, Network info.
 * Powers the System Dashboard (similar to CFTools Architect dashboard).
 * Also serves the structured configuration API (admin-only).
 */
const os = require('os');
const { exec } = require('child_process');
const auth = require('../middleware/auth');
const { getServiceStatus, SERVICE_NAME } = require('../lib/service-installer');
const ctx = require('../lib/context');
const logger = require('../lib/logger');

module.exports = function (app) {
  /**
   * GET /api/system/info — Static host info (CPU model, cores, total RAM, disk)
   */
  app.get('/api/system/info', auth(), async (req, res) => {
    try {
      const cpus = os.cpus();
      const info = {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        cpuModel: cpus[0]?.model || 'Unknown',
        cpuCores: cpus.length,
        totalMemoryGB: +(os.totalmem() / 1073741824).toFixed(2),
        nodeVersion: process.version,
        uptime: os.uptime(),
        processUptime: process.uptime(),
      };

      // Get disk info via PowerShell (Windows)
      try {
        const diskInfo = await getDiskInfo();
        info.disk = diskInfo;
      } catch {
        info.disk = { totalGB: 0, freeGB: 0, usedGB: 0 };
      }

      res.json(info);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get system info' });
    }
  });

  /**
   * GET /api/system/metrics — Live metrics (CPU %, memory %, network, disk I/O)
   */
  app.get('/api/system/metrics', auth(), async (req, res) => {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      const metrics = {
        cpu: await getCpuUsage(),
        memory: {
          totalGB: +(totalMem / 1073741824).toFixed(2),
          usedGB: +(usedMem / 1073741824).toFixed(2),
          freeGB: +(freeMem / 1073741824).toFixed(2),
          percent: +((usedMem / totalMem) * 100).toFixed(1),
        },
        network: await getNetworkStats(),
        timestamp: Date.now(),
      };

      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get system metrics' });
    }
  });

  /**
   * GET /api/system/service — Windows service status (admin-only).
   * Returns whether the Citadel service is installed, its state, and run mode.
   */
  app.get('/api/system/service', auth('*'), async (req, res) => {
    try {
      const status = await getServiceStatus();
      res.json({
        serviceName: SERVICE_NAME,
        ...status,
        serviceMode: ctx.isServiceMode || false,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get service status' });
    }
  });

  // ─── Configuration API ──────────────────────────────────

  /**
   * GET /api/system/config — Returns current config (admin-only, sensitive values redacted).
   * Also includes the schema so the frontend can render type-appropriate form fields,
   * and metadata about which values are locked by env overrides.
   */
  app.get('/api/system/config', auth('*'), (req, res) => {
    try {
      const CONFIG = ctx.CONFIG;
      const redacted = CONFIG._getRedacted();
      const schema = CONFIG._getSchema();
      const envOverrides = CONFIG._envOverrides || {};
      const configFileLoaded = CONFIG._configFileLoaded || false;

      res.json({
        config: redacted,
        schema,
        envOverrides,
        configFileLoaded,
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to get system config');
      res.status(500).json({ error: 'Failed to retrieve configuration' });
    }
  });

  /**
   * PATCH /api/system/config — Update config sections (admin-only).
   * Writes to citadel.config.json and hot-reloads non-destructive settings.
   * Sensitive fields and env-locked fields cannot be changed via this endpoint.
   *
   * Body: { server: { ... }, logging: { ... }, ... }
   */
  app.patch('/api/system/config', auth('*'), (req, res) => {
    try {
      const CONFIG = ctx.CONFIG;
      const updates = req.body;

      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return res.status(400).json({ error: 'Request body must be a JSON object with config sections' });
      }

      const result = CONFIG._applyUpdate(updates);

      if (!result.updated) {
        return res.json({ success: true, message: 'No fields were updated (values unchanged or locked by env)' });
      }

      logger.info({ fields: result.fields, user: req.user?.username }, 'Configuration updated via API');

      // Return the updated config (redacted)
      const redacted = CONFIG._getRedacted();

      res.json({
        success: true,
        updated: result.fields,
        needsRestart: result.needsRestart.length > 0 ? result.needsRestart : undefined,
        config: redacted,
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to update system config');
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });
};

function getCpuUsage() {
  return new Promise((resolve) => {
    const cpus1 = os.cpus();
    setTimeout(() => {
      const cpus2 = os.cpus();
      let totalIdle = 0, totalTick = 0;
      for (let i = 0; i < cpus2.length; i++) {
        const c1 = cpus1[i].times;
        const c2 = cpus2[i].times;
        const idle = c2.idle - c1.idle;
        const total = (c2.user - c1.user) + (c2.nice - c1.nice) + (c2.sys - c1.sys) + (c2.irq - c1.irq) + idle;
        totalIdle += idle;
        totalTick += total;
      }
      resolve(+((1 - totalIdle / totalTick) * 100).toFixed(1));
    }, 500);
  });
}

function getDiskInfo() {
  return new Promise((resolve, reject) => {
    exec('powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | ConvertTo-Json"', { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return reject(err);
      try {
        let drives = JSON.parse(stdout);
        if (!Array.isArray(drives)) drives = [drives];
        let totalUsed = 0, totalFree = 0;
        for (const d of drives) {
          totalUsed += d.Used || 0;
          totalFree += d.Free || 0;
        }
        const totalGB = +((totalUsed + totalFree) / 1073741824).toFixed(2);
        const usedGB = +(totalUsed / 1073741824).toFixed(2);
        const freeGB = +(totalFree / 1073741824).toFixed(2);
        resolve({ totalGB, usedGB, freeGB, drives: drives.map(d => ({ name: d.Name, usedGB: +((d.Used || 0) / 1073741824).toFixed(2), freeGB: +((d.Free || 0) / 1073741824).toFixed(2) })) });
      } catch {
        reject(new Error('Failed to parse disk info'));
      }
    });
  });
}

function getNetworkStats() {
  return new Promise((resolve) => {
    const interfaces = os.networkInterfaces();
    const active = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
      if (ipv4) active.push({ name, address: ipv4.address });
    }
    resolve({ interfaces: active, ip: active[0]?.address || '127.0.0.1' });
  });
}
