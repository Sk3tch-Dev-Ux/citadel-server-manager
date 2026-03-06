/**
 * RCON Provider — fallback for basic player management via BattlEye RCON.
 *
 * Only supports kick and ban. All other actions require a richer provider
 * (InHouse sidecar API or CFTools SDK).
 */
const BaseProvider = require('./base');
const ctx = require('../../context');
const { RCON_CAPABILITIES } = require('../types');

class RCONProvider extends BaseProvider {
  constructor() {
    super('RCON');
  }

  getCapabilities() {
    return RCON_CAPABILITIES;
  }

  isAvailable(serverId) {
    const state = ctx.serverStates[serverId];
    return !!(state?.rcon?.loggedIn);
  }

  async kickPlayer(serverId, playerId, reason) {
    const state = ctx.serverStates[serverId];
    if (!state?.rcon) throw new Error('RCON not connected');
    const result = await state.rcon.kick(playerId, reason || 'Kicked by admin');
    // Remove from local player list
    if (state.players) {
      state.players = state.players.filter(p => p.id !== playerId);
      const srv = ctx.servers.find(s => s.id === serverId);
      if (srv && ctx.io) ctx.io.emit('players', { serverId, players: state.players });
    }
    return result;
  }

  async banPlayer(serverId, playerId, reason) {
    const state = ctx.serverStates[serverId];
    if (!state?.rcon) throw new Error('RCON not connected');
    // Ban permanently (-1 = permanent in BattlEye)
    const result = await state.rcon.ban(playerId, reason || 'Banned by admin', -1);
    // Force kick to immediately disconnect and remove character from world
    try { await state.rcon.kick(playerId, reason || 'Banned by admin'); } catch { /* already disconnecting */ }
    // Remove from local player list
    if (state.players) {
      state.players = state.players.filter(p => p.id !== playerId);
      const srv = ctx.servers.find(s => s.id === serverId);
      if (srv && ctx.io) ctx.io.emit('players', { serverId, players: state.players });
    }
    return result;
  }
}

module.exports = RCONProvider;
