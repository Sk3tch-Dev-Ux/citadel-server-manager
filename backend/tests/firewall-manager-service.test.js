'use strict';

// Hermetic test for the firewall manager's service-mode creation path.
// We mock child_process so PowerShell is NEVER actually invoked and no real
// Windows firewall rules are created.
//
// The mock records every spawned PS command so we can assert which execution
// path was used:
//   - DIRECT  → New-NetFirewallRule appears in a plain `runPS()` command
//               (no `Start-Process -Verb RunAs`).
//   - ELEVATED → the command contains `Start-Process ... -Verb RunAs`.
//
// Each spawned PS command's stdout/stderr/exit code is driven by `mockPS`, a
// function the test sets per-case. (jest.mock factories may only reference
// variables prefixed with `mock`.)
let mockPS = () => ({ stdout: '', exitCode: 0 });
const mockSpawnCalls = [];

jest.mock('child_process', () => ({
  spawn: jest.fn((cmd, args) => {
    const { EventEmitter } = require('events');
    // The PS command is the last arg (after -Command).
    const command = args[args.length - 1];
    mockSpawnCalls.push(command);
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => {
      const { stdout = '', stderr = '', exitCode = 0 } = mockPS(command) || {};
      if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    });
    return proc;
  }),
}));

const ctx = require('../lib/context');
const fw = require('../lib/firewall-manager');

const PORTS = { gamePort: 2302, queryPort: 27016, rconPort: 2305 };

function lastCreateCommand() {
  return mockSpawnCalls.find(c => c.includes('New-NetFirewallRule'));
}
function anyElevated() {
  return mockSpawnCalls.some(c => c.includes('Start-Process') && c.includes('-Verb RunAs'));
}

beforeEach(() => {
  mockSpawnCalls.length = 0;
  mockPS = () => ({ stdout: '', exitCode: 0 });
  ctx.isServiceMode = false;
  delete process.env.CITADEL_SERVICE_MODE;
});

describe('service-mode detection', () => {
  test('isServiceMode() is true when ctx.isServiceMode is set', () => {
    ctx.isServiceMode = true;
    expect(fw.isServiceMode()).toBe(true);
  });

  test('isServiceMode() is true when CITADEL_SERVICE_MODE=1 env var is set', () => {
    ctx.isServiceMode = false;
    process.env.CITADEL_SERVICE_MODE = '1';
    expect(fw.isServiceMode()).toBe(true);
  });

  test('isServiceMode() is false for an interactive (no-signal) process', () => {
    expect(fw.isServiceMode()).toBe(false);
  });
});

describe('ensureFirewallRules — service mode uses DIRECT (non-RunAs) creation', () => {
  test('creates rules via plain runPS New-NetFirewallRule, never Start-Process -Verb RunAs', async () => {
    ctx.isServiceMode = true;
    // Get-NetFirewallRule checks return empty (rule missing) → must create.
    // New-NetFirewallRule succeeds (exit 0).
    mockPS = () => ({ stdout: '', exitCode: 0 });

    const res = await fw.ensureFirewallRules('Alpha', PORTS);

    expect(res.success).toBe(true);
    expect(res.created).toHaveLength(3);
    expect(res.errors).toEqual([]);

    // The creation command must exist, be a security-equivalent inbound-allow
    // rule, and must NOT be elevated.
    const createCmd = lastCreateCommand();
    expect(createCmd).toBeTruthy();
    expect(createCmd).toContain('-Direction Inbound');
    expect(createCmd).toContain('-Action Allow');
    expect(createCmd).toContain('-Profile Any');
    expect(anyElevated()).toBe(false);
  });
});

describe('ensureFirewallRules — interactive mode uses ELEVATED creation', () => {
  test('routes rule creation through Start-Process -Verb RunAs when not a service', async () => {
    ctx.isServiceMode = false;
    mockPS = () => ({ stdout: '', exitCode: 0 });

    await fw.ensureFirewallRules('Alpha', PORTS);
    expect(anyElevated()).toBe(true);
  });
});

describe('ensureFirewallRules — PS failure returns errors (does not throw)', () => {
  test('service-mode direct creation failure is reported in errors[], not thrown', async () => {
    ctx.isServiceMode = true;
    let creationAttempted = false;
    mockPS = (command) => {
      if (command.includes('New-NetFirewallRule')) {
        creationAttempted = true;
        return { stdout: '', stderr: 'Access is denied.', exitCode: 1 };
      }
      // Get-NetFirewallRule: empty on the pre-check (needs create) AND empty on
      // the post-failure verify (so the rule is counted as failed).
      return { stdout: '', exitCode: 0 };
    };

    let res;
    // resolves (never rejects/throws)
    await expect((async () => { res = await fw.ensureFirewallRules('Alpha', PORTS); })()).resolves.toBeUndefined();

    expect(creationAttempted).toBe(true);
    expect(res.success).toBe(false);
    expect(res.created).toEqual([]);
    expect(res.errors.length).toBe(3);
    expect(res.errors[0]).toMatch(/Failed to create rule/);
    expect(res.errors[0]).toMatch(/direct creation failed/);
    // And it must not have tried to elevate.
    expect(anyElevated()).toBe(false);
  });
});

describe('ensureFirewallRules — idempotent skip', () => {
  test('skips rules that already exist and never spawns a creation command', async () => {
    ctx.isServiceMode = true;
    mockPS = (command) => {
      if (command.includes('Get-NetFirewallRule')) {
        // Echo back a non-empty display name → rule exists.
        return { stdout: 'Citadel - Alpha - Game (2302 UDP)\n', exitCode: 0 };
      }
      return { stdout: '', exitCode: 0 };
    };

    const res = await fw.ensureFirewallRules('Alpha', PORTS);
    expect(res.success).toBe(true);
    expect(res.skipped).toHaveLength(3);
    expect(res.created).toEqual([]);
    expect(lastCreateCommand()).toBeUndefined();
  });
});
