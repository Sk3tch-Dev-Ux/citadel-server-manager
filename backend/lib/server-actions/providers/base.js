/**
 * Base Provider — abstract interface for all server action providers.
 *
 * Every provider must implement the methods below. Unsupported actions
 * should throw with a descriptive message so the executor can try the
 * next provider in the chain.
 */
/* eslint-disable no-unused-vars -- abstract method signatures; param names
   document the interface contract that concrete providers implement. */

class BaseProvider {
  constructor(name) {
    this.name = name;
  }

  /** @returns {Set<string>} ActionType values this provider supports */
  getCapabilities() {
    throw new Error(`${this.name}: getCapabilities() not implemented`);
  }

  /** @returns {boolean} Whether this provider is available for the given server */
  isAvailable(serverId) {
    throw new Error(`${this.name}: isAvailable() not implemented`);
  }

  // ─── Player Actions ─────────────────────────────────────
  async healPlayer(serverId, session) { throw new Error(`${this.name} does not support healPlayer`); }
  async killPlayer(serverId, session) { throw new Error(`${this.name} does not support killPlayer`); }
  async teleportPlayer(serverId, session, coordinates) { throw new Error(`${this.name} does not support teleportPlayer`); }
  async spawnItem(serverId, session, itemClass, quantity) { throw new Error(`${this.name} does not support spawnItem`); }
  async stripPlayer(serverId, steamId) { throw new Error(`${this.name} does not support stripPlayer`); }
  async explodePlayer(serverId, steamId) { throw new Error(`${this.name} does not support explodePlayer`); }
  async messagePlayer(serverId, steamId, message) { throw new Error(`${this.name} does not support messagePlayer`); }
  async kickPlayer(serverId, playerId, reason) { throw new Error(`${this.name} does not support kickPlayer`); }
  async banPlayer(serverId, playerId, reason) { throw new Error(`${this.name} does not support banPlayer`); }

  // ─── Vehicle Actions ────────────────────────────────────
  async vehicleAction(serverId, vehicleId, actionType) { throw new Error(`${this.name} does not support vehicleAction`); }

  // ─── World Actions ──────────────────────────────────────
  async setTime(serverId, hour, minute) { throw new Error(`${this.name} does not support setTime`); }
  async setWeather(serverId, params) { throw new Error(`${this.name} does not support setWeather`); }
  async clearWeather(serverId) { throw new Error(`${this.name} does not support clearWeather`); }
  async wipeAI(serverId) { throw new Error(`${this.name} does not support wipeAI`); }
  async wipeVehicles(serverId) { throw new Error(`${this.name} does not support wipeVehicles`); }
  async spawnItemWorld(serverId, itemClass, position) { throw new Error(`${this.name} does not support spawnItemWorld`); }

  // ─── Data / Query Actions ──────────────────────────────
  async getPlayerDetails(serverId, steamId) { throw new Error(`${this.name} does not support getPlayerDetails`); }
}

module.exports = BaseProvider;
