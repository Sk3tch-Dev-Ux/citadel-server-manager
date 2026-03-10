/**
 * InHouse Provider — talks to a self-hosted REST API / DayZ server mod
 * that exposes server admin actions via a REST API.
 *
 * Expected API contract (all endpoints are POST):
 *
 *   /player/heal          { steamId }
 *   /player/kill          { steamId }
 *   /player/teleport      { steamId, x, y, z }
 *   /player/spawnItem     { steamId, itemClass, quantity }
 *   /player/strip         { steamId }
 *   /player/explode       { steamId }
 *   /player/kick          { steamId, reason }
 *   /player/ban           { steamId, reason, duration? }
 *   /player/details       { steamId }                      → GET
 *
 *   /vehicle/:action      { vehicleId }
 *     actions: delete, repair, refuel, unstuck, explode, kill-engine, eject-driver
 *
 *   /world/time           { hour, minute }
 *   /world/weather        { overcast?, rain?, fog?, snow?, wind? }
 *   /world/sunny          {}
 *   /world/wipe-ai        {}
 *   /world/wipe-vehicles  {}
 *   /world/spawn-item     { itemClass, x, y, z }
 *
 * The sidecar API must return JSON: { ok: true, ... } on success
 * or { ok: false, error: "..." } on failure with an appropriate HTTP status.
 *
 * Configuration (per-server in servers.json):
 *   inHouseApiUrl:  "http://127.0.0.1:9100"   (base URL, no trailing slash)
 *   inHouseApiKey:  "optional-shared-secret"
 */

const BaseProvider = require('./base');
const ctx = require('../../context');
const logger = require('../../logger');
const { INHOUSE_CAPABILITIES, ActionType } = require('../types');

// ─── Vehicle URL slug mapping ───────────────────────────
const VEHICLE_SLUGS = Object.freeze({
  [ActionType.DELETE_VEHICLE]:    'delete',
  [ActionType.REPAIR_VEHICLE]:    'repair',
  [ActionType.REFUEL_VEHICLE]:    'refuel',
  [ActionType.UNSTUCK_VEHICLE]:   'unstuck',
  [ActionType.EXPLODE_VEHICLE]:   'explode',
  [ActionType.KILL_ENGINE]:       'kill-engine',
  [ActionType.EJECT_DRIVER]:      'eject-driver',
  [ActionType.TELEPORT_VEHICLE]:  'teleport',
});

class InHouseProvider extends BaseProvider {
  constructor() {
    super('InHouse');
  }

  getCapabilities() {
    return INHOUSE_CAPABILITIES;
  }

  /**
   * Available when the server has an inHouseApiUrl configured.
   */
  isAvailable(serverId) {
    const srv = ctx.servers.find(s => s.id === serverId);
    return !!(srv?.inHouseApiUrl);
  }

  // ─── Internal HTTP helper ─────────────────────────────

  /**
   * Send a request to the sidecar REST API.
   *
   * @param {string} serverId
   * @param {'GET'|'POST'} method
   * @param {string} path        - e.g. "/player/heal"
   * @param {object} [body]      - JSON body for POST
   * @returns {Promise<object>}  - Parsed JSON response
   */
  async _request(serverId, method, path, body) {
    const srv = ctx.servers.find(s => s.id === serverId);
    if (!srv?.inHouseApiUrl) throw new Error('InHouse API URL not configured');

    const url = `${srv.inHouseApiUrl.replace(/\/+$/, '')}${path}`;
    const headers = { 'Content-Type': 'application/json' };

    if (srv.inHouseApiKey) {
      headers['Authorization'] = `Bearer ${srv.inHouseApiKey}`;
    }

    const opts = { method, headers };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    logger.debug({ provider: 'InHouse', method, url }, 'Sidecar API request');

    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.ok === false) {
      const msg = json.error || `HTTP ${res.status} from sidecar`;
      logger.error({ provider: 'InHouse', url, status: res.status, error: msg }, 'Sidecar API error');
      throw new Error(`InHouse API: ${msg}`);
    }

