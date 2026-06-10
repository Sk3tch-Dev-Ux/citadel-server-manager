/**
 * Lifecycle Hooks System.
 *
 * Scans a `lifecycle_hooks/` directory under each server's installDir for
 * user-defined scripts that run at key moments in the server lifecycle.
 *
 * Supported events:
 *   - pre-start  (blocking — non-zero exit aborts server start)
 *   - started    (non-blocking — fire-and-forget)
 *   - stopped    (blocking — runs sequentially after server stops)
 *   - crashed    (blocking — runs sequentially after crash detection)
 *
 * File naming:
 *   lifecycle.{event}.{ext}          — single hook
 *   lifecycle.{event}-{index}.{ext}  — multiple hooks, sorted by index
 *
 * Supported extensions: .bat, .ps1, .py
 *
 * Environment variables injected:
 *   CITADEL_SERVER_ROOT, CITADEL_SERVER_ID, CITADEL_SERVER_NAME,
 *   CITADEL_SERVER_PID, CITADEL_GAME_PORT, CITADEL_RCON_PORT,
 *   CITADEL_QUERY_PORT
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const ctx = require('./context');
const { addLog } = require('./audit');
const { HOOK_TIMEOUT_MS } = require('./constants');

// Supported file extensions and their spawn commands
const RUNNERS = {
  '.bat': (scriptPath) => ({ cmd: 'cmd.exe', args: ['/C', scriptPath] }),
  '.ps1': (scriptPath) => ({
    cmd: 'powershell',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
  }),
  '.py': (scriptPath) => ({ cmd: 'python', args: [scriptPath] }),
};

// Events where hooks block the lifecycle action (sequential, exit code matters)
const BLOCKING_EVENTS = new Set(['pre-start', 'stopped', 'crashed']);

/**
 * Get the lifecycle_hooks directory for a server.
 */
function getHooksDir(installDir) {
  return path.join(installDir, 'lifecycle_hooks');
}

/**
 * Discover hook scripts for a given event in a server's lifecycle_hooks dir.
 * Returns an array of { filePath, index } sorted by index.
 */
function discoverHooks(installDir, event) {
  const hooksDir = getHooksDir(installDir);
  if (!fs.existsSync(hooksDir)) return [];

  const extensions = Object.keys(RUNNERS);
  const hooks = [];

  let entries;
  try {
    entries = fs.readdirSync(hooksDir);
  } catch (err) {
    logger.error({ err, hooksDir }, 'Failed to read lifecycle_hooks directory');
    return [];
  }

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!extensions.includes(ext)) continue;

    const baseName = path.basename(entry, ext);

    // Match: lifecycle.{event} (single hook, index 0)
    if (baseName === `lifecycle.${event}`) {
      hooks.push({ filePath: path.join(hooksDir, entry), index: 0 });
      continue;
    }

    // Match: lifecycle.{event}-{index} (indexed hook)
    const indexMatch = baseName.match(new RegExp(`^lifecycle\\.${escapeRegex(event)}-(\\d+)$`));
    if (indexMatch) {
      hooks.push({ filePath: path.join(hooksDir, entry), index: parseInt(indexMatch[1], 10) });
    }
  }

  // Sort by index ascending
  hooks.sort((a, b) => a.index - b.index);
  return hooks;
}

/**
 * Escape a string for use in a regular expression.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Execute a single hook script.
 * Returns a promise that resolves to { success, exitCode, error }.
 */
function runHook(hook, env, timeout) {
  return new Promise((resolve) => {
    const ext = path.extname(hook.filePath).toLowerCase();
    const runner = RUNNERS[ext];
    if (!runner) {
      resolve({ success: false, exitCode: -1, error: `Unsupported extension: ${ext}` });
      return;
    }

    const { cmd, args } = runner(hook.filePath);
    let settled = false;
    let proc;

    try {
      proc = spawn(cmd, args, {
        cwd: path.dirname(hook.filePath),
        env: { ...process.env, ...env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ success: false, exitCode: -1, error: `Failed to spawn: ${err.message}` });
      return;
    }

    let stdout = '';
    let stderr = '';

    if (proc.stdout) proc.stdout.on('data', (data) => { stdout += data.toString(); });
    if (proc.stderr) proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { proc.kill(); } catch { /* already gone */ }
        resolve({ success: false, exitCode: -1, error: `Timed out after ${timeout}ms` });
      }
    }, timeout);

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, exitCode: -1, error: `Spawn error: ${err.message}` });
      }
    });

    proc.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          success: code === 0,
          exitCode: code,
          error: code !== 0 ? (stderr.trim() || `Exited with code ${code}`) : null,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      }
    });
  });
}

/**
 * Build the environment variables to inject into hook scripts.
 */
function buildHookEnv(serverId, extraEnv) {
  const srv = ctx.servers.find(s => s.id === serverId);
  const state = ctx.serverStates[serverId];

  const env = {
    CITADEL_SERVER_ID: serverId || '',
    CITADEL_SERVER_NAME: srv?.name || '',
    CITADEL_SERVER_ROOT: srv?.installDir || '',
    CITADEL_SERVER_PID: String(state?.pid || ''),
    CITADEL_GAME_PORT: String(srv?.gamePort || ''),
    CITADEL_RCON_PORT: String(srv?.rconPort || ''),
    CITADEL_QUERY_PORT: String(srv?.queryPort || ''),
  };

  // Merge any extra environment variables passed by the caller
  if (extraEnv && typeof extraEnv === 'object') {
    Object.assign(env, extraEnv);
  }

  return env;
}

