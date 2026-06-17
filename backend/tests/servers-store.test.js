'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { clearKeyCache } = require('../lib/credential-encryption');
const { loadServers, saveServers, decryptInPlace } = require('../lib/servers-store');

// Use a deterministic, self-contained key for this file only so the round-trip
// works regardless of the runner's JWT_SECRET — and restore it afterwards so
// the mutation can't leak into other test files sharing the worker's env.
const ORIG_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY;
let tmpDir;

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
  clearKeyCache();
});

afterAll(() => {
  if (ORIG_KEY === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = ORIG_KEY;
  clearKeyCache();
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-servers-store-'));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function readDisk() {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, 'servers.json'), 'utf-8'));
}

describe('servers-store at-rest encryption', () => {
  test('saveServers encrypts the secrets on disk; loadServers returns plaintext', async () => {
    const servers = [{
      id: 's1', name: 'A', rconPort: 2305,
      rconPassword: 'secretpw', inHouseApiKey: 'apikey123', inHouseApiUrl: 'http://x',
    }];
    await saveServers(tmpDir, servers);

    const onDisk = readDisk()[0];
    expect(onDisk.rconPassword.startsWith('ENC:')).toBe(true);
    expect(onDisk.inHouseApiKey.startsWith('ENC:')).toBe(true);
    expect(onDisk.rconPassword).not.toContain('secretpw');
    expect(onDisk.inHouseApiKey).not.toContain('apikey123');
    // Non-secret fields are untouched.
    expect(onDisk.inHouseApiUrl).toBe('http://x');
    expect(onDisk.name).toBe('A');

    const { servers: loaded, migrated } = loadServers(tmpDir);
    expect(migrated).toBe(false); // disk is already encrypted
    expect(loaded[0].rconPassword).toBe('secretpw');
    expect(loaded[0].inHouseApiKey).toBe('apikey123');
  });

  test('saveServers does NOT mutate the in-memory plaintext objects', async () => {
    const servers = [{ id: 's1', rconPassword: 'plain', inHouseApiKey: 'plainkey' }];
    await saveServers(tmpDir, servers);
    expect(servers[0].rconPassword).toBe('plain');
    expect(servers[0].inHouseApiKey).toBe('plainkey');
  });

  test('legacy plaintext on disk loads as plaintext and reports migrated=true', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'servers.json'),
      JSON.stringify([{ id: 's1', rconPassword: 'legacypw', inHouseApiKey: '' }]),
      'utf-8'
    );
    const { servers, migrated } = loadServers(tmpDir);
    expect(migrated).toBe(true);
    expect(servers[0].rconPassword).toBe('legacypw');
    expect(servers[0].inHouseApiKey).toBe('');
  });

  test('encryption is idempotent — re-saving an already-encrypted value does not double-wrap', async () => {
    await saveServers(tmpDir, [{ id: 's1', rconPassword: 'pw' }]);
    const enc1 = readDisk()[0].rconPassword;
    // Feed the encrypted value straight back in (as backup-restore would).
    await saveServers(tmpDir, [{ id: 's1', rconPassword: enc1 }]);
    expect(readDisk()[0].rconPassword).toBe(enc1);
    expect(loadServers(tmpDir).servers[0].rconPassword).toBe('pw');
  });

  test('decryptInPlace handles both encrypted and plaintext backup data', async () => {
    await saveServers(tmpDir, [{ id: 's1', rconPassword: 'pw', inHouseApiKey: 'k' }]);
    const restored = decryptInPlace(readDisk());
    expect(restored[0].rconPassword).toBe('pw');
    expect(restored[0].inHouseApiKey).toBe('k');
    expect(decryptInPlace([{ id: 's2', rconPassword: 'old' }])[0].rconPassword).toBe('old');
  });

  test('empty / absent secret fields are preserved', async () => {
    await saveServers(tmpDir, [{ id: 's1', rconPassword: '', name: 'no-secret' }]);
    const onDisk = readDisk()[0];
    expect(onDisk.rconPassword).toBe('');
    expect('inHouseApiKey' in onDisk).toBe(false);
    const { servers: loaded } = loadServers(tmpDir);
    expect(loaded[0].rconPassword).toBe('');
    expect(loaded[0].inHouseApiKey).toBeUndefined();
  });
});
