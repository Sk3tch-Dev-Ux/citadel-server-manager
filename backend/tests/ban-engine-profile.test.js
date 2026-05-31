'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Stub the Trust-Network cache so the merge is deterministic. Tests override
// listCachedBans per-case; default is "no community bans".
jest.mock('../lib/cloud-bans', () => ({ listCachedBans: jest.fn(() => []) }));
const cloudBans = require('../lib/cloud-bans');

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

  test('merges Trust-Network community bans with a category reason', () => {
    ctx.banDatabase = [{ steamId: '76561198000000001', playerName: 'Local', reason: 'Toxic', bannedAt: '2026-05-29T12:00:00.000Z' }];
    cloudBans.listCachedBans.mockReturnValueOnce([
      { steamId: '76561198000000009', reasonCategory: 'cheating', activatedAt: '2026-05-20T10:00:00.000Z' },
    ]);
    const srv = { id: 's5', installDir };
    syncBansJsonToProfile(srv);
    const json = read(srv);
    expect(json.bans).toHaveLength(2);
    const community = json.bans.find(b => b.player_id === '76561198000000009');
    expect(community).toMatchObject({ reason: 'Trust Network: cheating', banned_at: '2026-05-20 10:00:00' });
  });

  test('drops a SteamID containing a newline (ban.txt/bans.json injection guard)', () => {
    ctx.banDatabase = [
      { steamId: '76561198000000001', playerName: 'Good', reason: 'x', bannedAt: '2026-05-29T12:00:00.000Z' },
      { steamId: '76561198000000002\n76561198099999999', playerName: 'Evil', reason: 'inject' },
    ];
    const srv = { id: 's7', installDir };
    syncBansJsonToProfile(srv);
    const json = read(srv);
    expect(json.bans).toHaveLength(1);
    expect(json.bans[0].player_id).toBe('76561198000000001');
  });

  test('local ban wins when a SteamID is both locally and community banned', () => {
    ctx.banDatabase = [{ steamId: '76561198000000007', playerName: 'Dupe', reason: 'Local reason', bannedAt: '2026-05-29T00:00:00.000Z' }];
    cloudBans.listCachedBans.mockReturnValueOnce([{ steamId: '76561198000000007', reasonCategory: 'cheating' }]);
    const srv = { id: 's6', installDir };
    syncBansJsonToProfile(srv);
    const json = read(srv);
    expect(json.bans).toHaveLength(1);
    expect(json.bans[0].reason).toBe('Local reason');
  });
});
