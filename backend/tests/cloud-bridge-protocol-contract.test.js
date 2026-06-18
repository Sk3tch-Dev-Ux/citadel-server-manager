'use strict';

// Cross-repo protocol drift guard.
//
// The cloud-bridge is a hand-ported CommonJS mirror of the cloud's TypeScript
// wire contract (citadel-cloud/packages/shared/src/types/plugin.ts). Because
// the agent is plain JS, a cloud-side rename or a new action/config_type/
// telemetry kind produces NO type error here — it silently drifts (the agent
// replies "Unknown action", writes nulls, or drops a frame). The two repos
// don't share a build, so the realistic guard is: pin the contract HERE and
// assert this repo's code still covers it. When the cloud adds to the union,
// updating the agent means updating BOTH the handler and the pinned set below,
// and this test fails loudly until that happens.
//
// Source of truth: citadel-cloud/packages/shared/src/types/plugin.ts
//   - CommandAction               (Cloud → agent commands)
//   - CloudConfigSyncMessage.config_type   (Cloud → agent config bundles)
//   - PluginToCloudMessage union  (agent → Cloud telemetry)

const { ACTION_MAP } = require('../lib/cloud-bridge/commands');
const { ALLOWED_TYPES } = require('../lib/cloud-bridge/config-sync');
const { Forwarder } = require('../lib/cloud-bridge/forwarders');

// ─── Pinned contract (mirror of plugin.ts) ───────────────────────────

// CommandAction union. `restart` + `unban` are handled in commands.js BEFORE
// the ACTION_MAP lookup (they aren't mod-IPC actions), so they're expected to
// be absent from ACTION_MAP but still covered.
const CONTRACT_COMMAND_ACTIONS = [
  'kick', 'ban', 'heal', 'kill', 'teleport', 'spawn_item', 'message',
  'broadcast', 'set_time', 'set_weather', 'wipe_ai', 'wipe_vehicles',
  'unban', 'restart',
];
const SPECIAL_CASED_ACTIONS = ['restart', 'unban'];

// CloudConfigSyncMessage.config_type union.
const CONTRACT_CONFIG_TYPES = [
  'server_config', 'chat_filters', 'name_filters', 'whitelist',
  'bans', 'priority_queue', 'schedules', 'messenger',
];

// Mod events.jsonl `type` → cloud PluginToCloudMessage `type`. This is the
// layer that silently dropped filter_action + world events before. One row per
// mod event type the forwarder is expected to translate.
const EVENT_MAPPING = [
  { mod: { type: 'connect', steamId: '7656119800000001', name: 'A' }, cloud: 'player_connect' },
  { mod: { type: 'playtime', steamId: '7656119800000001', name: 'A', seconds: 60 }, cloud: 'player_disconnect' },
  { mod: { type: 'kill', steamId: '7656119800000001', victimSteamId: '7656119800000002' }, cloud: 'kill' },
  { mod: { type: 'chat', steamId: '7656119800000001', message: 'hi', channel: 'global' }, cloud: 'chat' },
  { mod: { type: 'death', steamId: '7656119800000001', deathType: 'fall' }, cloud: 'death' },
  { mod: { type: 'suicide', steamId: '7656119800000001' }, cloud: 'death' },
  { mod: { type: 'playerStats', steamId: '7656119800000001' }, cloud: 'player_stats_update' },
  { mod: { type: 'hit', steamId: '7656119800000001', attackerSteamId: '7656119800000002' }, cloud: 'player_hit' },
  { mod: { type: 'filterAction', filterType: 'chat', steamId: '7656119800000001', name: 'A', pattern: 'badword', original: 'a badword', action: 'block' }, cloud: 'filter_action' },
  { mod: { type: 'dynamicEvent', action: 'spawn', className: 'Land_Wreck_Mi8', displayName: 'Mi8 Crash' }, cloud: 'event' },
];

// Cloud telemetry types NOT sourced from events.jsonl — emitted by their own
// Forwarder paths (asserted present below), plus the documented hard gaps.
// `vehicles` flows from the mod's vehicles.json → bridge 'vehicles' event →
// _onVehicles (not events.jsonl), same as metrics/positions.
const SNAPSHOT_EMITTED = ['metrics', 'agent_health', 'player_position', 'vehicles', 'rcon_players', 'ban_list'];
// `world_events` + `schedule_executed` are intentionally unused in cloud v1
// (the sink ignores them). If either gains an agent source, move it out of this
// list so the coverage assertion below forces a test update.
const KNOWN_UNEMITTED = ['world_events', 'schedule_executed'];

