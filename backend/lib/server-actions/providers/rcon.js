/**
 * RCON Provider — fallback for basic player management via BattlEye RCON.
 *
 * Only supports kick and ban. All other actions require a richer provider
 * (InHouse sidecar API).
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
    // Resolve BattlEye slot number — RCON kick requires slot# (0-63), not steamId
    const player = state.players?.find(p => p.id === playerId || p.steamId === playerId);
    const rconId = player?.rconSlot != null ? String(player.rconSlot) : playerId;
    const result = await state.rcon.kick(rconId, reason || 'Kicked by admin');
    // Remove from local player list
    if (state.players) {
      state.players = state.players.filter(p => p.id !== playerId && p.steamId !== playerId);
      const srv = ctx.servers.find(s => s.id === serverId);
      if (srv && ctx.io) ctx.io.emit('players', { serverId, players: state.players });
    }
    return result;
  }

  async banPlayer(serverId, playerId, reason) {
    const state = ctx.serverStates[serverId];
    if (!state?.rcon) throw new Error('RCON not connected');
    // Resolve BattlEye slot number for RCON commands
    const player = state.players?.find(p => p.id === playerId || p.steamId === playerId);
    const rconId = player?.rconSlot != null ? String(player.rconSlot) : playerId;
    // Ban permanently (-1 = permanent in BattlEye)
    const result = await state.rcon.ban(rconId, reason || 'Banned by admin', -1);
    // Force kick to immediately disconnect and remove character from world
    try { await state.rcon.kick(rconId, reason || 'Banned by admin'); } catch { /* already disconnecting */ }
    // Remove from local player list
    if (state.players) {
      state.players = state.players.filter(p => p.id !== playerId && p.steamId !== playerId);
      const srv = ctx.servers.find(s => s.id === serverId);
      if (srv && ctx.io) ctx.io.emit('players', { serverId, players: state.players });
    }
    return result;
  }
}

module.exports = RCONProvider;
