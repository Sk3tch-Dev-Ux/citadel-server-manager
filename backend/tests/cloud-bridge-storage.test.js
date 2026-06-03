'use strict';

// Durable replay cursor preservation across re-pair (setLink).
//
// Regression for "durable-offset-lost-on-relink": re-pairing a server with the
// SAME cloud identity must preserve the persisted cloudAckedOffset so the
// tailer doesn't re-baseline to the live file tail and silently drop buffered
// telemetry. Re-pairing to a DIFFERENT cloud server must reset the cursor.
//
// We mock paths (so storage writes to a throwaway temp ROOT) and
// credential-encryption (identity passthrough — we're not testing crypto here).

const fs = require('fs');
const path = require('path');

// Mock factories are hoisted above imports, so the temp ROOT must be created
// INSIDE the factory (and named with a `mock` prefix to satisfy jest's
// out-of-scope guard).
jest.mock('../lib/paths', () => {
  const _fs = require('fs');
  const _os = require('os');
  const _path = require('path');
  const mockRoot = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cit-storage-'));
  return { ROOT: mockRoot };
});
jest.mock('../lib/credential-encryption', () => ({
  encrypt: (s) => `ENC:${s}`,
  decrypt: (s) => String(s).replace(/^ENC:/, ''),
}));
jest.mock('../lib/logger', () => ({ warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }));

const { ROOT } = require('../lib/paths');
const storage = require('../lib/cloud-bridge/storage');

const LINK_FILE = path.join(ROOT, 'data', 'plugin-servers.json');

function resetState() {
  try { fs.rmSync(LINK_FILE, { force: true }); } catch { /* ignore */ }
  storage.flushAckedOffsets(); // clear any pending timer/map
  // Drop any pending offset for the test server by overwriting then flushing.
}

describe('cloud-bridge storage: setLink preserves the durable replay cursor', () => {
  beforeEach(() => resetState());

  test('re-pair with the SAME cloudServerId keeps the persisted offset', () => {
    storage.setLink('srv1', { cloudServerId: 'cloud-A', apiKey: 'key1', name: 'A' });
    storage.setAckedOffset('srv1', 4242);
    storage.flushAckedOffsets();
    expect(storage.getAckedOffset('srv1')).toBe(4242);

    // Operator re-pastes the key for the same cloud server.
    storage.setLink('srv1', { cloudServerId: 'cloud-A', apiKey: 'key1-rotated', name: 'A' });

    expect(storage.getAckedOffset('srv1')).toBe(4242); // cursor survives
  });

  test('re-pair to a DIFFERENT cloudServerId resets the cursor', () => {
    storage.setLink('srv1', { cloudServerId: 'cloud-A', apiKey: 'key1', name: 'A' });
    storage.setAckedOffset('srv1', 4242);
    storage.flushAckedOffsets();
    expect(storage.getAckedOffset('srv1')).toBe(4242);

    // Operator links the local server to a brand-new cloud server.
    storage.setLink('srv1', { cloudServerId: 'cloud-B', apiKey: 'key2', name: 'B' });

    expect(storage.getAckedOffset('srv1')).toBeNull(); // start at live tail
  });

  test('a not-yet-flushed pending offset is dropped when cloud identity changes', () => {
    storage.setLink('srv1', { cloudServerId: 'cloud-A', apiKey: 'key1', name: 'A' });
    storage.setAckedOffset('srv1', 999); // pending, NOT flushed

    storage.setLink('srv1', { cloudServerId: 'cloud-B', apiKey: 'key2', name: 'B' });

    expect(storage.getAckedOffset('srv1')).toBeNull();
  });

  test('linkedAt is still preserved across re-pair (unchanged behavior)', () => {
    storage.setLink('srv1', { cloudServerId: 'cloud-A', apiKey: 'key1', name: 'A' });
    const first = storage.getPublic('srv1').linkedAt;
    storage.setLink('srv1', { cloudServerId: 'cloud-A', apiKey: 'key1', name: 'A2' });
    expect(storage.getPublic('srv1').linkedAt).toBe(first);
  });
});