// Protocol-frame types the route owns, not telemetry.
const PROTOCOL_FRAMES = ['ping', 'command_result'];

function makeForwarder() {
  const f = new Forwarder('local-test');
  const sent = [];
  f._client = { send: (m) => { sent.push(m); return true; }, isAuthenticated: () => true };
  return { f, sent };
}

describe('cloud-bridge protocol contract — Cloud → agent', () => {
  test('every CommandAction is handled (ACTION_MAP ∪ special-cased)', () => {
    const handled = new Set([...Object.keys(ACTION_MAP), ...SPECIAL_CASED_ACTIONS]);
    for (const action of CONTRACT_COMMAND_ACTIONS) {
      expect(handled.has(action)).toBe(true);
    }
    // No agent-side action outside the contract (catches a stale/extra mapping
    // that the cloud would never send — a sign the pin needs reconciling).
    expect(handled).toEqual(new Set(CONTRACT_COMMAND_ACTIONS));
  });

  test('special-cased actions are NOT in ACTION_MAP (handled before the lookup)', () => {
    for (const a of SPECIAL_CASED_ACTIONS) {
      expect(ACTION_MAP[a]).toBeUndefined();
    }
  });

  test('config_sync ALLOWED_TYPES exactly matches the contract', () => {
    expect(ALLOWED_TYPES).toEqual(new Set(CONTRACT_CONFIG_TYPES));
  });
});

describe('cloud-bridge protocol contract — agent → Cloud telemetry', () => {
  test.each(EVENT_MAPPING)('mod $mod.type → cloud $cloud', ({ mod, cloud }) => {
    const { f, sent } = makeForwarder();
    // player_disconnect needs a prior session start to fire.
    if (mod.type === 'playtime') f._sessionStarts.set(mod.steamId, Date.now() - 60_000);
    f._onEvents([mod]);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.map((m) => m.type)).toContain(cloud);
  });

  test('dynamicEvent despawn is dropped (no cloud `event` representation)', () => {
    const { f, sent } = makeForwarder();
    f._onEvents([{ type: 'dynamicEvent', action: 'despawn', className: 'X', displayName: 'X' }]);
    expect(sent).toHaveLength(0);
  });

  test('snapshot-path emitters exist on the Forwarder for non-event telemetry', () => {
    // These don't flow through _onEvents; assert their emit methods exist so a
    // rename/removal trips the guard.
    expect(typeof Forwarder.prototype._onMetrics).toBe('function');      // metrics
    expect(typeof Forwarder.prototype._forwardAgentHealth).toBe('function'); // agent_health
    expect(typeof Forwarder.prototype._onPlayers).toBe('function');      // player_position
    expect(typeof Forwarder.prototype._onVehicles).toBe('function');     // vehicles
    expect(typeof Forwarder.prototype._forwardRconPlayers).toBe('function'); // rcon_players
    expect(typeof Forwarder.prototype._forwardBanList).toBe('function'); // ban_list
  });

  test('the union of emitted + snapshot + known-gaps + protocol covers the whole contract', () => {
    // Reconstruct the full PluginToCloudMessage telemetry surface and assert we
    // account for every member — either emitted, or explicitly documented as a
    // gap. `auth` is the only Plugin→Cloud member excluded (handshake, ws-client).
    const eventEmitted = EVENT_MAPPING.map((m) => m.cloud);
    const accountedFor = new Set([
      ...eventEmitted,
      ...SNAPSHOT_EMITTED,
      ...KNOWN_UNEMITTED,
      ...PROTOCOL_FRAMES,
    ]);
    const CONTRACT_PLUGIN_TO_CLOUD = [
      'metrics', 'agent_health', 'player_connect', 'player_disconnect',
      'player_position', 'chat', 'kill', 'death', 'event', 'vehicles',
      'world_events', 'filter_action', 'schedule_executed',
      'player_stats_update', 'player_hit', 'rcon_players', 'ban_list',
      'ping', 'command_result',
    ];
    for (const type of CONTRACT_PLUGIN_TO_CLOUD) {
      expect(accountedFor.has(type)).toBe(true);
    }
  });
});
