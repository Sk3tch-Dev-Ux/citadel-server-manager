/**
 * WS3 — defense-in-depth: cloud-issued world WIPE commands (wipe_ai /
 * wipe_vehicles) must not reach the mod unless the operator opted this server
 * in (allowRemoteWipe). Verifies the gate blocks-by-default and lets through
 * when enabled, and that non-wipe actions are unaffected.
 */
const mockGetPolicy = jest.fn();
const mockSendCommand = jest.fn();
const mockGetBridge = jest.fn(() => ({ sendCommand: mockSendCommand }));

jest.mock('../lib/cloud-bridge/storage', () => ({ getPolicy: mockGetPolicy }));
jest.mock('../lib/citadel-bridge', () => ({ getBridge: mockGetBridge }));
jest.mock('../lib/server-lifecycle', () => ({ restartServer: jest.fn() }));
jest.mock('../lib/ban-engine', () => ({ banPlayer: jest.fn(), getBanBySteamId: jest.fn(), removeBan: jest.fn() }));
jest.mock('../lib/audit', () => ({ addAudit: jest.fn() }));

const { handle } = require('../lib/cloud-bridge/commands');

function run(action, allowRemoteWipe, params = {}) {
  mockGetPolicy.mockReturnValue({ allowRemoteWipe, forwardPlayerPII: true });
  mockSendCommand.mockResolvedValue({ ok: true, data: { message: 'done' } });
  const sent = [];
  const client = { send: (m) => sent.push(m) };
  return handle({ localServerId: 's1', client, message: { id: 'c1', action, params } })
    .then(() => sent.find((m) => m.type === 'command_result'));
}

beforeEach(() => { mockGetPolicy.mockReset(); mockSendCommand.mockReset(); mockGetBridge.mockClear(); });

describe('cloud remote-wipe gate', () => {
  test('wipe_ai is refused when allowRemoteWipe is false, and never reaches the bridge', async () => {
    const result = await run('wipe_ai', false);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/disabled/i);
    expect(mockGetBridge).not.toHaveBeenCalled();
  });

  test('wipe_vehicles is refused when allowRemoteWipe is false', async () => {
    const result = await run('wipe_vehicles', false);
    expect(result.success).toBe(false);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  test('wipe_ai proceeds to the bridge when the operator opted in', async () => {
    const result = await run('wipe_ai', true);
    expect(mockGetBridge).toHaveBeenCalledWith('s1');
    expect(mockSendCommand).toHaveBeenCalledWith('world.wipeAI', expect.any(Object));
    expect(result.success).toBe(true);
  });

  test('a non-wipe action (broadcast) is unaffected by the wipe policy', async () => {
    const result = await run('broadcast', false, { text: 'hello' });
    expect(mockSendCommand).toHaveBeenCalledWith('world.broadcast', expect.objectContaining({ text: 'hello' }));
    expect(result.success).toBe(true);
  });
});
