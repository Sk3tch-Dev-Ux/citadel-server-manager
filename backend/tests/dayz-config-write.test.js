'use strict';

/**
 * Regression tests for writeServerConfig — guards the bugs that caused
 * "config changes don't stick" on live servers:
 *   1. New keys with a 0 / false / '' value were silently skipped.
 *   2. Keys outside the (too-small) allowlist were dropped.
 *   3. The in-place regex required a trailing ';' and clobbered inline comments.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeServerConfig, readServerConfig } = require('../lib/dayz-config');

function withCfg(initial, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dzcfg-test-'));
  fs.writeFileSync(path.join(dir, 'serverDZ.cfg'), initial, 'utf8');
  try {
    return fn(dir, () => fs.readFileSync(path.join(dir, 'serverDZ.cfg'), 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('writeServerConfig', () => {
  test('updates an existing key in place', () => {
    withCfg('maxPlayers = 60;\n', (dir, read) => {
      expect(writeServerConfig(dir, { maxPlayers: 80 })).toBe(true);
      expect(readServerConfig(dir).maxPlayers).toBe(80);
    });
  });

  test('writes a NEW key whose value is 0 (was previously skipped)', () => {
    withCfg('maxPlayers = 60;\n', (dir, read) => {
      writeServerConfig(dir, { disableVoN: 0 });
      expect(readServerConfig(dir).disableVoN).toBe(0);
      expect(read()).toMatch(/disableVoN\s*=\s*0;/);
    });
  });

  test('writes a NEW string key', () => {
    withCfg('maxPlayers = 60;\n', (dir) => {
      writeServerConfig(dir, { motd: 'Welcome' });
      expect(readServerConfig(dir).motd).toBe('Welcome');
    });
  });

  test('accepts a key that was previously outside the allowlist', () => {
    withCfg('maxPlayers = 60;\n', (dir) => {
      writeServerConfig(dir, { enableCfgGameplayFile: 1 });
      expect(readServerConfig(dir).enableCfgGameplayFile).toBe(1);
    });
  });

  test('preserves an inline comment when updating in place', () => {
    withCfg('instanceId = 1;   // keep me\n', (dir, read) => {
      writeServerConfig(dir, { instanceId: 2 });
      expect(read()).toMatch(/instanceId\s*=\s*2;\s*\/\/ keep me/);
    });
  });

  test('still rejects an unknown junk key', () => {
    withCfg('maxPlayers = 60;\n', (dir, read) => {
      writeServerConfig(dir, { 'totally bogus key!!': 'x' });
      expect(read()).not.toMatch(/totally bogus/);
    });
  });
});
