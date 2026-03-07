/**
 * Server Action Types — vendor-neutral constants for all admin actions.
 *
 * No file outside of server-actions/providers/ should reference CFCloud_*
 * action codes or any other vendor-specific identifiers.
 */

// ─── Action Type Constants ──────────────────────────────
const ActionType = Object.freeze({
  // Player actions
  HEAL_PLAYER:           'player.heal',
  KILL_PLAYER:           'player.kill',
  TELEPORT_PLAYER:       'player.teleport',
  SPAWN_ITEM:            'player.spawnItem',
  STRIP_PLAYER:          'player.strip',
  EXPLODE_PLAYER:        'player.explode',
  MESSAGE_PLAYER:        'player.message',
  KICK_PLAYER:           'player.kick',
  BAN_PLAYER:            'player.ban',
  UNSTUCK_PLAYER:        'player.unstuck',
  FREEZE_PLAYER:         'player.freeze',
  TELEPORT_TO_PLAYER:    'player.teleportToPlayer',
  GET_LOADOUT:           'player.getLoadout',

  // Vehicle actions
  DELETE_VEHICLE:        'vehicle.delete',
  REPAIR_VEHICLE:        'vehicle.repair',
  REFUEL_VEHICLE:        'vehicle.refuel',
  UNSTUCK_VEHICLE:       'vehicle.unstuck',
  EXPLODE_VEHICLE:       'vehicle.explode',
  KILL_ENGINE:           'vehicle.killEngine',
  EJECT_DRIVER:          'vehicle.ejectDriver',
  TELEPORT_VEHICLE:      'vehicle.teleport',

  // World actions
  SET_TIME:              'world.setTime',
  SET_WEATHER:           'world.setWeather',
  CLEAR_WEATHER:         'world.sunny',
  WIPE_AI:               'world.wipeAI',
  WIPE_VEHICLES:         'world.wipeVehicles',
  SPAWN_ITEM_WORLD:      'world.spawnItemWorld',

  // Server/config actions
  RELOAD_CONFIG:         'config.reload',

  // Data / query actions
  GET_PLAYER_DETAILS:    'data.playerDetails',
  GET_CAPABILITIES:      'data.capabilities',
});

// ─── Capability Sets ────────────────────────────────────
// Which actions each provider type can handle.

const LEGACY_SDK_CAPABILITIES = new Set([
  ActionType.HEAL_PLAYER,
  ActionType.KILL_PLAYER,
  ActionType.TELEPORT_PLAYER,
  ActionType.SPAWN_ITEM,
  ActionType.STRIP_PLAYER,
  ActionType.EXPLODE_PLAYER,
  ActionType.MESSAGE_PLAYER,
  ActionType.KICK_PLAYER,
  ActionType.BAN_PLAYER,
  ActionType.DELETE_VEHICLE,
  ActionType.REPAIR_VEHICLE,
  ActionType.REFUEL_VEHICLE,
  ActionType.UNSTUCK_VEHICLE,
  ActionType.EXPLODE_VEHICLE,
  ActionType.KILL_ENGINE,
  ActionType.EJECT_DRIVER,
  ActionType.SET_TIME,
  ActionType.SET_WEATHER,
  ActionType.CLEAR_WEATHER,
  ActionType.WIPE_AI,
  ActionType.WIPE_VEHICLES,
  ActionType.SPAWN_ITEM_WORLD,
  ActionType.GET_PLAYER_DETAILS,
]);