/**
 * Execute all hooks for a given lifecycle event.
 *
 * For blocking events (pre-start, stopped, crashed):
 *   - Hooks run sequentially in index order
 *   - If any hook returns non-zero exit code, execution stops
 *   - Returns { success: false, hook, result } on failure
 *   - Returns { success: true } when all hooks pass
 *
 * For non-blocking events (started):
 *   - All hooks fire concurrently (fire-and-forget)
 *   - Always returns { success: true }
 *   - Errors are logged but do not affect the lifecycle
 *
 * @param {string} serverId - The server ID
 * @param {string} event - The lifecycle event name
 * @param {object} [extraEnv] - Additional environment variables to inject
 * @returns {Promise<{success: boolean, hook?: string, result?: object}>}
 */
async function executeHooks(serverId, event, extraEnv) {
  const srv = ctx.servers.find(s => s.id === serverId);
  if (!srv || !srv.installDir) {
    return { success: true };
  }

  const hooks = discoverHooks(srv.installDir, event);
  if (hooks.length === 0) {
    return { success: true };
  }

  const env = buildHookEnv(serverId, extraEnv);
  const timeout = srv.hookTimeout || HOOK_TIMEOUT_MS;
  const isBlocking = BLOCKING_EVENTS.has(event);

  addLog(serverId, 'info', 'hooks', `Executing ${hooks.length} ${event} hook(s)`);

  if (isBlocking) {
    // Blocking: run sequentially, abort on failure
    for (const hook of hooks) {
      const fileName = path.basename(hook.filePath);
      addLog(serverId, 'info', 'hooks', `Running hook: ${fileName}`);

      const result = await runHook(hook, env, timeout);

      if (result.success) {
        addLog(serverId, 'info', 'hooks', `Hook ${fileName} completed (exit 0)`);
      } else {
        addLog(serverId, 'error', 'hooks', `Hook ${fileName} failed: ${result.error || `exit code ${result.exitCode}`}`);

        // Emit Socket.IO event for hook failure
        if (ctx.io) {
          ctx.emitServer('hookResult', {
            serverId,
            event,
            hook: fileName,
            success: false,
            error: result.error,
            exitCode: result.exitCode,
          });
        }

        return { success: false, hook: fileName, result };
      }
    }

    addLog(serverId, 'info', 'hooks', `All ${event} hooks completed successfully`);
    return { success: true };

  } else {
    // Non-blocking: fire all concurrently, log results, never fail
    for (const hook of hooks) {
      const fileName = path.basename(hook.filePath);
      addLog(serverId, 'info', 'hooks', `Firing hook (async): ${fileName}`);

      // Fire and forget — no await
      runHook(hook, env, timeout).then((result) => {
        if (result.success) {
          addLog(serverId, 'info', 'hooks', `Async hook ${fileName} completed (exit 0)`);
        } else {
          addLog(serverId, 'warn', 'hooks', `Async hook ${fileName} failed: ${result.error || `exit code ${result.exitCode}`}`);
        }
        // Emit result regardless
        if (ctx.io) {
          ctx.emitServer('hookResult', {
            serverId,
            event,
            hook: fileName,
            success: result.success,
            error: result.error || null,
            exitCode: result.exitCode,
          });
        }
      }).catch((err) => {
        addLog(serverId, 'error', 'hooks', `Async hook ${fileName} error: ${err.message}`);
      });
    }

    return { success: true };
  }
}

/**
 * Scaffold the lifecycle_hooks directory for a server's install dir.
 * Creates the directory if it does not exist, and writes a README
 * explaining the hook system.
 */
function scaffoldHookDirectory(installDir) {
  const hooksDir = getHooksDir(installDir);
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Write a README if it doesn't exist
  const readmePath = path.join(hooksDir, 'README.txt');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, [
      'Citadel Lifecycle Hooks',
      '=======================',
      '',
      'Place scripts in this directory to run at server lifecycle events.',
      '',
      'Supported events:',
      '  pre-start  - Runs BEFORE server starts. Non-zero exit aborts the start.',
      '  started    - Runs AFTER server starts (fire-and-forget).',
      '  stopped    - Runs AFTER server stops.',
      '  crashed    - Runs AFTER crash detection.',
      '',
      'File naming:',
      '  lifecycle.{event}.bat       - Single hook (e.g., lifecycle.pre-start.bat)',
      '  lifecycle.{event}.ps1       - PowerShell hook',
      '  lifecycle.{event}.py        - Python hook',
      '  lifecycle.{event}-1.bat     - Multiple hooks, sorted by index',
      '  lifecycle.{event}-2.ps1',
      '',
      'Environment variables available in scripts:',
      '  CITADEL_SERVER_ROOT  - Server installation directory',
      '  CITADEL_SERVER_ID    - Unique server identifier',
      '  CITADEL_SERVER_NAME  - Server display name',
      '  CITADEL_SERVER_PID   - Server process PID (empty if not running)',
      '  CITADEL_GAME_PORT    - Game port number',
      '  CITADEL_RCON_PORT    - RCON port number',
      '  CITADEL_QUERY_PORT   - Query port number',
      '',
      'Blocking hooks (pre-start, stopped, crashed):',
      '  - Run sequentially in index order',
      '  - Non-zero exit code aborts the lifecycle action (pre-start only)',
      '  - Default timeout: 30 seconds per hook',
      '',
      'Non-blocking hooks (started):',
      '  - Run concurrently (fire-and-forget)',
      '  - Errors are logged but do not affect server operation',
      '',
    ].join('\n'));
  }
}

module.exports = { executeHooks, scaffoldHookDirectory };
