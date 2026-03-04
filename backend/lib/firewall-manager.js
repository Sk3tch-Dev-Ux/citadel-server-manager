/**
 * Windows Firewall rule management for DayZ server ports.
 *
 * Automatically creates inbound Allow rules so servers are reachable
 * from the internet (not LAN-only).  Uses PowerShell cmdlets via
 * elevated (Run-As-Admin) execution:
 *   - Get-NetFirewallRule   (check existence — no elevation needed)
 *   - New-NetFirewallRule   (create — requires elevation)
 *   - Remove-NetFirewallRule (cleanup — requires elevation)
 *
 * Elevation approach: writes commands to a temp .ps1 script, then
 * launches it via `Start-Process -Verb RunAs -Wait`. A UAC prompt
 * will appear if the backend is not already running as Administrator.
 *
 * Rule naming convention:
 *   "Citadel - {ServerName} - Game ({port} UDP)"
 *   "Citadel - {ServerName} - Query ({port} UDP)"
 *   "Citadel - {ServerName} - RCON ({port} TCP)"
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const logger = require('./logger');

const PS_FLAGS = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden'];
const PS_TIMEOUT = 30000; // 30 s — elevation + rule creation can be slow

/**
 * Run a PowerShell command (non-elevated) and return { success, stdout, stderr }.
 * Used for read-only checks like Get-NetFirewallRule.
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
 * Run a PowerShell command with elevation (Start-Process -Verb RunAs).
 * Writes the command to a temp .ps1 file and launches it elevated.
 * A UAC prompt will appear unless the backend already has admin rights.
 *
 * Returns { success, exitCode }.
 */
function runElevatedPS(command) {
  return new Promise((resolve) => {
    const tmpId = `citadel-fw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const scriptPath = path.join(os.tmpdir(), `${tmpId}.ps1`);
    const exitCodePath = path.join(os.tmpdir(), `${tmpId}.exit`);

    // Write the actual command into a temp script
    // The script writes its exit code to a file so the caller can read it
    const scriptContent = [
      command,
      `$LASTEXITCODE = if ($?) { 0 } else { 1 }`,
      `Set-Content -Path '${exitCodePath}' -Value $LASTEXITCODE`,
    ].join('\r\n');
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');

    // Launch elevated PowerShell that executes the temp script
    const elevateCmd = [
      `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden`,
      `-ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${scriptPath}');`,
      `Remove-Item '${scriptPath}' -ErrorAction SilentlyContinue;`,
      `if (Test-Path '${exitCodePath}') { $code = Get-Content '${exitCodePath}'; Remove-Item '${exitCodePath}' -ErrorAction SilentlyContinue; exit [int]$code } else { exit $p.ExitCode }`,
    ].join(' ');

    const proc = spawn('powershell', [...PS_FLAGS, '-Command', elevateCmd], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* ok */ }
      try { fs.unlinkSync(scriptPath); } catch { /* ok */ }
      try { fs.unlinkSync(exitCodePath); } catch { /* ok */ }
      resolve({ success: false, exitCode: -1 });
    }, PS_TIMEOUT);

    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { fs.unlinkSync(scriptPath); } catch { /* ok */ }
      try { fs.unlinkSync(exitCodePath); } catch { /* ok */ }
      logger.debug({ err: err.message }, 'Elevated PS spawn error');
      resolve({ success: false, exitCode: -1 });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      // Clean up just in case
      try { fs.unlinkSync(scriptPath); } catch { /* ok */ }
      try { fs.unlinkSync(exitCodePath); } catch { /* ok */ }
      if (stderr && stderr.includes('canceled by the user')) {
        logger.warn('Firewall UAC prompt was declined by user');
      }
      resolve({ success: code === 0, exitCode: code });
    });
  });
}

/**
 * Sanitize server name for safe use in PowerShell commands.
 * Strips everything except alphanumeric, spaces, dashes, underscores, dots.
 */
function sanitizeName(name) {
  return (name || 'Server').replace(/[^a-zA-Z0-9 _\-\.]/g, '').trim() || 'Server';
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
 * Uses elevated PowerShell for rule creation (UAC prompt if not admin).
 *
 * @param {string} serverName  - Human-readable server name (used in rule display name)
 * @param {{gamePort: number, queryPort: number, rconPort: number}} ports
 * @returns {Promise<{success: boolean, created: string[], skipped: string[], errors: string[]}>}
 */
async function ensureFirewallRules(serverName, ports) {
  const specs = buildRuleSpecs(sanitizeName(serverName), ports);
  const created = [];
  const skipped = [];
  const errors = [];

  // First, check which rules already exist (non-elevated)
  const toCreate = [];
  for (const spec of specs) {
    const safeName = spec.name.replace(/'/g, "''");
    const check = await runPS(
      `Get-NetFirewallRule -DisplayName '${safeName}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty DisplayName`
    );
    if (check.success && check.stdout.trim()) {
      skipped.push(spec.name);
    } else {
      toCreate.push(spec);
    }
  }

  if (toCreate.length === 0) {
    return { success: true, created, skipped, errors };
  }

  // Build a single elevated script that creates all missing rules
  const commands = toCreate.map(spec => {
    const safeName = spec.name.replace(/'/g, "''");
    return `New-NetFirewallRule -DisplayName '${safeName}' -Direction Inbound -Action Allow -Protocol ${spec.protocol} -LocalPort ${spec.port} -Profile Any -Enabled True -ErrorAction Stop`;
  });

  const result = await runElevatedPS(commands.join('\r\n'));

  if (result.success) {
    for (const spec of toCreate) {
      created.push(spec.name);
      logger.info({ rule: spec.name }, 'Firewall rule created');
    }
  } else {
    // Partial success possible — check which rules were actually created
    for (const spec of toCreate) {
      const safeName = spec.name.replace(/'/g, "''");
      const verify = await runPS(
        `Get-NetFirewallRule -DisplayName '${safeName}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty DisplayName`
      );
      if (verify.success && verify.stdout.trim()) {
        created.push(spec.name);
        logger.info({ rule: spec.name }, 'Firewall rule created');
      } else {
        const msg = `Failed to create rule "${spec.name}" (elevation may have been declined)`;
        errors.push(msg);
        logger.warn({ rule: spec.name }, 'Failed to create firewall rule');
      }
    }
  }

  return { success: errors.length === 0, created, skipped, errors };
}

/**
 * Remove all Citadel firewall rules for a given server.
 * Uses elevated PowerShell. Fire-and-forget — logs errors but never throws.
 *
 * @param {string} serverName
 */
async function removeFirewallRules(serverName) {
  const safeName = sanitizeName(serverName).replace(/'/g, "''");
  const command = `Remove-NetFirewallRule -DisplayName 'Citadel - ${safeName} - *' -ErrorAction SilentlyContinue`;

  const result = await runElevatedPS(command);
  if (result.success) {
    logger.info({ serverName }, 'Firewall rules removed');
  } else {
    logger.warn({ serverName, exitCode: result.exitCode }, 'Failed to remove firewall rules (elevation may have been declined)');
  }
}

module.exports = { ensureFirewallRules, removeFirewallRules };