const INHOUSE_CAPABILITIES = new Set([
  ActionType.HEAL_PLAYER,
  ActionType.KILL_PLAYER,
  ActionType.TELEPORT_PLAYER,
  ActionType.SPAWN_ITEM,
  ActionType.STRIP_PLAYER,
  ActionType.EXPLODE_PLAYER,
  ActionType.MESSAGE_PLAYER,
  ActionType.KICK_PLAYER,
  ActionType.BAN_PLAYER,
  ActionType.UNSTUCK_PLAYER,
  ActionType.FREEZE_PLAYER,
  ActionType.TELEPORT_TO_PLAYER,
  ActionType.GET_LOADOUT,
  ActionType.DELETE_VEHICLE,
  ActionType.REPAIR_VEHICLE,
  ActionType.REFUEL_VEHICLE,
  ActionType.UNSTUCK_VEHICLE,
  ActionType.EXPLODE_VEHICLE,
  ActionType.KILL_ENGINE,
  ActionType.EJECT_DRIVER,
  ActionType.TELEPORT_VEHICLE,
  ActionType.SET_TIME,
  ActionType.SET_WEATHER,
  ActionType.CLEAR_WEATHER,
  ActionType.WIPE_AI,
  ActionType.WIPE_VEHICLES,
  ActionType.SPAWN_ITEM_WORLD,
  ActionType.RELOAD_CONFIG,
  ActionType.GET_PLAYER_DETAILS,
]);

const RCON_CAPABILITIES = new Set([
  ActionType.KICK_PLAYER,
  ActionType.BAN_PLAYER,
]);

// ─── Human-readable Names ───────────────────────────────
const ACTION_LABELS = Object.freeze({
  [ActionType.HEAL_PLAYER]:        'Heal Player',
  [ActionType.KILL_PLAYER]:        'Kill Player',
  [ActionType.TELEPORT_PLAYER]:    'Teleport Player',
  [ActionType.SPAWN_ITEM]:         'Spawn Item',
  [ActionType.STRIP_PLAYER]:       'Strip Inventory',
  [ActionType.EXPLODE_PLAYER]:     'Explode Player',
  [ActionType.MESSAGE_PLAYER]:     'Message Player',
  [ActionType.KICK_PLAYER]:        'Kick Player',
  [ActionType.BAN_PLAYER]:         'Ban Player',
  [ActionType.UNSTUCK_PLAYER]:     'Unstuck Player',
  [ActionType.FREEZE_PLAYER]:      'Freeze Player',
  [ActionType.TELEPORT_TO_PLAYER]: 'Teleport to Player',
  [ActionType.GET_LOADOUT]:        'Get Loadout',
  [ActionType.DELETE_VEHICLE]:     'Delete Vehicle',
  [ActionType.REPAIR_VEHICLE]:     'Repair Vehicle',
  [ActionType.REFUEL_VEHICLE]:     'Refuel Vehicle',
  [ActionType.UNSTUCK_VEHICLE]:    'Unstuck Vehicle',
  [ActionType.EXPLODE_VEHICLE]:    'Explode Vehicle',
  [ActionType.KILL_ENGINE]:        'Kill Engine',
  [ActionType.EJECT_DRIVER]:       'Eject Driver',
  [ActionType.TELEPORT_VEHICLE]:   'Teleport Vehicle',
  [ActionType.SET_TIME]:           'Set Time',
  [ActionType.SET_WEATHER]:        'Set Weather',
  [ActionType.CLEAR_WEATHER]:      'Clear Weather (Sunny)',
  [ActionType.WIPE_AI]:            'Wipe AI',
  [ActionType.WIPE_VEHICLES]:      'Wipe Vehicles',
  [ActionType.SPAWN_ITEM_WORLD]:   'Spawn Item at Position',
  [ActionType.RELOAD_CONFIG]:      'Reload Config',
  [ActionType.GET_PLAYER_DETAILS]: 'Get Player Details',
});

