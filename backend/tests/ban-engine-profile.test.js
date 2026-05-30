'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ctx = require('../lib/context');
const { syncBansJsonToProfile } = require('../lib/ban-engine');

describe('syncBansJsonToProfile (mod enforcement file)', () => {
  let installDir;
  beforeEach(() => { installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-bans-')); });
  afterEach(() => fs.rmSync(installDir, { recursive: true, force: true }));

  function read(srv) {
    const file = path.join(installDir, srv.profileDir || 'profiles', 'Citadel', 'bans.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  test('writes $profile/Citadel/bans.json with mod-shaped entries', () => {
    ctx.banDatabase = [
      { steamId: '76561198000000001', playerName: 'Cheater', reason: 'Aimbot', bannedAt: '2026-05-29T12:00:00.000Z' },
      { steamId: '76561198000000002', playerName: 'Dupe', reason: 'Duping', bannedAt: '2026-05-01T08:30:15.500Z' },
    ];
    const srv = { id: 's1', installDir };
    syncBansJsonToProfile(srv);
    const json = read(srv);
    expect(json.bans).toHaveLength(2);
    expect(json.bans[0]).toEqual({
      player_id: '76561198000000001', player_name: 'Cheater', reason: 'Aimbot',
      banned_at: '2026-05-29 12:00:00', // ISO 'T'→space, trimmed to seconds
    });
  });

  test('honors a custom profileDir and defaults names/reasons', () => {
    ctx.banDatabase = [{ steamId: '76561198000000003' }];
    const srv = { id: 's2', installDir, profileDir: 'myprofile' };
    syncBansJsonToProfile(srv);
    const json = read(srv);
    expect(json.bans[0]).toMatchObject({ player_id: '76561198000000003', player_name: 'Unknown', reason: 'Banned' });
  });

  test('skips entries without a steamId and never throws', () => {
    ctx.banDatabase = [{ playerName: 'NoId' }, { steamId: '76561198000000004' }];
    const srv = { id: 's3', installDir };
    expect(() => syncBansJsonToProfile(srv)).not.toThrow();
    expect(read(srv).bans).toHaveLength(1);
  });

  test('no-op when installDir is missing', () => {
    ctx.banDatabase = [{ steamId: '76561198000000005' }];
    expect(() => syncBansJsonToProfile({ id: 's4' })).not.toThrow();
  });
});
