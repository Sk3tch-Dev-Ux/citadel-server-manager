/**
 * Legacy SDK Provider — wraps optional SDK package behind the provider interface.
 *
 * ALL vendor-specific action codes live HERE and ONLY here.
 * No other file in the project should reference these codes directly.
 */
const BaseProvider = require('./base');
const { getClient, isConfiguredForServer, getSdkTypes } = require('../../legacy-sdk');
const { LEGACY_SDK_CAPABILITIES, ActionType } = require('../types');

// ─── CFCloud Action Code Mapping (PRIVATE) ──────────────
const VEHICLE_CODES = Object.freeze({
  [ActionType.DELETE_VEHICLE]:  'CFCloud_DeleteVehicle',
  [ActionType.REPAIR_VEHICLE]:  'CFCloud_RepairVehicle',
  [ActionType.REFUEL_VEHICLE]:  'CFCloud_RefuelVehicle',
  [ActionType.UNSTUCK_VEHICLE]: 'CFCloud_UnstuckVehicle',
  [ActionType.EXPLODE_VEHICLE]: 'CFCloud_VehicleExplode',
  [ActionType.KILL_ENGINE]:     'CFCloud_KillVehicleEngine',
  [ActionType.EJECT_DRIVER]:    'CFCloud_VehicleEjectDriver',
});

class CFToolsProvider extends BaseProvider {
  constructor() {
    super('LegacySDK');
  }

  getCapabilities() {
    return LEGACY_SDK_CAPABILITIES;
  }

  isAvailable(serverId) {
    return isConfiguredForServer(serverId);
  }

  /** Get or throw a live SDK client */
  _getClient(serverId) {
    const client = getClient(serverId);
    if (!client) throw new Error('Legacy SDK client unavailable');
    return client;
  }

  // ─── Player Actions ─────────────────────────────────────

  async healPlayer(serverId, session) {
    const client = this._getClient(serverId);
    await client.healPlayer({ session });
  }

  async killPlayer(serverId, session) {
    const client = this._getClient(serverId);
    await client.killPlayer({ session });
  }

  async teleportPlayer(serverId, session, coordinates) {
    const client = this._getClient(serverId);
    // DayZ coords: X=east-west, Z=north-south, Y=altitude
    // SDK uses swapped axis: x=X, y=altitude(Z), z=north-south(Y)
    await client.teleport({
      session,
      coordinates: {
        x: parseFloat(coordinates.x),
        y: parseFloat(coordinates.z || 0),
        z: parseFloat(coordinates.y || 0),
      },
    });
  }

  async spawnItem(serverId, session, itemClass, quantity) {
    const client = this._getClient(serverId);
    await client.spawnItem({ session, itemClass, quantity: parseInt(quantity) || 1 });
  }

  async stripPlayer(serverId, steamId) {
    const client = this._getClient(serverId);
    await client.gameLabsAction({
      actionCode: 'CFCloud_StripPlayer',
      actionContext: 'player',
      referenceKey: steamId,
      parameters: {},
    });
  }

  async explodePlayer(serverId, steamId) {
    const client = this._getClient(serverId);
    await client.gameLabsAction({
      actionCode: 'CFCloud_ExplodePlayer',
      actionContext: 'player',
      referenceKey: steamId,
      parameters: {},
    });
  }

  async kickPlayer(serverId, playerId, reason) {
    // SDK also supports kick — can delegate through RCON if available.
    const client = this._getClient(serverId);
    await client.gameLabsAction({
      actionCode: 'CFCloud_KickPlayer',
      actionContext: 'player',
      referenceKey: playerId,
      parameters: { reason: { dataType: 'string', valueString: reason || 'Kicked by admin' } },
    });
  }

  async banPlayer(serverId, playerId, reason) {
    const client = this._getClient(serverId);
    const sdk = getSdkTypes();
    if (!sdk) throw new Error('SDK types unavailable');
    await client.putBan({
      format: 'steam64',
      identifier: playerId,
      reason: reason || 'Banned by admin',
      expiration: 'permanent',
    });
  }

  // ─── Vehicle Actions ────────────────────────────────────