// ─── Audit Code Map ─────────────────────────────────────
// Maps ActionType → audit log code
const AUDIT_CODES = Object.freeze({
  [ActionType.HEAL_PLAYER]:        'action.heal',
  [ActionType.KILL_PLAYER]:        'action.kill',
  [ActionType.TELEPORT_PLAYER]:    'action.teleport',
  [ActionType.SPAWN_ITEM]:         'action.spawn',
  [ActionType.STRIP_PLAYER]:       'action.strip',
  [ActionType.EXPLODE_PLAYER]:     'action.explode',
  [ActionType.MESSAGE_PLAYER]:     'action.message',
  [ActionType.KICK_PLAYER]:        'action.kick',
  [ActionType.BAN_PLAYER]:         'action.ban',
  [ActionType.UNSTUCK_PLAYER]:     'action.unstuck',
  [ActionType.FREEZE_PLAYER]:      'action.freeze',
  [ActionType.TELEPORT_TO_PLAYER]: 'action.teleportToPlayer',
  [ActionType.GET_LOADOUT]:        'action.getLoadout',
  [ActionType.DELETE_VEHICLE]:     'action.vehicle.delete',
  [ActionType.REPAIR_VEHICLE]:     'action.vehicle.repair',
  [ActionType.REFUEL_VEHICLE]:     'action.vehicle.refuel',
  [ActionType.UNSTUCK_VEHICLE]:    'action.vehicle.unstuck',
  [ActionType.EXPLODE_VEHICLE]:    'action.vehicle.explode',
  [ActionType.KILL_ENGINE]:        'action.vehicle.killEngine',
  [ActionType.EJECT_DRIVER]:       'action.vehicle.ejectDriver',
  [ActionType.TELEPORT_VEHICLE]:   'action.vehicle.teleport',
  [ActionType.SET_TIME]:           'action.world.time',
  [ActionType.SET_WEATHER]:        'action.world.weather',
  [ActionType.CLEAR_WEATHER]:      'action.world.sunny',
  [ActionType.WIPE_AI]:            'action.world.wipeAI',
  [ActionType.WIPE_VEHICLES]:      'action.world.wipeVehicles',
  [ActionType.SPAWN_ITEM_WORLD]:   'action.world.spawnItem',
  [ActionType.RELOAD_CONFIG]:      'action.config.reload',
});

// ─── Route ↔ ActionType Maps ────────────────────────────
// Used by vehicle and world route handlers to resolve URL params to ActionTypes.

const VEHICLE_ACTION_MAP = Object.freeze({
  'delete':       ActionType.DELETE_VEHICLE,
  'repair':       ActionType.REPAIR_VEHICLE,
  'refuel':       ActionType.REFUEL_VEHICLE,
  'unstuck':      ActionType.UNSTUCK_VEHICLE,
  'explode':      ActionType.EXPLODE_VEHICLE,
  'kill-engine':  ActionType.KILL_ENGINE,
  'eject-driver': ActionType.EJECT_DRIVER,
  'teleport':     ActionType.TELEPORT_VEHICLE,
});

const WORLD_ACTION_MAP = Object.freeze({
  'set-time':       ActionType.SET_TIME,
  'set-weather':    ActionType.SET_WEATHER,
  'sunny':          ActionType.CLEAR_WEATHER,
  'wipe-ai':        ActionType.WIPE_AI,
  'wipe-vehicles':  ActionType.WIPE_VEHICLES,
});

const PLAYER_ACTION_MAP = Object.freeze({
  'heal':      ActionType.HEAL_PLAYER,
  'kill':      ActionType.KILL_PLAYER,
  'strip':     ActionType.STRIP_PLAYER,
  'explode':   ActionType.EXPLODE_PLAYER,
  'message':   ActionType.MESSAGE_PLAYER,
  'unstuck':   ActionType.UNSTUCK_PLAYER,
  'freeze':    ActionType.FREEZE_PLAYER,
});

module.exports = {
  ActionType,
  LEGACY_SDK_CAPABILITIES,
  INHOUSE_CAPABILITIES,
  RCON_CAPABILITIES,
  ACTION_LABELS,
  AUDIT_CODES,
  VEHICLE_ACTION_MAP,
  WORLD_ACTION_MAP,
  PLAYER_ACTION_MAP,
};
