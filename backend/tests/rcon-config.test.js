'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ctx = require('../lib/context');
const { ensureRconConfig, resolveBattlEyeDir, parseCfg } = require('../lib/rcon-config');

let tmpDir;
function makeServer(extra = {}) {
  const srv = {
    id: 'srv-1', name: 'Test', installDir: tmpDir,
    rconPort: 2305, rconPassword: '',
    ...extra,
  };
  ctx.servers = [srv];
  return srv;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-rcon-test-'));
  ctx.CONFIG = ctx.CONFIG || {};
  ctx.CONFIG.dataDir = tmpDir; // saveJSON target — throwaway
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('resolveBattlEyeDir', () => {
  test('defaults to <installDir>\\battleye', () => {
    const srv = makeServer();
    expect(resolveBattlEyeDir(srv)).toBe(path.join(tmpDir, 'battleye'));
  });

  test('honors -BEpath= launch param (absolute)', () => {
    const srv = makeServer({ launchParams: '-config=serverDZ.cfg -BEpath=C:\\custom\\be -port=2302' });
    expect(resolveBattlEyeDir(srv)).toBe('C:\\custom\\be');
  });

  test('honors -BEpath= launch param (relative to installDir)', () => {
    const srv = makeServer({ launchParams: '-BEpath=profiles/be' });
    expect(resolveBattlEyeDir(srv)).toBe(path.join(tmpDir, 'profiles/be'));
  });
});

describe('parseCfg', () => {
  test('extracts password and port, case-insensitive', () => {
    const r = parseCfg('rconpassword hunter2\r\nRCONPORT 2310\r\nMaxPing 300\r\n');
    expect(r.password).toBe('hunter2');
    expect(r.port).toBe(2310);
  });

  test('empty/missing directives parse to defaults', () => {
    const r = parseCfg('MaxPing 300\n');
    expect(r.password).toBe('');
    expect(r.port).toBeNull();
  });
});

describe('ensureRconConfig', () => {
  const cfgPath = () => path.join(tmpDir, 'battleye', 'BEServer_x64.cfg');

  test('generates a password and creates the cfg when nothing exists', () => {
    const srv = makeServer();
    const r = ensureRconConfig(srv);
    expect(r.ok).toBe(true);
    expect(r.generatedPassword).toBe(true);
    expect(r.created).toBe(true);
    expect(srv.rconPassword).toMatch(/^[a-f0-9]{20}$/);
    const written = parseCfg(fs.readFileSync(cfgPath(), 'utf-8'));
    expect(written.password).toBe(srv.rconPassword);
    expect(written.port).toBe(2305);
  });

  test('adopts a non-empty password from an operator-managed cfg', () => {
    fs.mkdirSync(path.join(tmpDir, 'battleye'), { recursive: true });
    fs.writeFileSync(cfgPath(), 'RConPassword operatorpw\r\nRConPort 2305\r\n');
    const srv = makeServer();
    const r = ensureRconConfig(srv);
    expect(r.adoptedPassword).toBe(true);
    expect(r.created).toBe(false);
    expect(r.updated).toBe(false); // already in sync after adoption
    expect(srv.rconPassword).toBe('operatorpw');
  });

  test('does NOT adopt an empty RConPassword (generates instead)', () => {
    fs.mkdirSync(path.join(tmpDir, 'battleye'), { recursive: true });
    fs.writeFileSync(cfgPath(), 'RConPort 2305\r\n');
    const srv = makeServer();
    const r = ensureRconConfig(srv);
    expect(r.generatedPassword).toBe(true);
    expect(srv.rconPassword).toMatch(/^[a-f0-9]{20}$/);
    expect(parseCfg(fs.readFileSync(cfgPath(), 'utf-8')).password).toBe(srv.rconPassword);
  });

  test('dashboard password wins over a drifted cfg, preserving other lines', () => {
    fs.mkdirSync(path.join(tmpDir, 'battleye'), { recursive: true });
    fs.writeFileSync(cfgPath(), 'RConPassword oldpw\r\nRConPort 9999\r\nMaxPing 300\r\n');
    const srv = makeServer({ rconPassword: 'dashboardpw' });
    const r = ensureRconConfig(srv);
    expect(r.updated).toBe(true);
    const written = fs.readFileSync(cfgPath(), 'utf-8');
    const parsed = parseCfg(written);
    expect(parsed.password).toBe('dashboardpw');
    expect(parsed.port).toBe(2305);
    expect(written).toContain('MaxPing 300'); // operator line preserved
    expect(written).not.toContain('oldpw');
  });

  test('removes stale beserver_x64_active_*.cfg copies when rewriting', () => {
    const beDir = path.join(tmpDir, 'battleye');
    fs.mkdirSync(beDir, { recursive: true });
    fs.writeFileSync(path.join(beDir, 'beserver_x64_active_abc123.cfg'), 'RConPassword stale\r\n');
    const srv = makeServer({ rconPassword: 'freshpw' });
    ensureRconConfig(srv);
    expect(fs.existsSync(path.join(beDir, 'beserver_x64_active_abc123.cfg'))).toBe(false);
    expect(parseCfg(fs.readFileSync(cfgPath(), 'utf-8')).password).toBe('freshpw');
  });

  test('no-op when cfg already matches the server record', () => {
    fs.mkdirSync(path.join(tmpDir, 'battleye'), { recursive: true });
    fs.writeFileSync(cfgPath(), 'RConPassword samepw\r\nRConPort 2305\r\n');
    const srv = makeServer({ rconPassword: 'samepw' });
    const before = fs.statSync(cfgPath()).mtimeMs;
    const r = ensureRconConfig(srv);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(false);
    expect(r.updated).toBe(false);
    expect(fs.statSync(cfgPath()).mtimeMs).toBe(before);
  });

  test('never throws on a missing install dir', () => {
    const srv = makeServer({ installDir: path.join(tmpDir, 'does-not-exist') });
    const r = ensureRconConfig(srv);
    expect(r.ok).toBe(false);
  });
});
