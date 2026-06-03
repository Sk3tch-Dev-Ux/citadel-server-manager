'use strict';

// G3b — verifies the events.jsonl → cloud message mapping in the cloud-bridge
// Forwarder, focused on the new `playerStats` → `player_stats_update` path
// (live anti-cheat). The Forwarder is exercised directly via _onEvents with an
// injected fake client; no live socket/bridge is needed.

const { Forwarder } = require('../lib/cloud-bridge/forwarders');

function makeForwarder() {
  const f = new Forwarder('local-test');
  const sent = [];
  f._client = { send: (m) => { sent.push(m); return true; } };
  return { f, sent };
}

describe('Forwarder playerStats → player_stats_update', () => {
  test('maps the mod stats line 1:1 onto the cloud contract', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{
      type: 'playerStats',
      steamId: '76561198000000001',
      shots_fired: 120,
      shots_hit_player: 30,
      shots_hit_infected: 12,
      shots_hit_animal: 2,
      shots_hit_vehicle: 1,
      distance_traveled: 1500.5,
      vehicle_distance: 300,
      timestamp: '2026-06-02T12:00:00Z',
    }]);

    expect(sent).toHaveLength(1);
    const msg = sent[0];
    expect(msg.type).toBe('player_stats_update');
    expect(msg.ts).toBe(Date.parse('2026-06-02T12:00:00Z'));
    expect(msg.data).toEqual({
      steam_id: '76561198000000001',
      shots_fired: 120,
      shots_hit_player: 30,
      shots_hit_infected: 12,
      shots_hit_animal: 2,
      shots_hit_vehicle: 1,
      distance_traveled: 1500.5,
      vehicle_distance: 300,
    });
  });

  test('coerces stringy/missing counters to safe ints; bad ts falls back to now', () => {
    const { f, sent } = makeForwarder();
    // The mod always emits steamId quoted (JStr), so it arrives as a string —
    // important, since 17-digit steam IDs exceed JS's safe-integer range.
    f._onEvents([{
      type: 'playerStats',
      steamId: '76561198000000002',
      shots_fired: '45',          // stringy numeric → int
      // remaining counters omitted → default 0
      timestamp: 'not-a-date',    // bad ts → falls back to Date.now()
    }]);

    expect(sent).toHaveLength(1);
    expect(sent[0].data).toEqual({
      steam_id: '76561198000000002',
      shots_fired: 45,
      shots_hit_player: 0,
      shots_hit_infected: 0,
      shots_hit_animal: 0,
      shots_hit_vehicle: 0,
      distance_traveled: 0,
      vehicle_distance: 0,
    });
    expect(Number.isFinite(sent[0].ts)).toBe(true);
  });

  test('drops a stats event with no steamId (no send)', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{ type: 'playerStats', shots_fired: 10 }]);
    expect(sent).toHaveLength(0);
  });

  test('routes playerStats alongside other event types in one batch', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([
      { type: 'chat', steamId: '1', name: 'a', message: 'hi', channel: 'global' },
      { type: 'playerStats', steamId: '2', shots_fired: 5 },
    ]);
    const types = sent.map((m) => m.type);
    expect(types).toContain('chat');
    expect(types).toContain('player_stats_update');
  });
});

describe('Forwarder hit → player_hit', () => {
  test('maps a hit (mod victim=steamId) to the player_hit contract', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{
      type: 'hit',
      steamId: '76561198000000001', name: 'Victim',
      attackerSteamId: '76561198000000002', attackerName: 'Attacker',
      weapon: 'M4-A1', ammo: 'Bullet_556x45', zone: 'Head', damage: 35.5,
      timestamp: '2026-06-02T12:00:00Z',
    }]);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('player_hit');
    expect(sent[0].ts).toBe(Date.parse('2026-06-02T12:00:00Z'));
    expect(sent[0].data).toEqual({
      victim_steam_id: '76561198000000001',
      victim_name: 'Victim',
      attacker_steam_id: '76561198000000002',
      attacker_name: 'Attacker',
      weapon: 'M4-A1',
      ammo: 'Bullet_556x45',
      zone: 'Head',
      damage: 35.5,
    });
  });

  test('environmental hit (no attacker) still forwards with empty attacker', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{ type: 'hit', steamId: 'v1', name: 'V', zone: 'Torso', damage: 12 }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].data.attacker_steam_id).toBe('');
    expect(sent[0].data.damage).toBe(12);
  });

  test('drops a hit with no victim steamId', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{ type: 'hit', attackerSteamId: 'a', damage: 5 }]);
    expect(sent).toHaveLength(0);
  });
});
