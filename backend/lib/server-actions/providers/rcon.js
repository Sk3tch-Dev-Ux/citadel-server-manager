/**
 * RCON Provider — fallback for basic player management via BattlEye RCON.
 *
 * Only supports kick and ban. All other actions require a richer provider
 * (CFTools or a future custom API).
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
    return state.rcon.ban(playerId, reason || 'Banned by admin');
  }
}

module.exports = RCONProvider;
