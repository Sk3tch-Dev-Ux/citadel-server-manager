/**
 * Windows Service installer/manager for Citadel.
 *
 * Uses NSSM (Non-Sucking Service Manager) to register Citadel as a native
 * Windows service named "CitadelServer".  NSSM wraps Node.js so that the
 * Windows Service Control Manager can properly start/stop/query the process.
 *
 * Exports:
 *   installService()   - Creates the Windows service via NSSM
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

// Resolve absolute paths so the service always finds the right files.
// CITADEL_INSTALL_DIR allows the NSIS installer to specify the install location.
const PROJECT_ROOT = process.env.CITADEL_INSTALL_DIR || path.resolve(__dirname, '..', '..');
const SERVER_JS = path.join(PROJECT_ROOT, 'backend', 'server.js');
const NODE_EXE = process.execPath; // e.g. C:\Citadel\runtime\node.exe
const LOG_DIR = path.join(PROJECT_ROOT, 'data');

/**
 * Locate nssm.exe — check runtime/ next to project root first, then PATH.
 */
function findNssm() {
  // Check bundled location (installer puts it in runtime/)
  const bundled = path.join(PROJECT_ROOT, 'runtime', 'nssm.exe');
  if (fs.existsSync(bundled)) return bundled;

  // Check relative to node.exe (same directory)
  const sameDir = path.join(path.dirname(NODE_EXE), 'nssm.exe');
  if (fs.existsSync(sameDir)) return sameDir;

  // Fall back to PATH
  try {
    const result = execSync('where nssm.exe', { encoding: 'utf8', windowsHide: true });
    const firstLine = result.trim().split('\n')[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}

  return null;
}

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

/**
 * Require NSSM or print a helpful message and exit.
 */
function requireNssm() {
  const nssmPath = findNssm();
  if (!nssmPath) {
    console.error('');
    console.error('  ERROR: nssm.exe not found.');
    console.error('');
    console.error('  NSSM is required to manage the Windows service.');
    console.error('  Install via: choco install nssm');
    console.error('  Or download from: https://nssm.cc/download');
    console.error('  Place nssm.exe in the runtime/ directory next to node.exe.');
    console.error('');
    process.exit(1);
  }
  return nssmPath;
}

// ─── Service operations ─────────────────────────────────

/**
 * Query the Windows service and return its state.
 * Uses sc.exe query which works for NSSM-managed services.
 */
async function getServiceStatus() {
  const result = run(`sc.exe query "${SERVICE_NAME}"`);

  if (!result.ok) {
    if (result.stderr.includes('1060') || result.stdout.includes('1060')) {
      return { installed: false, state: 'not-installed', startType: null };
    }
    return { installed: false, state: 'not-installed', startType: null };
  }

  const stateMatch = result.stdout.match(/STATE\s+:\s+\d+\s+(\S+)/);
  const state = stateMatch ? stateMatch[1].toLowerCase() : 'unknown';

  const qcResult = run(`sc.exe qc "${SERVICE_NAME}"`);
  let startType = null;
  if (qcResult.ok) {
    const startMatch = qcResult.stdout.match(/START_TYPE\s+:\s+\d+\s+(\S+)/);
    startType = startMatch ? startMatch[1].toLowerCase() : null;
  }

  return { installed: true, state, startType };
}

/**
 * Install Citadel as a Windows service using NSSM.
 */
async function installService() {
  requireElevation('install');
  const nssm = requireNssm();

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

  // Ensure log directory exists
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  console.log(`Installing service "${SERVICE_NAME}" via NSSM...`);
  console.log(`  nssm.exe : ${nssm}`);
  console.log(`  node.exe : ${NODE_EXE}`);
  console.log(`  server.js: ${SERVER_JS}`);
  console.log(`  work dir : ${PROJECT_ROOT}`);
  console.log('');

  // 1. Install the service
  const createResult = run(`"${nssm}" install "${SERVICE_NAME}" "${NODE_EXE}" "${SERVER_JS}"`);
  if (!createResult.ok) {
    console.error('Failed to create service:');
    console.error(createResult.stderr || createResult.stdout);
    return { ok: false, error: createResult.stderr };
  }
  console.log('  [OK] Service created');

  // 2. Set display name
  run(`"${nssm}" set "${SERVICE_NAME}" DisplayName "${SERVICE_DISPLAY}"`);
  console.log('  [OK] Display name set');

  // 3. Set description
  run(`"${nssm}" set "${SERVICE_NAME}" Description "${SERVICE_DESCRIPTION}"`);
  console.log('  [OK] Description set');

  // 4. Set working directory
  run(`"${nssm}" set "${SERVICE_NAME}" AppDirectory "${PROJECT_ROOT}"`);
  console.log('  [OK] Working directory set');

  // 5. Set environment variable for service mode detection
  run(`"${nssm}" set "${SERVICE_NAME}" AppEnvironmentExtra "CITADEL_SERVICE_MODE=1"`);
  console.log('  [OK] Service environment variable set (CITADEL_SERVICE_MODE=1)');

  // 6. Configure stdout/stderr logging
  const logFile = path.join(LOG_DIR, 'service.log');
  run(`"${nssm}" set "${SERVICE_NAME}" AppStdout "${logFile}"`);
  run(`"${nssm}" set "${SERVICE_NAME}" AppStderr "${logFile}"`);
  console.log(`  [OK] Logging to ${logFile}`);

  // 7. Enable log rotation (rotate at 5MB)
  run(`"${nssm}" set "${SERVICE_NAME}" AppRotateFiles 1`);
  run(`"${nssm}" set "${SERVICE_NAME}" AppRotateBytes 5242880`);
  console.log('  [OK] Log rotation enabled (5MB)');

  // 8. Configure auto-start
  run(`"${nssm}" set "${SERVICE_NAME}" Start SERVICE_AUTO_START`);
  console.log('  [OK] Auto-start on boot enabled');

  // 9. Configure failure recovery via sc.exe (3 restarts, 60s delay)
  run(
    `sc.exe failure "${SERVICE_NAME}" ` +
    `reset= 86400 ` +
    `actions= restart/60000/restart/60000/restart/60000`
  );
  console.log('  [OK] Failure recovery configured (3 restarts, 60s delay)');

  console.log('');
  console.log(`Service "${SERVICE_NAME}" installed successfully.`);
  console.log('');
  console.log('Next steps:');
  console.log(`  Start the service : npm run service:start   (or: sc.exe start ${SERVICE_NAME})`);
  console.log(`  Check status      : npm run service:status  (or: sc.exe query ${SERVICE_NAME})`);
  console.log(`  View in Services  : Open services.msc and look for "${SERVICE_DISPLAY}"`);
  console.log(`  View logs         : ${path.join(LOG_DIR, 'service.log')}`);
  console.log('');

  return { ok: true, alreadyInstalled: false };
}

/**
 * Uninstall the Citadel Windows service.
 */
async function uninstallService() {
  requireElevation('uninstall');
  const nssm = requireNssm();

  const status = await getServiceStatus();
  if (!status.installed) {
    console.log(`Service "${SERVICE_NAME}" is not installed. Nothing to do.`);
    return { ok: true, wasInstalled: false };
  }

  // Stop if running
  if (status.state === 'running') {
    console.log('Stopping service before removal...');
    const stopResult = run(`"${nssm}" stop "${SERVICE_NAME}"`);
    if (stopResult.ok) {
      console.log('  [OK] Stop signal sent');
      // Give it a moment to shut down
      run('timeout /t 3 /nobreak >nul 2>&1');
    }
  }

  // Remove the service
  console.log(`Removing service "${SERVICE_NAME}"...`);
  const deleteResult = run(`"${nssm}" remove "${SERVICE_NAME}" confirm`);

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
  const nssm = requireNssm();

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
  const result = run(`"${nssm}" start "${SERVICE_NAME}"`);

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
  const nssm = requireNssm();

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
  const result = run(`"${nssm}" stop "${SERVICE_NAME}"`);

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
      console.log(`  NSSM    : ${findNssm() || 'not found'}`);
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
    console.log('Citadel Windows Service Manager (NSSM)');
    console.log('=======================================');
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