    return json;
  }

  _post(serverId, path, body) {
    return this._request(serverId, 'POST', path, body);
  }

  _get(serverId, path) {
    return this._request(serverId, 'GET', path);
  }

  // ─── Player Actions ─────────────────────────────────────

  /**
   * Resolve a steamId from a game session object.
   * The executor passes session objects from findSession(); we extract
   * the steamId for the sidecar API which works with SteamIDs.
   */
  _steamIdFrom(session) {
    // session may be a legacy session object or a plain { steamId } map
    if (typeof session === 'string') return session;
    return session?.steamId?.id || session?.steamId || session?.id || session;
  }

  async healPlayer(serverId, session) {
    await this._post(serverId, '/player/heal', {
      steamId: this._steamIdFrom(session),
    });
  }

  async killPlayer(serverId, session) {
    await this._post(serverId, '/player/kill', {
      steamId: this._steamIdFrom(session),
    });
  }

  async teleportPlayer(serverId, session, coordinates) {
    await this._post(serverId, '/player/teleport', {
      steamId: this._steamIdFrom(session),
      x: parseFloat(coordinates.x),
      y: parseFloat(coordinates.y || 0),
      z: parseFloat(coordinates.z || 0),
    });
  }

  async spawnItem(serverId, session, itemClass, quantity) {
    await this._post(serverId, '/player/spawnItem', {
      steamId: this._steamIdFrom(session),
      itemClass,
      quantity: parseInt(quantity) || 1,
    });
  }

  async stripPlayer(serverId, steamId) {
    await this._post(serverId, '/player/strip', { steamId });
  }

  async explodePlayer(serverId, steamId) {
    await this._post(serverId, '/player/explode', { steamId });
  }

  async messagePlayer(serverId, steamId, message) {
    await this._post(serverId, '/player/message', { steamId, message });
  }

  async kickPlayer(serverId, playerId, reason) {
    await this._post(serverId, '/player/kick', {
      steamId: playerId,
      reason: reason || 'Kicked by admin',
    });
  }

  async banPlayer(serverId, playerId, reason) {
    await this._post(serverId, '/player/ban', {
      steamId: playerId,
      reason: reason || 'Banned by admin',
    });
  }

  async unstuckPlayer(serverId, session) {
    await this._post(serverId, '/player/unstuck', {
      steamId: this._steamIdFrom(session),
    });
  }

  async freezePlayer(serverId, session, frozen) {
    await this._post(serverId, '/player/freeze', {
      steamId: this._steamIdFrom(session),
      frozen: frozen ? 1 : 0,
    });
  }

  async teleportToPlayer(serverId, session, targetSteamId) {
    await this._post(serverId, '/player/teleportToPlayer', {
      steamId: this._steamIdFrom(session),
      targetSteamId,
    });
  }

  async getLoadout(serverId, steamId) {
    return this._get(serverId, `/player/loadout?steamId=${encodeURIComponent(steamId)}`);
  }

  // ─── Player Actions — Health/Status ─────────────────────

  async dryPlayer(serverId, session) {
    await this._post(serverId, '/player/dry', { steamId: this._steamIdFrom(session) });
  }

  async breakLegs(serverId, session) {
    await this._post(serverId, '/player/breakLegs', { steamId: this._steamIdFrom(session) });
  }

  async makeSick(serverId, session, diseaseType) {
    await this._post(serverId, '/player/makeSick', {
      steamId: this._steamIdFrom(session),
      diseaseType: diseaseType || 'cholera',
    });
  }

  async curePlayer(serverId, session) {
    await this._post(serverId, '/player/cure', { steamId: this._steamIdFrom(session) });
  }

  async setBloodType(serverId, session, bloodType) {
    await this._post(serverId, '/player/setBloodType', {
      steamId: this._steamIdFrom(session),
      bloodType,
    });
  }

  async forceDrink(serverId, session) {
    await this._post(serverId, '/player/forceDrink', { steamId: this._steamIdFrom(session) });
  }

  async forceEat(serverId, session) {
    await this._post(serverId, '/player/forceEat', { steamId: this._steamIdFrom(session) });
  }

  async knockoutPlayer(serverId, session) {
    await this._post(serverId, '/player/knockout', { steamId: this._steamIdFrom(session) });
  }

  async wakePlayer(serverId, session) {
    await this._post(serverId, '/player/wake', { steamId: this._steamIdFrom(session) });
  }

  async setBleeding(serverId, session, sourceCount) {
    await this._post(serverId, '/player/setBleeding', {
      steamId: this._steamIdFrom(session),
      sourceCount: parseInt(sourceCount) || 1,
    });
  }

  async stopBleeding(serverId, session) {
    await this._post(serverId, '/player/stopBleeding', { steamId: this._steamIdFrom(session) });
  }

  // ─── Player Actions — Ability/State ─────────────────────

  async dropGear(serverId, session) {
    await this._post(serverId, '/player/dropGear', { steamId: this._steamIdFrom(session) });
  }

  async launchPlayer(serverId, session, power, angle) {
    await this._post(serverId, '/player/launch', {
      steamId: this._steamIdFrom(session),
      power: parseFloat(power) || 50,
      angle: parseFloat(angle) || 75,
    });
  }

  async setStat(serverId, session, stat, value) {
    await this._post(serverId, '/player/setStat', {
      steamId: this._steamIdFrom(session),
      stat,
      value: value || '0',
    });
  }

  async ragdollPlayer(serverId, session, duration) {
    await this._post(serverId, '/player/ragdoll', {
      steamId: this._steamIdFrom(session),
      duration: duration || '5',
    });
  }

  async setGodmode(serverId, session) {
    await this._post(serverId, '/player/setGodmode', { steamId: this._steamIdFrom(session) });
  }

  async removeGodmode(serverId, session) {
    await this._post(serverId, '/player/removeGodmode', { steamId: this._steamIdFrom(session) });
  }

  async setInvisible(serverId, session) {
    await this._post(serverId, '/player/setInvisible', { steamId: this._steamIdFrom(session) });
  }

  async removeInvisible(serverId, session) {
    await this._post(serverId, '/player/removeInvisible', { steamId: this._steamIdFrom(session) });
  }

  async setStaminaInfinite(serverId, session) {
    await this._post(serverId, '/player/setStaminaInfinite', { steamId: this._steamIdFrom(session) });
  }

  async removeStaminaInfinite(serverId, session) {
    await this._post(serverId, '/player/removeStaminaInfinite', { steamId: this._steamIdFrom(session) });
  }

  async respawnPlayer(serverId, session) {
    await this._post(serverId, '/player/respawn', { steamId: this._steamIdFrom(session) });
  }

  async clearInventory(serverId, session) {
    await this._post(serverId, '/player/clearInventory', { steamId: this._steamIdFrom(session) });
  }

  async fillMagazines(serverId, session) {
    await this._post(serverId, '/player/fillMagazines', { steamId: this._steamIdFrom(session) });
  }

  // ─── Player Query Actions ──────────────────────────────

  async getPlayerPosition(serverId, steamId) {
    return this._get(serverId, `/player/position?steamId=${encodeURIComponent(steamId)}`);
  }

  async getPlayerInfo(serverId, steamId) {
    return this._get(serverId, `/player/info?steamId=${encodeURIComponent(steamId)}`);
  }

  async getPlayerGear(serverId, steamId) {
    return this._get(serverId, `/player/gear?steamId=${encodeURIComponent(steamId)}`);
  }

  async getPlayerInventory(serverId, steamId) {
    return this._get(serverId, `/player/inventory?steamId=${encodeURIComponent(steamId)}`);
  }

  async getPlayerStats(serverId, steamId) {
    return this._get(serverId, `/player/stats?steamId=${encodeURIComponent(steamId)}`);
  }

  async getPlayerFull(serverId, steamId) {
    return this._get(serverId, `/player/full?steamId=${encodeURIComponent(steamId)}`);
  }

  async getPlayerGearFull(serverId, steamId) {
    return this._get(serverId, `/player/gearFull?steamId=${encodeURIComponent(steamId)}`);
  }

  async getPlayerHandsData(serverId, steamId) {
    return this._get(serverId, `/player/handsData?steamId=${encodeURIComponent(steamId)}`);
  }

  // ─── Vehicle Actions ────────────────────────────────────

  async vehicleAction(serverId, vehicleId, actionType) {
    const slug = VEHICLE_SLUGS[actionType];
    if (!slug) throw new Error(`Unknown vehicle action type: ${actionType}`);

    await this._post(serverId, `/vehicle/${slug}`, { vehicleId });
  }

  async teleportVehicle(serverId, vehicleId, coordinates) {
    await this._post(serverId, '/vehicle/teleport', {
      vehicleId,
      x: parseFloat(coordinates.x),
      y: parseFloat(coordinates.y || 0),
      z: parseFloat(coordinates.z || 0),
    });
  }

  // ─── World Actions ──────────────────────────────────────

  async setTime(serverId, hour, minute) {
    await this._post(serverId, '/world/time', {
      hour: parseInt(hour),
      minute: parseInt(minute || 0),
    });
  }

  async setWeather(serverId, params) {
    const body = {};
    if (params.overcast != null) body.overcast = parseFloat(params.overcast);
    if (params.rain != null) body.rain = parseFloat(params.rain);
    if (params.fog != null) body.fog = parseFloat(params.fog);
    if (params.snow != null) body.snow = parseFloat(params.snow);
    if (params.wind != null) body.wind = parseFloat(params.wind);

    await this._post(serverId, '/world/weather', body);
  }

  async clearWeather(serverId) {
    await this._post(serverId, '/world/sunny', {});
  }

  async wipeAI(serverId) {
    await this._post(serverId, '/world/wipe-ai', {});
  }

  async wipeVehicles(serverId) {
    await this._post(serverId, '/world/wipe-vehicles', {});
  }

  async spawnItemWorld(serverId, itemClass, position) {
    await this._post(serverId, '/world/spawn-item', {
      itemClass,
      x: parseFloat(position?.x || 0),
      y: parseFloat(position?.y || 0),
      z: parseFloat(position?.z || 0),
    });
  }

  // ─── World Actions — Extended ──────────────────────────

  async setFog(serverId, density) {
    await this._post(serverId, '/world/set-fog', { density: parseFloat(density) || 0 });
  }

  async setWind(serverId, speed, direction) {
    await this._post(serverId, '/world/set-wind', {
      speed: parseFloat(speed) || 0,
      direction: parseFloat(direction) || 0,
    });
  }

  async flattenTrees(serverId, coords, radius) {
    const body = { radius: parseFloat(radius) || 50 };
    if (coords && typeof coords === 'object' && 'x' in coords) {
      body.x = parseFloat(coords.x);
      body.y = parseFloat(coords.y || 0);
      body.z = parseFloat(coords.z);
    } else {
      body.steamId = this._steamIdFrom(coords);
    }
    await this._post(serverId, '/world/flatten-trees', body);
  }

  async clearZombies(serverId, coords, radius) {
    const body = { radius: parseFloat(radius) || 100 };
    if (coords && typeof coords === 'object' && 'x' in coords) {
      body.x = parseFloat(coords.x);
      body.y = parseFloat(coords.y || 0);
      body.z = parseFloat(coords.z);
    } else {
      body.steamId = this._steamIdFrom(coords);
    }
    await this._post(serverId, '/world/clear-zombies', body);
  }

  async deleteObjectsRadius(serverId, coords, radius, objectType) {
    const body = { radius: parseFloat(radius) || 50, objectType: objectType || 'all' };
    if (coords && typeof coords === 'object' && 'x' in coords) {
      body.x = parseFloat(coords.x);
      body.y = parseFloat(coords.y || 0);
      body.z = parseFloat(coords.z);
    } else {
      body.steamId = this._steamIdFrom(coords);
    }
    await this._post(serverId, '/world/delete-objects-radius', body);
  }

  // ─── Spawn Actions ───────────────────────────────────────

  async spawnZombie(serverId, session, count, coords) {
    await this._post(serverId, '/spawn/zombie', {
      steamId: this._steamIdFrom(session),
      count: parseInt(count) || 1,
      coords,
    });
  }

  async spawnAnimal(serverId, session, animalType, coords) {
    await this._post(serverId, '/spawn/animal', {
      steamId: this._steamIdFrom(session),
      animalType: animalType || 'Animal_CervusElaphus',
      coords,
    });
  }

  async spawnVehicle(serverId, session, vehicleClass, coords) {
    await this._post(serverId, '/spawn/vehicle', {
      steamId: this._steamIdFrom(session),
      vehicleClass,
      coords,
    });
  }

  async spawnBuilding(serverId, session, buildingClass, coords) {
    await this._post(serverId, '/spawn/building', {
      steamId: this._steamIdFrom(session),
      buildingClass,
      coords,
    });
  }

  async spawnHorde(serverId, session, count) {
    await this._post(serverId, '/spawn/horde', {
      steamId: this._steamIdFrom(session),
      count: parseInt(count) || 20,
    });
  }

  async spawnSupplyCrate(serverId, crateType, coords) {
    await this._post(serverId, '/spawn/supply-crate', {
      crateType: crateType || 'military',
      coords,
    });
  }

  async spawnLootPile(serverId, session, lootType, coords) {
    await this._post(serverId, '/spawn/loot-pile', {
      steamId: this._steamIdFrom(session),
      lootType: lootType || 'military',
      coords,
    });
  }

  async spawnItemAttached(serverId, session, itemClass, attachments) {
    await this._post(serverId, '/spawn/item-attached', {
      steamId: this._steamIdFrom(session),
      itemClass,
      attachments: attachments || '',
    });
  }

  async spawnItemAt(serverId, itemClass, coords) {
    await this._post(serverId, '/spawn/item-at', { itemClass, coords });
  }

  async spawnZombieAt(serverId, count, coords) {
    await this._post(serverId, '/spawn/zombie-at', { count: parseInt(count) || 1, coords });
  }

  async spawnAnimalAt(serverId, animalType, coords) {
    await this._post(serverId, '/spawn/animal-at', {
      animalType: animalType || 'Animal_CervusElaphus',
      coords,
    });
  }

  async spawnFire(serverId, session, fireType, coords) {
    await this._post(serverId, '/spawn/fire', {
      steamId: this._steamIdFrom(session),
      fireType: fireType || 'small',
      coords,
    });
  }

  async spawnSmoke(serverId, session, color, coords) {
    await this._post(serverId, '/spawn/smoke', {
      steamId: this._steamIdFrom(session),
      color: color || 'white',
      coords,
    });
  }

  async spawnHeliCrash(serverId, heliType, coords) {
    await this._post(serverId, '/spawn/heli-crash', {
      heliType: heliType || 'default',
      coords,
    });
  }

  async spawnGasZone(serverId, zoneType, coords) {
    await this._post(serverId, '/spawn/gas-zone', {
      zoneType: zoneType || 'default',
      coords,
    });
  }

  // ─── Structure Actions ───────────────────────────────────

  async openDoors(serverId, session, radius) {
    await this._post(serverId, '/structure/open-doors', {
      steamId: this._steamIdFrom(session),
      radius: parseFloat(radius) || 50,
    });
  }

  async closeDoors(serverId, session, radius) {
    await this._post(serverId, '/structure/close-doors', {
      steamId: this._steamIdFrom(session),
      radius: parseFloat(radius) || 50,
    });
  }

  async lootMagnet(serverId, session, radius) {
    await this._post(serverId, '/structure/loot-magnet', {
      steamId: this._steamIdFrom(session),
      radius: parseFloat(radius) || 50,
    });
  }

  // ─── Item Actions ────────────────────────────────────────

  async deleteItem(serverId, persistentId) {
    await this._post(serverId, '/item/delete', { persistentId });
  }

  async repairItem(serverId, persistentId) {
    await this._post(serverId, '/item/repair', { persistentId });
  }

  // ─── Data / Query Actions ────────────────────────────────

  async getOnlinePlayers(serverId) {
    return this._get(serverId, '/data/online-players');
  }

  async getAllPlayers(serverId) {
    return this._get(serverId, '/data/all-players');
  }

  async getServerInfo(serverId) {
    return this._get(serverId, '/data/server-info');
  }

  async getNearbyVehicles(serverId, steamId, radius) {
    return this._get(serverId, `/data/nearby-vehicles?steamId=${encodeURIComponent(steamId)}&radius=${radius || 100}`);
  }

  async getVehicleInfo(serverId, steamId, radius) {
    return this._get(serverId, `/data/vehicle-info?steamId=${encodeURIComponent(steamId)}&radius=${radius || 50}`);
  }

  async getItemDetails(serverId, persistentId) {
    return this._get(serverId, `/data/item-details?persistentId=${encodeURIComponent(persistentId)}`);
  }

  async getBaseObjects(serverId, steamId, radius) {
    return this._get(serverId, `/data/base-objects?steamId=${encodeURIComponent(steamId)}&radius=${radius || 100}`);
  }

  async getStorageContents(serverId, persistentId, steamId, position) {
    const params = new URLSearchParams();
    if (persistentId) params.set('persistentId', persistentId);
    if (steamId) params.set('steamId', steamId);
    if (position) params.set('position', position);
    return this._get(serverId, `/data/storage-contents?${params.toString()}`);
  }

  async getAllStorageObjects(serverId) {
    return this._get(serverId, '/data/all-storage-objects');
  }

  async getNearbyPlayers(serverId, steamId, radius) {
    return this._get(serverId, `/data/nearby-players?steamId=${encodeURIComponent(steamId)}&radius=${radius || 100}`);
  }

  async getNearbyLoot(serverId, steamId, radius, limit) {
    return this._get(serverId, `/data/nearby-loot?steamId=${encodeURIComponent(steamId)}&radius=${radius || 50}&limit=${limit || 100}`);
  }

  async getNearbyEntities(serverId, steamId, radius) {
    return this._get(serverId, `/data/nearby-entities?steamId=${encodeURIComponent(steamId)}&radius=${radius || 100}`);
  }

  async getNearbyEntitiesAt(serverId, coords, radius) {
    return this._get(serverId, `/data/nearby-entities-at?coords=${encodeURIComponent(coords)}&radius=${radius || 100}`);
  }

  async getNearbyLootAt(serverId, coords, radius) {
    return this._get(serverId, `/data/nearby-loot-at?coords=${encodeURIComponent(coords)}&radius=${radius || 50}`);
  }

  async unbanPlayer(serverId, steamId) {
    await this._post(serverId, '/bans/unban', { steamId });
  }

  async getBans(serverId) {
    return this._get(serverId, '/bans');
  }

  // ─── Config Actions ─────────────────────────────────────

  async reloadConfig(serverId) {
    await this._post(serverId, '/config/reload', {});
  }

  // ─── Data / Query Actions ──────────────────────────────

  async getPlayerDetails(serverId, steamId) {
    return this._get(serverId, `/player/details?steamId=${encodeURIComponent(steamId)}`);
  }
}

module.exports = InHouseProvider;
