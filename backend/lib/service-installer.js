/**
 * Windows Service installer/manager for Citadel.
 *
 * Uses PowerShell `New-Service` and `sc.exe` to register Citadel as a native
 * Windows service named "CitadelServer".  No external npm dependencies required.
 *
 * Exports:
 *   installService()   - Creates the Windows service
 *   uninstallService()  - Removes the Windows service
 *   getServiceStatus()  - Returns current service state
 *   startService()      - Starts the service
 *   stopService()       - Stops the service
 *
 * CLI usage (run as Administrator):
 *   node backend/lib/service-installer.js install
 *   node backend/lib/service-installer.js uninstall
 *   node backend/lib/service-installer.js status
 *   node backend/lib/service-installer.js start
 *   node backend/lib/service-installer.js stop
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Constants ──────────────────────────────────────────
const SERVICE_NAME = 'CitadelServer';
const SERVICE_DISPLAY = 'Citadel DayZ Server Controller';
const SERVICE_DESCRIPTION = 'Citadel — All-In-One DayZ server management platform with web UI, Discord bot, and live map.';

// Resolve absolute paths so the service always finds the right files
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_JS = path.join(PROJECT_ROOT, 'backend', 'server.js');
const NODE_EXE = process.execPath; // e.g. C:\Program Files\nodejs\node.exe

// ─── Helpers ────────────────────────────────────────────

/**
 * Run a shell command synchronously, returning { ok, stdout, stderr }.
 * Never throws — caller inspects `ok` to decide what to do.
 */
function run(cmd, opts = {}) {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      ...opts,
    });
    return { ok: true, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || err.message || '').toString().trim(),
    };
  }
}

/**
 * Check whether the current process is elevated (Administrator).
 */
function isElevated() {
  const result = run('net session 2>&1');
  return result.ok;
}

/**
 * Require elevation or print a helpful message and exit with code 1.
 */
function requireElevation(action) {
  if (!isElevated()) {
    console.error('');
    console.error(`  ERROR: "${action}" requires Administrator privileges.`);
    console.error('');
    console.error('  How to fix:');
    console.error('    1. Right-click "Command Prompt" or "PowerShell" and select "Run as administrator"');
    console.error('    2. Navigate to this project directory');
    console.error(`    3. Run: npm run service:${action}`);
    console.error('');
    process.exit(1);
  }
}

// ─── Service operations ─────────────────────────────────

/**
 * Query the Windows service and return its state.
 * @returns {Promise<{installed: boolean, state: string, startType: string|null}>}
 */
async function getServiceStatus() {
  const result = run(`sc.exe query "${SERVICE_NAME}"`);

  if (!result.ok) {
    // sc.exe returns error 1060 when the service does not exist
    if (result.stderr.includes('1060') || result.stdout.includes('1060')) {
      return { installed: false, state: 'not-installed', startType: null };
    }
    // Some other error — treat as not installed
    return { installed: false, state: 'not-installed', startType: null };
  }

  // Parse STATE line, e.g.  "        STATE              : 4  RUNNING"
  const stateMatch = result.stdout.match(/STATE\s+:\s+\d+\s+(\S+)/);
  const state = stateMatch ? stateMatch[1].toLowerCase() : 'unknown';

  // Get start type
  const qcResult = run(`sc.exe qc "${SERVICE_NAME}"`);
  let startType = null;
  if (qcResult.ok) {
    const startMatch = qcResult.stdout.match(/START_TYPE\s+:\s+\d+\s+(\S+)/);
    startType = startMatch ? startMatch[1].toLowerCase() : null;
  }

  return { installed: true, state, startType };
}

/**
 * Install Citadel as a Windows service.
 * Configures auto-start on boot and auto-restart on failure (3 attempts, 60s delay).
 */
