'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeConfigChanges, reload } = require('../lib/config-watcher');

// Minimal structured config mirroring the real schema sections we touch.
function baseStructured() {
  return {
    logging: { level: 'info', auditRetentionDays: 7 },
    backups: { defaultInterval: 0, defaultMaxKeepDays: 7 },
    polling: {},
    server: { port: 3001, bindHost: '127.0.0.1' },
    auth: {},
    directories: { data: './data' },
  };
}

describe('computeConfigChanges', () => {
  test('applies a changed hot-reloadable field', () => {
    const r = computeConfigChanges({ logging: { level: 'debug' } }, baseStructured());
    expect(r.changed).toEqual(['logging.level']);
    expect(r.apply).toEqual({ logging: { level: 'debug' } });
    expect(r.restartNeeded).toEqual([]);
  });

  test('ignores unchanged values', () => {
    const r = computeConfigChanges({ logging: { level: 'info' } }, baseStructured());
    expect(r.changed).toEqual([]);
  });

  test('flags restart-required sections without applying them', () => {
    const r = computeConfigChanges({ server: { port: 4000 }, auth: { jwtSecret: 'x' } }, baseStructured());
    expect(r.changed).toEqual([]);
    expect(r.restartNeeded).toContain('server.port');
    // auth.jwtSecret is also sensitive — covered below; here jwtSecret isn't in
    // our minimal schema map, so it's simply not applied. server.port is the key check.
  });

  test('never applies sensitive fields (e.g. steam.password)', () => {
    const r = computeConfigChanges({ steam: { password: 'hunter2' } }, { steam: { password: '' } });
    expect(r.changed).toEqual([]);
    expect(r.skippedSensitive).toContain('steam.password');
  });

  test('env-overridden keys are never changed by the file', () => {
    const r = computeConfigChanges(
      { logging: { level: 'debug' } },
      baseStructured(),
      { logging: { level: true } } // env lock on logging.level
    );
    expect(r.changed).toEqual([]);
  });

  test('ignores unknown sections and non-object values', () => {
    const r = computeConfigChanges({ nope: { x: 1 }, logging: 'notanobject' }, baseStructured());
    expect(r.changed).toEqual([]);
  });
});

describe('reload (file → mutation, isolated temp config)', () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgwatch-'));
    file = path.join(dir, 'citadel.config.json');
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('returns empty when the file does not exist', () => {
    expect(reload(path.join(dir, 'missing.json'))).toEqual({ changed: [], restartNeeded: [] });
  });

  test('tolerates invalid JSON (no throw, no change)', () => {
    fs.writeFileSync(file, '{ not valid');
    expect(reload(file)).toEqual({ changed: [], restartNeeded: [] });
  });

  test('applies a logging.level change to the live CONFIG and logger', () => {
    const CONFIG = require('../lib/config'); // the exact singleton config-watcher mutates
    const logger = require('../lib/logger');
    const original = CONFIG._structured.logging.level;
    fs.writeFileSync(file, JSON.stringify({ logging: { level: 'debug' } }));
    const res = reload(file);
    expect(res.changed).toContain('logging.level');
    expect(CONFIG._structured.logging.level).toBe('debug');
    expect(logger.level).toBe('debug'); // live side-effect
    // restore
    CONFIG._structured.logging.level = original;
    logger.level = original;
  });
});
