/**
 * Guards the events.jsonl consumer contract against the mod's JSON escaping.
 *
 * The mod (@CitadelAdmin) writes events.jsonl line-by-line. Its CitadelEventLogger
 * EscapeJson now delegates to CitJsonEscape, which escapes " and \ correctly.
 * Before that fix EscapeJson only stripped whitespace, so any chat message,
 * player/weapon name or className containing a " or \ produced INVALID JSON —
 * which readEventsFrom() silently catches-and-skips, making the event vanish
 * (and, via the same escaper, corrupting players.json snapshots).
 *
 * This test pins both halves of that contract:
 *   - properly-escaped content round-trips with the literal " and \ preserved
 *   - a raw-unescaped (old-mod) line is dropped, not allowed to corrupt the read
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CitadelBridge } = require('../lib/citadel-bridge');

function tmpServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-bridge-esc-'));
  return { id: 't-' + Math.random().toString(36).slice(2, 8), installDir: dir, profileDir: '' };
}

describe('CitadelBridge events.jsonl JSON-escape contract', () => {
  let bridge = null;
  afterEach(() => {
    if (bridge) {
      try { bridge.removeAllListeners(); } catch { /* ok */ }
    }
    bridge = null;
  });

  test('properly-escaped quotes and backslashes round-trip through readEventsFrom', () => {
    bridge = new CitadelBridge(tmpServer());
    fs.mkdirSync(bridge.citadelDir, { recursive: true });

    // What the mod emits AFTER the fix (CitJsonEscape): " and \ are escaped, so
    // the line is valid JSON. The decoded values must contain the raw " and \.
    const escaped = JSON.stringify({
      type: 'kill',
      steamId: '76561198000000001',
      weapon: 'AK"M',          // embedded double-quote
      note: 'path\\to\\thing', // embedded backslashes
    });
    fs.writeFileSync(bridge.files.events, escaped + '\n');

    const { events } = bridge.readEventsFrom(0);
    expect(events).toHaveLength(1);
    expect(events[0].weapon).toBe('AK"M');
    expect(events[0].note).toBe('path\\to\\thing');
  });

  test('a raw-unescaped (old-mod) line is dropped without corrupting the rest', () => {
    bridge = new CitadelBridge(tmpServer());
    fs.mkdirSync(bridge.citadelDir, { recursive: true });

    // Line 1: the old broken escaper's output — a raw " inside the string makes
    // this invalid JSON. Line 2: a valid line that must still be returned.
    const broken = '{"type":"chat","steamId":"1","message":"he said "hi""}';
    const good = JSON.stringify({ type: 'chat', steamId: '2', message: 'hello' });
    fs.writeFileSync(bridge.files.events, broken + '\n' + good + '\n');

    const { events } = bridge.readEventsFrom(0);
    expect(events).toHaveLength(1);
    expect(events[0].steamId).toBe('2');
    expect(events[0].message).toBe('hello');
  });
});