async function installService() {
  requireElevation('install');

  // Check if already installed
  const status = await getServiceStatus();
  if (status.installed) {
    console.log(`Service "${SERVICE_NAME}" is already installed (state: ${status.state}).`);
    console.log('Run "npm run service:uninstall" first if you want to reinstall.');
    return { ok: true, alreadyInstalled: true };
  }

  // Verify node.exe and server.js exist
  if (!fs.existsSync(NODE_EXE)) {
    console.error(`ERROR: node.exe not found at "${NODE_EXE}".`);
    return { ok: false, error: 'node.exe not found' };
  }
  if (!fs.existsSync(SERVER_JS)) {
    console.error(`ERROR: server.js not found at "${SERVER_JS}".`);
    return { ok: false, error: 'server.js not found' };
  }

  // Build the binary path for sc.exe.
  // sc.exe requires the full command in the binPath including arguments.
  // We quote the node path and the server.js path separately.
  const binPath = `"${NODE_EXE}" "${SERVER_JS}"`;

  console.log(`Installing service "${SERVICE_NAME}"...`);
  console.log(`  node.exe : ${NODE_EXE}`);
  console.log(`  server.js: ${SERVER_JS}`);
  console.log(`  work dir : ${PROJECT_ROOT}`);
  console.log('');

  // 1. Create the service using sc.exe
  //    binPath= value must have the space after the equals sign (sc.exe quirk).
  const createResult = run(
    `sc.exe create "${SERVICE_NAME}" ` +
    `binPath= "${NODE_EXE} \\"${SERVER_JS}\\"" ` +
    `DisplayName= "${SERVICE_DISPLAY}" ` +
    `start= auto`
  );

  if (!createResult.ok) {
    console.error('Failed to create service:');
    console.error(createResult.stderr || createResult.stdout);
    return { ok: false, error: createResult.stderr };
  }

  console.log('  [OK] Service created');

  // 2. Set description
  run(`sc.exe description "${SERVICE_NAME}" "${SERVICE_DESCRIPTION}"`);
  console.log('  [OK] Description set');

  // 3. Configure failure recovery: restart after 60s, up to 3 times
  //    reset= 86400 means the failure counter resets after 24 hours
  run(
    `sc.exe failure "${SERVICE_NAME}" ` +
    `reset= 86400 ` +
    `actions= restart/60000/restart/60000/restart/60000`
  );
  console.log('  [OK] Failure recovery configured (3 restarts, 60s delay)');

  // 4. Set environment variable so the process knows it is running as a service
  //    We do this by modifying the registry key for the service.
  run(
    `reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\${SERVICE_NAME}" /v Environment /t REG_MULTI_SZ /d "CITADEL_SERVICE_MODE=1" /f`
  );
  console.log('  [OK] Service environment variable set (CITADEL_SERVICE_MODE=1)');

  console.log('');
  console.log(`Service "${SERVICE_NAME}" installed successfully.`);
  console.log('');
  console.log('Next steps:');
  console.log(`  Start the service : npm run service:start   (or: sc.exe start ${SERVICE_NAME})`);
  console.log(`  Check status      : npm run service:status  (or: sc.exe query ${SERVICE_NAME})`);
  console.log(`  View in Services  : Open services.msc and look for "${SERVICE_DISPLAY}"`);
  console.log('');

  return { ok: true, alreadyInstalled: false };
}

/**
 * Uninstall the Citadel Windows service.
 */
async function uninstallService() {
  requireElevation('uninstall');

  const status = await getServiceStatus();
  if (!status.installed) {
    console.log(`Service "${SERVICE_NAME}" is not installed. Nothing to do.`);
    return { ok: true, wasInstalled: false };
  }

  // Stop if running
  if (status.state === 'running') {
    console.log('Stopping service before removal...');
    const stopResult = run(`sc.exe stop "${SERVICE_NAME}"`);
    if (stopResult.ok) {
      console.log('  [OK] Stop signal sent');
      // Give it a moment to shut down
      run('timeout /t 3 /nobreak >nul 2>&1');
    }
  }

  // Delete the service
  console.log(`Removing service "${SERVICE_NAME}"...`);
  const deleteResult = run(`sc.exe delete "${SERVICE_NAME}"`);

  if (!deleteResult.ok) {
    console.error('Failed to remove service:');
    console.error(deleteResult.stderr || deleteResult.stdout);
    return { ok: false, error: deleteResult.stderr };
  }

  console.log(`  [OK] Service "${SERVICE_NAME}" removed.`);
  console.log('');
  return { ok: true, wasInstalled: true };
}

