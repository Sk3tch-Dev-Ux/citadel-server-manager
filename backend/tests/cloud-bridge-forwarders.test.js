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

describe('Forwarder filterAction → filter_action', () => {
  test('maps a chat-filter line to the filter_action contract', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{
      type: 'filterAction',
      filterType: 'chat',
      steamId: '76561198000000001',
      name: 'Spammer',
      pattern: 'badword',
      original: 'this is a badword msg',
      action: 'block',
      timestamp: '2026-06-02T12:00:00Z',
    }]);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('filter_action');
    expect(sent[0].ts).toBe(Date.parse('2026-06-02T12:00:00Z'));
    expect(sent[0].data).toEqual({
      filter_type: 'chat',
      steam_id: '76561198000000001',
      player_name: 'Spammer',
      matched_pattern: 'badword',
      original_text: 'this is a badword msg',
      action_taken: 'block',
    });
  });

  test('coerces an unexpected filterType to chat and forwards', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{ type: 'filterAction', filterType: 'name', steamId: 's1', name: 'N', pattern: 'p', original: 'o', action: 'kick' }]);
    expect(sent[0].data.filter_type).toBe('name');
    f._onEvents([{ type: 'filterAction', filterType: 'weird', steamId: 's2', action: 'warn' }]);
    expect(sent[1].data.filter_type).toBe('chat');
  });

  test('drops a filterAction with no steamId', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{ type: 'filterAction', filterType: 'chat', action: 'block' }]);
    expect(sent).toHaveLength(0);
  });
});

describe('Forwarder dynamicEvent → event', () => {
  test('forwards a spawn and infers the helicrash event_type', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{
      type: 'dynamicEvent',
      action: 'spawn',
      className: 'Land_Wreck_Mi8',
      displayName: 'Mi8 Crash',
      position: { x: 7500, y: 300, z: 8200 },
      timestamp: '2026-06-02T12:00:00Z',
    }]);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('event');
    expect(sent[0].data).toEqual({
      event_type: 'helicrash',
      position: { x: 7500, y: 300, z: 8200 },
      ttl: 0,
    });
  });

  test('classifies contamination and falls back to custom', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{ type: 'dynamicEvent', action: 'spawn', displayName: 'Contaminated Zone' }]);
    f._onEvents([{ type: 'dynamicEvent', action: 'spawn', displayName: 'Military Convoy' }]);
    f._onEvents([{ type: 'dynamicEvent', action: 'spawn', displayName: 'Police Wreck' }]);
    expect(sent.map((m) => m.data.event_type)).toEqual(['contamination', 'custom', 'custom']);
  });

  test('does not forward a despawn (no cloud event representation)', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{ type: 'dynamicEvent', action: 'despawn', className: 'X', displayName: 'X' }]);
    expect(sent).toHaveLength(0);
  });
});

describe('Forwarder vehicles snapshot → vehicles', () => {
  test('wraps the mod vehicles.json array into the cloud vehicles frame', () => {
    const { f, sent } = makeForwarder();
    // Shape matches CitadelReporter.ReportVehicles output.
    f._onVehicles([{
      id: 'veh-123',
      className: 'OffroadHatchback',
      type: 'car',
      icon: 'car',
      position: { x: 7500.5, y: 320, z: 8123.25 },
      health: 850,
      maxHealth: 1000,
    }]);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('vehicles');
    expect(sent[0].data).toEqual({
      vehicles: [{
        id: 'veh-123',
        className: 'OffroadHatchback',
        type: 'car',
        icon: 'car',
        position: { x: 7500.5, y: 320, z: 8123.25 },
        health: 850,
        maxHealth: 1000,
      }],
    });
  });

  test('coerces missing fields and drops entries with no id', () => {
    const { f, sent } = makeForwarder();
    f._onVehicles([
      { id: 'v1' },                       // sparse → coerced to safe defaults
      { className: 'NoId', type: 'boat' }, // no id → dropped
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].data.vehicles).toEqual([{
      id: 'v1',
      className: '',
      type: '',
      icon: '',
      position: { x: 0, y: 0, z: 0 },
      health: 0,
      maxHealth: 0,
    }]);
  });

  test('skips an empty snapshot (no wasted frame)', () => {
    const { f, sent } = makeForwarder();
    f._onVehicles([]);
    f._onVehicles([{ className: 'NoId' }]); // all dropped → still empty
    expect(sent).toHaveLength(0);
  });
});
