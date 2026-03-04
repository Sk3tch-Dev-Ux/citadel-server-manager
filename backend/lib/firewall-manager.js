/**
 * Windows Firewall rule management for DayZ server ports.
 *
 * Automatically creates inbound Allow rules so servers are reachable
 * from the internet (not LAN-only).  Uses PowerShell cmdlets:
 *   - Get-NetFirewallRule   (check existence)
 *   - New-NetFirewallRule   (create)
 *   - Remove-NetFirewallRule (cleanup on deletion)
 *
 * Rule naming convention:
 *   "Citadel - {ServerName} - Game ({port} UDP)"
 *   "Citadel - {ServerName} - Query ({port} UDP)"
 *   "Citadel - {ServerName} - RCON ({port} TCP)"
 */
const { spawn } = require('child_process');
const logger = require('./logger');

const PS_FLAGS = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden'];
const PS_TIMEOUT = 15000; // 15 s — rule creation can be slow

/**
 * Run a PowerShell command and return { success, stdout, stderr }.
 */
function runPS(command) {
  return new Promise((resolve) => {
    const proc = spawn('powershell', [...PS_FLAGS, '-Command', command], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* ok */ }
      resolve({ success: false, stdout, stderr: 'Timed out' });
    }, PS_TIMEOUT);

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, stdout, stderr: err.message });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, stdout, stderr });
    });
  });
}

/**
 * Build the list of firewall rules a server needs.
 */
function buildRuleSpecs(serverName, ports) {
  const rules = [];
  if (ports.gamePort) {
    rules.push({
      name: `Citadel - ${serverName} - Game (${ports.gamePort} UDP)`,
      port: Number(ports.gamePort),
      protocol: 'UDP',
    });
  }
  if (ports.queryPort) {
    rules.push({
      name: `Citadel - ${serverName} - Query (${ports.queryPort} UDP)`,
      port: Number(ports.queryPort),
      protocol: 'UDP',
    });
  }
  if (ports.rconPort) {
    rules.push({
      name: `Citadel - ${serverName} - RCON (${ports.rconPort} TCP)`,
      port: Number(ports.rconPort),
      protocol: 'TCP',
    });
  }
  return rules;
}

/**
 * Ensure Windows Firewall inbound-allow rules exist for a server's ports.
 * Idempotent — skips rules that already exist.
 *
 * @param {string} serverName  - Human-readable server name (used in rule display name)
 * @param {{gamePort: number, queryPort: number, rconPort: number}} ports
 * @returns {Promise<{success: boolean, created: string[], errors: string[]}>}
 */
async function ensureFirewallRules(serverName, ports) {
  const specs = buildRuleSpecs(serverName, ports);
  const created = [];
  const errors = [];

  for (const spec of specs) {
    // Escape single quotes in the display name for PowerShell
    const safeName = spec.name.replace(/'/g, "''");

    // Check if rule already exists
    const check = await runPS(
      `Get-NetFirewallRule -DisplayName '${safeName}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty DisplayName`
    );
    if (check.success && check.stdout.trim()) {
      continue; // Rule already exists
    }

    // Create the rule
    const create = await runPS(
      `New-NetFirewallRule -DisplayName '${safeName}' -Direction Inbound -Action Allow -Protocol ${spec.protocol} -LocalPort ${spec.port} -Profile Any -Enabled True`
    );
    if (create.success) {
      created.push(spec.name);
      logger.info({ rule: spec.name }, 'Firewall rule created');
    } else {
      const msg = `Failed to create rule "${spec.name}": ${create.stderr.trim()}`;
      errors.push(msg);
      logger.warn({ rule: spec.name, stderr: create.stderr.trim() }, 'Failed to create firewall rule');
    }
  }

  return { success: errors.length === 0, created, errors };
}

/**
 * Remove all Citadel firewall rules for a given server.
 * Fire-and-forget — logs errors but never throws.
 *
 * @param {string} serverName
 */
async function removeFirewallRules(serverName) {
  const safeName = serverName.replace(/'/g, "''");
  const result = await runPS(
    `Remove-NetFirewallRule -DisplayName 'Citadel - ${safeName} - *' -ErrorAction SilentlyContinue`
  );
  if (result.success) {
    logger.info({ serverName }, 'Firewall rules removed');
  } else if (result.stderr && !result.stderr.includes('No MSFT_NetFirewallRule')) {
    logger.warn({ serverName, stderr: result.stderr.trim() }, 'Failed to remove firewall rules');
  }
}

module.exports = { ensureFirewallRules, removeFirewallRules };
