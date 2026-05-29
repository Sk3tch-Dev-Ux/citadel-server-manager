'use strict';

// Mock child_process so the system-wide PowerShell layer is deterministic (and
// never actually runs) across platforms. By default it returns no system
// conflicts; a test can override mockSystemStdout to simulate a busy port.
// (jest.mock factories may only reference variables prefixed with `mock`.)
let mockSystemStdout = '';
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const { EventEmitter } = require('events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => {
      if (mockSystemStdout) proc.stdout.emit('data', Buffer.from(mockSystemStdout));
      proc.emit('close', 0);
    });
    return proc;
  }),
}));

const ctx = require('../lib/context');
const { checkPortAvailability } = require('../lib/port-checker');

beforeEach(() => {
  mockSystemStdout = '';
  ctx.servers = [];
  ctx.serverStates = {};
});

function addServer(id, name, ports, status) {
  ctx.servers.push({ id, name, gamePort: ports[0], queryPort: ports[1], rconPort: ports[2] });
  ctx.serverStates[id] = { status, pid: 1000 };
}

describe('checkPortAvailability — managed-server conflicts', () => {
  test('reports available when no other server uses the ports', async () => {
    const r = await checkPortAvailability([2302, 27016, 2305]);
    expect(r.available).toBe(true);
    expect(r.conflicts).toEqual([]);
  });

  test('detects a conflict with another running server', async () => {
    addServer('a', 'Alpha', [2302, 27016, 2305], 'running');
    const r = await checkPortAvailability([2302]);
    expect(r.available).toBe(false);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ port: 2302, usedBy: 'Citadel server "Alpha"', pid: 1000 });
  });

  test('excludes the current server from its own conflict check', async () => {
    addServer('a', 'Alpha', [2302, 27016, 2305], 'running');
    const r = await checkPortAvailability([2302], 'a');
    expect(r.available).toBe(true);
  });

  test('ignores servers that are stopped or crashed', async () => {
    addServer('a', 'Alpha', [2302, 27016, 2305], 'stopped');
    addServer('b', 'Bravo', [2302, 27016, 2305], 'crashed');
    const r = await checkPortAvailability([2302]);
    expect(r.available).toBe(true);
  });

  test('matches a query or rcon port too, not just the game port', async () => {
    addServer('a', 'Alpha', [2302, 27016, 2305], 'running');
    expect((await checkPortAvailability([27016])).conflicts[0].port).toBe(27016);
    expect((await checkPortAvailability([2305])).conflicts[0].port).toBe(2305);
  });
});

describe('checkPortAvailability — system layer', () => {
  test('merges a system-level conflict reported by the OS check', async () => {
    mockSystemStdout = '2400,9999\n';
    const r = await checkPortAvailability([2400]);
    expect(r.available).toBe(false);
    expect(r.conflicts[0]).toMatchObject({ port: 2400, pid: 9999 });
    expect(r.conflicts[0].usedBy).toMatch(/PID: 9999/);
  });

  test('does not double-report a port already flagged as a Citadel server', async () => {
    addServer('a', 'Alpha', [2302, 27016, 2305], 'running');
    mockSystemStdout = '2302,9999\n'; // same port the Citadel server owns
    const r = await checkPortAvailability([2302]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].usedBy).toMatch(/Citadel server/);
  });
});
