/**
 * CitadelBridge fs.watch refactor — verifies the watch-based command response
 * path and the watch/fallback data poll, on top of real temp directories.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CitadelBridge } = require('../lib/citadel-bridge');

function tmpServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-bridge-'));
  return { id: 't-' + Math.random().toString(36).slice(2, 8), installDir: dir, profileDir: '' };
}
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

describe('CitadelBridge fs.watch refactor', () => {
  let bridge = null;
  afterEach(() => {
    if (bridge) {
      try { bridge.stopPolling(); } catch { /* ok */ }
      try { bridge.removeAllListeners(); } catch { /* ok */ }
    }
    bridge = null;
  });

  test('sendCommand resolves when the mod writes a matching response', async () => {
    bridge = new CitadelBridge(tmpServer());
    const p = bridge.sendCommand('player.heal', { foo: 1 }, 5000);

    // Simulate the mod: locate the command file, echo a response with its id.
    let id = null;
    for (let i = 0; i < 100 && !id; i++) {
      try {
        const files = fs.readdirSync(bridge.commandsDir).filter((f) => f.endsWith('.cmd.json'));
        if (files.length) id = JSON.parse(fs.readFileSync(path.join(bridge.commandsDir, files[0]), 'utf-8')).id;
      } catch { /* dir not ready */ }
      if (!id) await sleep(10);
    }
    expect(id).toBeTruthy();

    fs.mkdirSync(bridge.responsesDir, { recursive: true });
    fs.writeFileSync(path.join(bridge.responsesDir, id + '.res.json'),
      JSON.stringify({ id, ok: true, data: { healed: true } }));

    const res = await p;
    expect(res.ok).toBe(true);
    expect(res.data.healed).toBe(true);
  });

  test('sendCommand rejects on timeout when no response arrives', async () => {
    bridge = new CitadelBridge(tmpServer());
    await expect(bridge.sendCommand('player.heal', {}, 150)).rejects.toThrow(/timed out/i);
  });

  test('polling emits "players" when players.json changes', async () => {
    bridge = new CitadelBridge(tmpServer());
    fs.mkdirSync(bridge.citadelDir, { recursive: true });
    const got = new Promise((resolve) => { bridge.once('players', resolve); });
    bridge.startPolling(1500); // fast fallback so the test never hangs
    await sleep(30);
    fs.writeFileSync(bridge.files.players, JSON.stringify([{ name: 'Alice' }]));
    const players = await Promise.race([got, sleep(3000).then(() => null)]);
    expect(Array.isArray(players)).toBe(true);
    expect(players[0].name).toBe('Alice');
  });
});
