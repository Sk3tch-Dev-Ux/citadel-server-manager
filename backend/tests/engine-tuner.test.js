'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  computeJobSystem, renderJobSystemBlock, patchDayzSetting, applyEngineTuning,
} = require('../lib/engine-tuner');

describe('computeJobSystem', () => {
  test('reserves half the cores and sizes queues at 1024/core', () => {
    expect(computeJobSystem(24)).toEqual({ maxcores: 24, reservedcores: 12, globalqueue: 24576, threadqueue: 12288 });
  });
  test('handles odd core counts (floor reserved, min 1)', () => {
    expect(computeJobSystem(1)).toEqual({ maxcores: 1, reservedcores: 1, globalqueue: 1024, threadqueue: 1024 });
    expect(computeJobSystem(7)).toMatchObject({ maxcores: 7, reservedcores: 3 });
  });
  test('clamps absurd values', () => {
    expect(computeJobSystem(9999).maxcores).toBe(64);
    expect(computeJobSystem(0).maxcores).toBe(os.cpus().length === 0 ? 1 : 1); // falls back to >=1
  });
});

describe('patchDayzSetting', () => {
  const js = computeJobSystem(8);

  test('creates a full document when there is no existing file', () => {
    const out = patchDayzSetting(null, js);
    expect(out).toMatch(/<\?xml/);
    expect(out).toMatch(/<jobsystem globalqueue="8192" threadqueue="4096">/);
    expect(out).toMatch(/maxcores="8" reservedcores="4"/);
    expect(out).toMatch(/<\/setting>/);
  });

  test('replaces an existing jobsystem block, preserving the rest', () => {
    const existing = `<?xml version="1.0"?>
<setting>
  <network maxpacketsize="1400"></network>
  <jobsystem globalqueue="999" threadqueue="111">
    <pc maxcores="2" reservedcores="1"></pc>
  </jobsystem>
</setting>
`;
    const out = patchDayzSetting(existing, js);
    expect(out).toContain('<network maxpacketsize="1400"></network>'); // untouched
    expect(out).toContain('globalqueue="8192"');
    expect(out).not.toContain('globalqueue="999"');
    expect((out.match(/<jobsystem/g) || []).length).toBe(1); // no duplicate
  });

  test('injects before </setting> when no jobsystem exists', () => {
    const existing = '<setting>\n  <objects></objects>\n</setting>\n';
    const out = patchDayzSetting(existing, js);
    expect(out).toContain('<objects></objects>');
    expect(out).toMatch(/<jobsystem[\s\S]*<\/setting>/);
  });
});

describe('applyEngineTuning', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-tuner-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('writes dayzsetting.xml on first apply and is idempotent on second', () => {
    const srv = { id: 's1', installDir: dir };
    const first = applyEngineTuning(srv);
    expect(first.applied).toBe(true);
    const content = fs.readFileSync(path.join(dir, 'dayzsetting.xml'), 'utf8');
    expect(content).toMatch(/<jobsystem/);
    expect(content).toContain('automatically adjusted by Citadel');
    const second = applyEngineTuning(srv);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('unchanged');
  });

  test('respects a manually-authored jobsystem block (no Citadel marker)', () => {
    const srv = { id: 'sm', installDir: dir };
    fs.writeFileSync(path.join(dir, 'dayzsetting.xml'),
      '<setting>\n  <jobsystem globalqueue="999" threadqueue="111">\n    <pc maxcores="2" reservedcores="1"></pc>\n  </jobsystem>\n</setting>\n');
    const res = applyEngineTuning(srv);
    expect(res).toMatchObject({ applied: false, reason: 'manual-override' });
    // The operator's hand-tuned values are left untouched.
    expect(fs.readFileSync(path.join(dir, 'dayzsetting.xml'), 'utf8')).toContain('globalqueue="999"');
  });

  test('honors the engineAutoTune=false opt-out', () => {
    const srv = { id: 's2', installDir: dir, engineAutoTune: false };
    expect(applyEngineTuning(srv)).toMatchObject({ applied: false, reason: 'disabled' });
    expect(fs.existsSync(path.join(dir, 'dayzsetting.xml'))).toBe(false);
  });

  test('returns no-install-dir when installDir is absent', () => {
    expect(applyEngineTuning({ id: 's3' })).toMatchObject({ applied: false, reason: 'no-install-dir' });
  });

  test('renderJobSystemBlock respects indentation', () => {
    expect(renderJobSystemBlock(computeJobSystem(4), '    ')).toMatch(/^ {4}<jobsystem/);
  });
});