/**
 * Start the Windows service.
 */
async function startService() {
  requireElevation('start');

  const status = await getServiceStatus();
  if (!status.installed) {
    console.error(`Service "${SERVICE_NAME}" is not installed. Run "npm run service:install" first.`);
    return { ok: false, error: 'not-installed' };
  }
  if (status.state === 'running') {
    console.log(`Service "${SERVICE_NAME}" is already running.`);
    return { ok: true, alreadyRunning: true };
  }

  console.log(`Starting service "${SERVICE_NAME}"...`);
  const result = run(`sc.exe start "${SERVICE_NAME}"`);

  if (!result.ok) {
    console.error('Failed to start service:');
    console.error(result.stderr || result.stdout);
    return { ok: false, error: result.stderr };
  }

  console.log(`  [OK] Service "${SERVICE_NAME}" started.`);
  return { ok: true };
}

/**
 * Stop the Windows service.
 */
async function stopService() {
  requireElevation('stop');

  const status = await getServiceStatus();
  if (!status.installed) {
    console.error(`Service "${SERVICE_NAME}" is not installed.`);
    return { ok: false, error: 'not-installed' };
  }
  if (status.state === 'stopped') {
    console.log(`Service "${SERVICE_NAME}" is already stopped.`);
    return { ok: true, alreadyStopped: true };
  }

  console.log(`Stopping service "${SERVICE_NAME}"...`);
  const result = run(`sc.exe stop "${SERVICE_NAME}"`);

  if (!result.ok) {
    console.error('Failed to stop service:');
    console.error(result.stderr || result.stdout);
    return { ok: false, error: result.stderr };
  }

  console.log(`  [OK] Service "${SERVICE_NAME}" stopped.`);
  return { ok: true };
}

// ─── CLI handler ────────────────────────────────────────

if (require.main === module) {
  const command = process.argv[2];

  const commands = {
    install: installService,
    uninstall: uninstallService,
    status: async () => {
      const s = await getServiceStatus();
      console.log('');
      console.log(`  Service : ${SERVICE_NAME}`);
      console.log(`  Installed: ${s.installed ? 'Yes' : 'No'}`);
      if (s.installed) {
        console.log(`  State    : ${s.state}`);
        console.log(`  Start    : ${s.startType || 'unknown'}`);
      }
      console.log('');
    },
    start: startService,
    stop: stopService,
  };

  if (!command || !commands[command]) {
    console.log('');
    console.log('Citadel Windows Service Manager');
    console.log('===============================');
    console.log('');
    console.log('Usage:');
    console.log('  node backend/lib/service-installer.js <command>');
    console.log('');
    console.log('Commands:');
    console.log('  install    Install Citadel as a Windows service (requires Administrator)');
    console.log('  uninstall  Remove the Citadel Windows service (requires Administrator)');
    console.log('  status     Check current service status');
    console.log('  start      Start the service (requires Administrator)');
    console.log('  stop       Stop the service (requires Administrator)');
    console.log('');
    console.log('npm script shortcuts:');
    console.log('  npm run service:install');
    console.log('  npm run service:uninstall');
    console.log('  npm run service:status');
    console.log('');
    process.exit(command ? 1 : 0);
  }

  commands[command]().catch((err) => {
    console.error('Unexpected error:', err.message || err);
    process.exit(1);
  });
}

// ─── Exports ────────────────────────────────────────────
module.exports = {
  SERVICE_NAME,
  installService,
  uninstallService,
  getServiceStatus,
  startService,
  stopService,
};
