'use strict';

const ce = require('../lib/credential-encryption');

// Snapshot and restore the env vars these tests mutate.
const ORIG = {
  NODE_ENV: process.env.NODE_ENV,
  KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
  JWT: process.env.JWT_SECRET,
};

afterEach(() => {
  process.env.NODE_ENV = ORIG.NODE_ENV;
  if (ORIG.KEY === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = ORIG.KEY;
  if (ORIG.JWT === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIG.JWT;
  ce.clearKeyCache();
});

describe('validateKeyConfig', () => {
  test('production: missing key throws', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(() => ce.validateKeyConfig()).toThrow(/required in production/);
  });

  test('production: dangerously short key throws', () => {
    process.env.NODE_ENV = 'production';
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'short';
    expect(() => ce.validateKeyConfig()).toThrow(/too short/);
  });

  test('production: valid 64-hex key passes with no warning', () => {
    process.env.NODE_ENV = 'production';
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
    expect(ce.validateKeyConfig()).toEqual({ ok: true });
  });

  test('development: missing key is allowed with a warning', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    const r = ce.validateKeyConfig();
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/not set/);
  });

  test('non-recommended (long but non-hex) key warns but does not throw', () => {
    process.env.NODE_ENV = 'production';
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'z'.repeat(40);
    const r = ce.validateKeyConfig();
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/recommended 64-hex/);
  });
});

describe('encrypt / decrypt round trip', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'b'.repeat(64);
    ce.clearKeyCache();
  });

  test('decrypt(encrypt(x)) === x', () => {
    const secret = 'rcon-p@ss W0rd!';
    const enc = ce.encrypt(secret);
    expect(enc).not.toBe(secret);
    expect(ce.decrypt(enc)).toBe(secret);
  });

  test('identical plaintexts produce different ciphertexts (random IV)', () => {
    expect(ce.encrypt('same')).not.toBe(ce.encrypt('same'));
  });

  test('empty string encrypts to empty string', () => {
    expect(ce.encrypt('')).toBe('');
  });
});
