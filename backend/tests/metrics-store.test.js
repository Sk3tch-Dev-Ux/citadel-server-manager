'use strict';

const store = require('../lib/metrics-store');

// These tests require the native better-sqlite3 binding. If it is unavailable
// the store degrades to a no-op; we assert that graceful behavior instead.
const enabled = store.init(':memory:');

afterAll(() => store.close());

(enabled ? describe : describe.skip)('metrics-store (persistence active)', () => {
  beforeEach(() => {
    // Clear everything between tests via a full prune (retention 0 = delete all).
    store.prune(0);
  });

  test('records and queries samples in time order', () => {
    const base = 1_000_000_000_000;
    store.record('srv-1', { cpu: 10, ram: 20, players: 1, fps: 60, ts: base + 1000 });
    store.record('srv-1', { cpu: 30, ram: 40, players: 2, fps: 55, ts: base + 2000 });
    const rows = store.query('srv-1', { since: base, until: base + 10_000 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ cpu: 10, players: 1 });
    expect(rows[1]).toMatchObject({ cpu: 30, players: 2 });
    expect(rows[0].ts).toBeLessThan(rows[1].ts);
  });

  test('isolates samples by server id', () => {
    store.record('srv-a', { cpu: 1, ram: 1, players: 0, fps: 60, ts: 5000 });
    store.record('srv-b', { cpu: 2, ram: 2, players: 0, fps: 60, ts: 5000 });
    expect(store.query('srv-a', { since: 0 })).toHaveLength(1);
    expect(store.query('srv-b', { since: 0 })).toHaveLength(1);
  });

  test('filters by since/until window', () => {
    for (let i = 0; i < 5; i++) store.record('w', { cpu: i, ram: 0, players: 0, fps: 0, ts: 1000 + i * 1000 });
    const rows = store.query('w', { since: 2000, until: 4000 });
    expect(rows.map((r) => r.cpu)).toEqual([1, 2, 3]); // ts 2000,3000,4000
  });

  test('downsampling averages within time buckets', () => {
    // Two samples in the same 60s bucket → one averaged row.
    store.record('d', { cpu: 10, ram: 0, players: 0, fps: 0, ts: 60_000 });
    store.record('d', { cpu: 20, ram: 0, players: 0, fps: 0, ts: 90_000 }); // same 60s bucket [60000,120000)
    store.record('d', { cpu: 40, ram: 0, players: 0, fps: 0, ts: 130_000 }); // next bucket
    const rows = store.query('d', { since: 0, downsampleSeconds: 60 });
    expect(rows).toHaveLength(2);
    expect(rows[0].cpu).toBe(15); // (10+20)/2
    expect(rows[1].cpu).toBe(40);
  });

  test('respects the limit', () => {
    for (let i = 0; i < 10; i++) store.record('lim', { cpu: i, ram: 0, players: 0, fps: 0, ts: 1000 + i });
    expect(store.query('lim', { since: 0, limit: 3 })).toHaveLength(3);
  });

  test('prune deletes rows older than the retention window', () => {
    const now = Date.now();
    store.record('p', { cpu: 1, ram: 0, players: 0, fps: 0, ts: now - 10 * 24 * 60 * 60 * 1000 }); // 10 days old
    store.record('p', { cpu: 2, ram: 0, players: 0, fps: 0, ts: now }); // fresh
    const deleted = store.prune(5 * 24 * 60 * 60 * 1000); // keep last 5 days
    expect(deleted).toBe(1);
    const rows = store.query('p', { since: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].cpu).toBe(2);
  });

  test('persists and returns in-game metrics (tick time, entity/AI counts)', () => {
    store.record('g', {
      cpu: 5, ram: 6, players: 3, fps: 42.5,
      tick_avg: 22.1, tick_low: 18, tick_high: 40,
      ai_count: 120, active_ai: 45, animal_count: 30, vehicle_count: 12, entity_count: 9000,
      ts: 8000,
    });
    const rows = store.query('g', { since: 0 });
    expect(rows[0]).toMatchObject({
      fps: 42.5, tick_avg: 22.1, ai_count: 120, active_ai: 45,
      animal_count: 30, vehicle_count: 12, entity_count: 9000,
    });
  });

  test('defaults in-game metrics to 0 when only basics are recorded', () => {
    store.record('basic', { cpu: 1, ram: 2, players: 0, fps: 60, ts: 9000 });
    const rows = store.query('basic', { since: 0 });
    expect(rows[0]).toMatchObject({ tick_avg: 0, ai_count: 0, entity_count: 0 });
  });

  test('persists FPS window and environment telemetry', () => {
    store.record('env', {
      cpu: 5, ram: 6, players: 3, fps: 42,
      fps_min: 28, fps_max: 55,
      weather_rain: 0.4, weather_fog: 0.1, weather_clouds: 0.85, weather_snow: 0,
      wind_speed: 6.2, game_hour: 21, game_minute: 30,
      ts: 8500,
    });
    const rows = store.query('env', { since: 0 });
    expect(rows[0]).toMatchObject({
      fps_min: 28, fps_max: 55,
      weather_rain: 0.4, weather_fog: 0.1, weather_clouds: 0.85, weather_snow: 0,
      wind_speed: 6.2, game_hour: 21,
    });
    // game_minute rides the socket emit but is intentionally not persisted.
    expect(rows[0].game_minute).toBeUndefined();
  });

  test('environment telemetry defaults to 0 for basic samples', () => {
    store.record('env0', { cpu: 1, ram: 2, players: 0, fps: 60, ts: 9100 });
    const rows = store.query('env0', { since: 0 });
    expect(rows[0]).toMatchObject({ fps_min: 0, fps_max: 0, weather_rain: 0, wind_speed: 0, game_hour: 0 });
  });

  test('downsampling averages in-game metrics too', () => {
    store.record('dg', { entity_count: 100, ts: 60_000 });
    store.record('dg', { entity_count: 200, ts: 90_000 });
    const rows = store.query('dg', { since: 0, downsampleSeconds: 60 });
    expect(rows[0].entity_count).toBe(150);
  });

  test('coerces invalid sample fields to safe numbers', () => {
    store.record('c', { cpu: 'oops', ram: null, players: undefined, fps: NaN, ts: 7777 });
    const rows = store.query('c', { since: 0 });
    expect(rows[0]).toMatchObject({ cpu: 0, ram: 0, players: 0, fps: 0 });
  });

  test('record/query never throw on bad input', () => {
    expect(() => store.record(null, null)).not.toThrow();
    expect(store.query(null)).toEqual([]);
  });
});

describe('metrics-store (graceful no-op contract)', () => {
  test('isEnabled reflects init result and query is always safe', () => {
    expect(typeof store.isEnabled()).toBe('boolean');
    // Whether or not persistence is active, querying an unknown server is safe.
    expect(Array.isArray(store.query('nobody', { since: 0 }))).toBe(true);
  });
});
