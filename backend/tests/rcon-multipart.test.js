'use strict';

// The logger and context modules are required transitively by rcon-client.
// They are side-effect-safe to load in tests (no socket is opened here — we
// drive the response handlers directly).
const RCONClient = require('../lib/rcon-client');

/**
 * Build the payload that the client's response handler receives for a command
 * response — i.e. the bytes *after* the 1-byte packet type (matching
 * `msg.slice(7)` in connect()).
 */
function singlePayload(seq, body) {
  return Buffer.concat([Buffer.from([seq]), Buffer.from(body, 'utf8')]);
}
function multipartPayload(seq, total, index, partBody) {
  return Buffer.concat([Buffer.from([seq, 0x00, total, index]), Buffer.from(partBody, 'utf8')]);
}

/** Register a fake pending command and capture the resolved value. */
function registerPending(client, seq) {
  const state = { resolved: undefined, calls: 0 };
  client.pendingCommands.set(seq, {
    resolve: (v) => { state.resolved = v; state.calls++; },
    reject: () => {},
    timeout: setTimeout(() => {}, 1_000_000),
  });
  return state;
}

function makeClient() {
  const c = new RCONClient('127.0.0.1', 2302, 'pw', 'srv-test');
  return c;
}

afterEach(() => {
  jest.clearAllTimers();
});

describe('RCON CRC32 checksum verification', () => {
  test('accepts a packet built by the client itself (round-trip)', () => {
    const c = makeClient();
    const pkt = c._buildPacket(Buffer.from([0x01, 7, 0x41, 0x42])); // type, seq, "AB"
    expect(c._verifyChecksum(pkt)).toBe(true);
  });

  test('rejects a packet whose body was tampered with', () => {
    const c = makeClient();
    const pkt = c._buildPacket(Buffer.from([0x01, 7, 0x41, 0x42]));
    const tampered = Buffer.from(pkt);
    tampered[tampered.length - 1] ^= 0xFF; // flip a body byte; CRC no longer matches
    expect(c._verifyChecksum(tampered)).toBe(false);
  });

  test('rejects a packet with a corrupted checksum field', () => {
    const c = makeClient();
    const pkt = c._buildPacket(Buffer.from([0x01, 7, 0x41]));
    const tampered = Buffer.from(pkt);
    tampered[2] ^= 0xFF; // corrupt the stored CRC
    expect(c._verifyChecksum(tampered)).toBe(false);
  });

  test('rejects a runt packet', () => {
    const c = makeClient();
    expect(c._verifyChecksum(Buffer.from([0x42, 0x45, 0x00]))).toBe(false);
  });
});

describe('RCON command response handling', () => {
  test('single-part response resolves with the full body', () => {
    const c = makeClient();
    const state = registerPending(c, 5);
    c._handleCommandResponse(singlePayload(5, 'Players on server: 3'));
    expect(state.resolved).toBe('Players on server: 3');
    expect(state.calls).toBe(1);
    expect(c.pendingCommands.has(5)).toBe(false);
  });

  test('single-part empty body resolves to empty string', () => {
    const c = makeClient();
    const state = registerPending(c, 0);
    c._handleCommandResponse(singlePayload(0, ''));
    expect(state.resolved).toBe('');
  });
});

describe('RCON multi-part response assembly', () => {
  test('reassembles fragments in order and resolves once', () => {
    const c = makeClient();
    const state = registerPending(c, 7);
    c._handleCommandResponse(multipartPayload(7, 3, 0, 'AAAA'));
    expect(state.calls).toBe(0); // not complete yet
    c._handleCommandResponse(multipartPayload(7, 3, 1, 'BBBB'));
    expect(state.calls).toBe(0);
    c._handleCommandResponse(multipartPayload(7, 3, 2, 'CCCC'));
    expect(state.resolved).toBe('AAAABBBBCCCC');
    expect(state.calls).toBe(1);
    expect(c.pendingCommands.has(7)).toBe(false);
    expect(c.multipartBuffers.has(7)).toBe(false);
  });

  test('handles fragments arriving out of order', () => {
    const c = makeClient();
    const state = registerPending(c, 9);
    c._handleCommandResponse(multipartPayload(9, 3, 2, 'CC'));
    c._handleCommandResponse(multipartPayload(9, 3, 0, 'AA'));
    c._handleCommandResponse(multipartPayload(9, 3, 1, 'BB'));
    expect(state.resolved).toBe('AABBCC');
  });

  test('ignores duplicate fragments (UDP retransmits)', () => {
    const c = makeClient();
    const state = registerPending(c, 4);
    c._handleCommandResponse(multipartPayload(4, 2, 0, 'XX'));
    c._handleCommandResponse(multipartPayload(4, 2, 0, 'XX')); // dup
    expect(state.calls).toBe(0);
    c._handleCommandResponse(multipartPayload(4, 2, 1, 'YY'));
    expect(state.resolved).toBe('XXYY');
    expect(state.calls).toBe(1);
  });

  test('reassembles a large (>512B) player list across many fragments', () => {
    const c = makeClient();
    const state = registerPending(c, 1);
    const fragments = ['row-1;'.repeat(100), 'row-2;'.repeat(100), 'row-3;'.repeat(100)];
    const expected = fragments.join('');
    fragments.forEach((f, i) => c._handleCommandResponse(multipartPayload(1, fragments.length, i, f)));
    expect(state.resolved).toBe(expected);
    expect(state.resolved.length).toBeGreaterThan(512);
  });

  test('malformed header (index >= total) is ignored, not resolved', () => {
    const c = makeClient();
    const state = registerPending(c, 2);
    c._handleCommandResponse(multipartPayload(2, 2, 5, 'oops'));
    expect(state.calls).toBe(0);
    expect(c.multipartBuffers.has(2)).toBe(false);
  });

  test('a new response on a reused sequence resets the buffer', () => {
    const c = makeClient();
    // First (incomplete) response on seq 3
    const s1 = registerPending(c, 3);
    c._handleCommandResponse(multipartPayload(3, 3, 0, 'OLD'));
    // New command reuses seq 3 with a different total — old fragment must not leak
    const s2 = registerPending(c, 3);
    c._handleCommandResponse(multipartPayload(3, 2, 0, 'NEW1'));
    c._handleCommandResponse(multipartPayload(3, 2, 1, 'NEW2'));
    expect(s2.resolved).toBe('NEW1NEW2');
    expect(s1.resolved).toBeUndefined();
  });
});
