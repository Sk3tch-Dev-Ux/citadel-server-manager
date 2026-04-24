/**
 * System metrics sampler — runs in the background to build a rolling
 * history of host CPU/RAM/Disk usage for the System Dashboard trend
 * view, and fires in-app notifications when thresholds are crossed.
 *
 * Design:
 *   - CPU & RAM sampled every 30s (cheap)
 *   - Disk sampled every 10 min (expensive — shells out to PowerShell)
 *   - Rolling 24h buffer (2880 samples at 30s)
 *   - Threshold alerts fire through the notifications module with a
 *     15-minute cooldown per metric so we don't spam admins when a
 *     server is pegged for an extended window
 *   - Alerts are level 'warning' so NotificationCenter pops a toast
 *     on arrival — admins see the alert even if they aren't watching
 *     the dashboard
 *
 * Not persisted to disk: a restart loses history. That's acceptable
 * for v1 — customers who care about long-term trends can wire a real
 * metrics store later.
 */
const os = require('os');
const { exec } = require('child_process');
const logger = require('./logger');

const SAMPLE_INTERVAL_MS = 30 * 1000;
const DISK_INTERVAL_MS = 10 * 60 * 1000;
const BUFFER_SIZE = 2880; // 24h at 30s
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

// Default thresholds. Future: make these configurable via the Settings page.
const DEFAULT_THRESHOLDS = {
  cpu: { warn: 90, label: 'CPU' },
  mem: { warn: 90, label: 'Memory' },
  disk: { warn: 95, label: 'Disk' },
};

// Rolling buffer — each sample is { ts, cpu, mem, disk? }
// disk is sparse (every 10 min) — presence is preserved via last-known value
/** @type {Array<{ ts: number, cpu: number, mem: number, disk: number | null }>} */
const buffer = [];

let sampleTimer = null;
let diskTimer = null;
let lastDiskPercent = null;
let lastAlertAt = {}; // { cpu: timestamp, mem: timestamp, disk: timestamp }

function cpuPercent() {
  return new Promise((resolve) => {
    const c1 = os.cpus();
    setTimeout(() => {
      const c2 = os.cpus();
      let totalIdle = 0, totalTick = 0;
      for (let i = 0; i < c2.length; i++) {
        const a = c1[i].times, b = c2[i].times;
        const idle = b.idle - a.idle;
        const total = (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + idle;
        totalIdle += idle;
        totalTick += total;
      }
      resolve(totalTick > 0 ? +((1 - totalIdle / totalTick) * 100).toFixed(1) : 0);
    }, 500);
  });
}

function memPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  return +(((total - free) / total) * 100).toFixed(1);
}

function sampleDiskPercent() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      // Non-Windows hosts: skip the PowerShell call — dashboard just won't
      // show disk metrics on Linux/Mac. (This project is Windows-first.)
      resolve(null);
      return;
    }
    exec(
      'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Used,Free | ConvertTo-Json"',
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          let drives = JSON.parse(stdout);
          if (!Array.isArray(drives)) drives = [drives];
          let used = 0, free = 0;
          for (const d of drives) { used += d.Used || 0; free += d.Free || 0; }
          const total = used + free;
          resolve(total > 0 ? +((used / total) * 100).toFixed(1) : null);
        } catch { resolve(null); }
      }
    );
  });
}

function recordSample(cpu, mem, disk) {
  buffer.push({ ts: Date.now(), cpu, mem, disk });
  while (buffer.length > BUFFER_SIZE) buffer.shift();
  checkThresholds({ cpu, mem, disk });
}

function checkThresholds(sample) {
  // Lazy require to avoid circular deps at module init
  let notifications;
  try {
    notifications = require('./notifications');
  } catch { return; }

  const now = Date.now();
  for (const [key, cfg] of Object.entries(DEFAULT_THRESHOLDS)) {
    const val = sample[key];
    if (val == null) continue;
    if (val < cfg.warn) continue;
    const last = lastAlertAt[key] || 0;
    if (now - last < ALERT_COOLDOWN_MS) continue;
    lastAlertAt[key] = now;
    try {
      notifications.addNotification(
        null, // host-level alert, not tied to a specific server
        'system.threshold',
        `${cfg.label} usage high`,
        `${cfg.label} at ${val.toFixed(1)}% (threshold: ${cfg.warn}%). Check running servers and consider scaling down if sustained.`,
        'warning'
      );
    } catch (err) {
      logger.warn({ err: err.message, key, val }, 'system-metrics: failed to fire threshold alert');
    }
  }
}

async function tick() {
  try {
    const [cpu, mem] = await Promise.all([cpuPercent(), memPercent()]);
    recordSample(cpu, mem, lastDiskPercent);
  } catch (err) {
    logger.warn({ err: err.message }, 'system-metrics: sample failed');
  }
}

async function tickDisk() {
  try {
    const disk = await sampleDiskPercent();
    if (disk != null) {
      lastDiskPercent = disk;
      // If disk crosses threshold, fire immediately (rather than waiting
      // for the next CPU/RAM tick). Reuses the cooldown machinery.
      checkThresholds({ disk });
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'system-metrics: disk sample failed');
  }
}

/** Start the sampler. Safe to call multiple times (idempotent). */
function start() {
  if (sampleTimer) return;
  // Kick off first sample right away so the dashboard has data immediately
  tick().catch(() => {});
  tickDisk().catch(() => {});
  sampleTimer = setInterval(tick, SAMPLE_INTERVAL_MS);
  diskTimer = setInterval(tickDisk, DISK_INTERVAL_MS);
  logger.info('system-metrics: sampler started');
}

function stop() {
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  if (diskTimer) { clearInterval(diskTimer); diskTimer = null; }
}

/**
 * Return samples for the last `rangeMinutes` minutes. For downsampling,
 * pass `targetPoints` to aggregate into that many buckets (avg of each
 * window) — useful when rendering a wide chart from 24h of 30s samples.
 */
function getHistory({ rangeMinutes = 60, targetPoints = 120 } = {}) {
  const cutoff = Date.now() - rangeMinutes * 60000;
  const window = buffer.filter((s) => s.ts >= cutoff);
  if (window.length === 0) return [];
  if (window.length <= targetPoints) return window;

  // Downsample by bucketing
  const bucketSize = Math.ceil(window.length / targetPoints);
  const out = [];
  for (let i = 0; i < window.length; i += bucketSize) {
    const slice = window.slice(i, i + bucketSize);
    if (slice.length === 0) continue;
    const avg = (key) => {
      const vals = slice.map((s) => s[key]).filter((v) => v != null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    out.push({
      ts: slice[Math.floor(slice.length / 2)].ts,
      cpu: round(avg('cpu')),
      mem: round(avg('mem')),
      disk: round(avg('disk')),
    });
  }
  return out;
}

function round(v) {
  if (v == null) return null;
  return +v.toFixed(1);
}

function getThresholds() {
  return { ...DEFAULT_THRESHOLDS };
}

function getCurrent() {
  return buffer[buffer.length - 1] || null;
}

module.exports = {
  start,
  stop,
  getHistory,
  getThresholds,
  getCurrent,
};