  async vehicleAction(serverId, vehicleId, actionType) {
    const actionCode = VEHICLE_CODES[actionType];
    if (!actionCode) throw new Error(`Unknown vehicle action type: ${actionType}`);

    const client = this._getClient(serverId);
    await client.gameLabsAction({
      actionCode,
      actionContext: 'vehicle',
      referenceKey: vehicleId,
      parameters: {},
    });
  }

  // ─── World Actions ──────────────────────────────────────

  async setTime(serverId, hour, minute) {
    const client = this._getClient(serverId);
    await client.gameLabsAction({
      actionCode: 'CFCloud_WorldTime',
      actionContext: 'world',
      referenceKey: '',
      parameters: {
        hour: { dataType: 'int', valueInt: parseInt(hour) },
        minute: { dataType: 'int', valueInt: parseInt(minute || 0) },
      },
    });
  }

  async setWeather(serverId, params) {
    const client = this._getClient(serverId);
    const parameters = {};
    if (params.overcast != null) parameters.overcast = { dataType: 'float', valueFloat: parseFloat(params.overcast) };
    if (params.rain != null) parameters.rain = { dataType: 'float', valueFloat: parseFloat(params.rain) };
    if (params.fog != null) parameters.fog = { dataType: 'float', valueFloat: parseFloat(params.fog) };
    if (params.snow != null) parameters.snowfall = { dataType: 'float', valueFloat: parseFloat(params.snow) };
    if (params.wind != null) parameters.windSpeed = { dataType: 'float', valueFloat: parseFloat(params.wind) };

    await client.gameLabsAction({
      actionCode: 'CFCloud_WorldWeather',
      actionContext: 'world',
      referenceKey: '',
      parameters,
    });
  }

  async clearWeather(serverId) {
    const client = this._getClient(serverId);
    await client.gameLabsAction({
      actionCode: 'CFCloud_WorldWeatherSunny',
      actionContext: 'world',
      referenceKey: '',
      parameters: {},
    });
  }

  async wipeAI(serverId) {
    const client = this._getClient(serverId);
    await client.gameLabsAction({
      actionCode: 'CFCloud_WorldWipeAI',
      actionContext: 'world',
      referenceKey: '',
      parameters: {},
    });
  }

  async wipeVehicles(serverId) {
    const client = this._getClient(serverId);
    await client.gameLabsAction({
      actionCode: 'CFCloud_WorldWipeVehicles',
      actionContext: 'world',
      referenceKey: '',
      parameters: {},
    });
  }

  async spawnItemWorld(serverId, itemClass, position) {
    const client = this._getClient(serverId);
    await client.gameLabsAction({
      actionCode: 'CFCloud_SpawnItemWorld',
      actionContext: 'world',
      referenceKey: '',
      parameters: {
        object: { dataType: 'string', valueString: itemClass },
        position: {
          dataType: 'vector',
          valueVectorX: parseFloat(position.x),
          valueVectorY: parseFloat(position.y || 0),
          valueVectorZ: parseFloat(position.z),
        },
      },
    });
  }

  // ─── Data / Query Actions ──────────────────────────────

  async getPlayerDetails(serverId, steamId) {
    const client = this._getClient(serverId);
    const sdk = getSdkTypes();
    if (!sdk) throw new Error('SDK types unavailable');

    const player = await client.getPlayerDetails(sdk.SteamId64.of(steamId));
    return {
      names: player.names,
      playtime: player.playtime,
      sessions: player.sessions,
      firstSeen: player.firstSeen,
      lastSeen: player.lastSeen,
      statistics: player.statistics?.dayz ? {
        kills: player.statistics.dayz.kills?.players || 0,
        deaths: {
          total: (player.statistics.dayz.deaths?.other || 0) +
                 (player.statistics.dayz.deaths?.infected || 0) +
                 (player.statistics.dayz.deaths?.animals || 0) +
                 (player.statistics.dayz.deaths?.environment || 0) +
                 (player.statistics.dayz.deaths?.explosions || 0) +
                 (player.statistics.dayz.deaths?.suicides || 0),
          ...player.statistics.dayz.deaths,
        },
        kdratio: player.statistics.dayz.kdratio || 0,
        longestKill: player.statistics.dayz.longestKill || 0,
        longestShot: player.statistics.dayz.longestShot || 0,
        hits: player.statistics.dayz.hits || 0,
        zones: player.statistics.dayz.zones || {},
      } : null,
    };
  }
}

module.exports = CFToolsProvider;
