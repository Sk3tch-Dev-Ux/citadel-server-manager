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
