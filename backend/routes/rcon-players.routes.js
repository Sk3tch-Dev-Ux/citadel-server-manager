const { safeError } = require('../lib/http-errors');
/**
 * RCON commands, player management, and per-server ban routes.
 *
 * Ban/unban actions now go through the global ban database.
 * The per-server /bans endpoint returns the global ban list (all bans apply to all servers).
 * All RCON commands are validated against a whitelist for security.
 */
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { addNotification, fireWebhooks } = require('../lib/notifications');
const { banPlayer, listBans, removeBan } = require('../lib/ban-engine');
const { validateCommand, sanitizeCommand, getAllowedCommands } = require('../lib/rcon-validator');
const auth = require('../middleware/auth');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');

module.exports = function(app) {
  // List allowed RCON commands (for the Console page's autocomplete).
  // Always returns the current whitelist with descriptions — no server
  // state needed, but permission-gated the same as `/rcon` itself.
  app.get('/api/servers/:id/rcon/commands', authForServer('server.rcon'), (_req, res) => {
    res.json({ commands: getAllowedCommands() });
  });

  app.post('/api/servers/:id/rcon', authForServer('server.rcon'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });

    // Validate command against whitelist
    const command = req.body.command || '';
    const validation = validateCommand(command);
    if (!validation.valid) {
      logger.warn({ userId: req.user.id, command, reason: validation.reason }, 'RCON command rejected');
      addAudit(req.user.id, req.user.username, 'rcon.rejected', `Blocked RCON command: ${validation.reason}`);
      return res.status(400).json({ error: validation.reason });
    }

    // Sanitize before sending
    const sanitized = sanitizeCommand(command);
    try {
      const result = await state.rcon.send(sanitized);
      addAudit(req.user.id, req.user.username, 'rcon.execute', `Executed: ${sanitized}`);
      res.json({ result });
    } catch (err) {
      logger.error({ err, command: sanitized }, 'RCON execution error');
      safeError(err, req, res, { status: 500 });
    }
  });

  app.post('/api/servers/:id/message', authForServer('chat.send'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
    try {
      await state.rcon.say(req.body.message);
      res.json({ message: 'Sent' });
    } catch (err) { safeError(err, req, res, { status: 500 }); }
  });

  app.get('/api/servers/:id/players', authForServer('players.view'), (req, res) => {
    res.json(ctx.serverStates[req.params.id]?.players || []);
  });

  app.post('/api/servers/:id/players/:playerId/kick', authForServer('players.kick'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
    const kickReason = req.body.reason || 'Kicked';
    // Resolve the BattlEye slot number from player list — RCON kick requires slot# (not steamId)
    const player = state.players?.find(p => p.id === req.params.playerId || p.steamId === req.params.playerId);
    if (!player) return res.status(404).json({ error: 'Player not found or already disconnected' });
    const rconId = player.rconSlot != null ? String(player.rconSlot) : req.params.playerId;
    try {
      await state.rcon.kick(rconId, kickReason);
    } catch (err) {
      return res.status(500).json({ error: `RCON kick failed: ${err.message}` });
    }
    state.players = (state.players || []).filter(p => p.id !== req.params.playerId && p.steamId !== req.params.playerId);
    if (ctx.io) ctx.io.emit('players', { serverId: req.params.id, players: state.players });
    addAudit(req.user.id, req.user.username, 'player.kick', `Kicked player ${player.name || req.params.playerId}`);
    addNotification(req.params.id, 'player.kick', 'Player Kicked', `Player ${player.name || req.params.playerId} was kicked`, 'warning');
    const kickSrv = ctx.servers.find(s => s.id === req.params.id);
    fireWebhooks('player.kick', { serverId: req.params.id, serverName: kickSrv?.name || 'Unknown', playerId: req.params.playerId, reason: kickReason });
    res.json({ message: 'Kicked' });
  });

  app.post('/api/servers/:id/players/:playerId/ban', authForServer('players.ban'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(400).json({ error: 'Server not found' });
    // Use global ban database — includes RCON enforce + kick + player list update
    const ban = await banPlayer(req.params.id, req.params.playerId, req.body.reason, req.body.expiration, req.user.username);
    addAudit(req.user.id, req.user.username, 'player.ban', `Banned player ${req.params.playerId}: ${req.body.reason || 'Banned'}`);
    addNotification(req.params.id, 'player.ban', 'Player Banned', `Player ${req.params.playerId} was banned`, 'error');
    const banSrv = ctx.servers.find(s => s.id === req.params.id);
    fireWebhooks('player.ban', { serverId: req.params.id, serverName: banSrv?.name || 'Unknown', playerId: req.params.playerId, reason: req.body.reason || 'Banned' });
    res.json({ message: 'Banned', ban });
  });

  // Per-server ban list — returns global bans (all bans apply to all servers)
  app.get('/api/servers/:id/bans', authForServer(), async (req, res) => {
    res.json(listBans());
  });

  // Unban via global ban database by ban UUID
  app.delete('/api/servers/:id/bans/:banId', authForServer('players.ban'), async (req, res) => {
    const ban = removeBan(req.params.banId);
    if (!ban) return res.status(404).json({ error: 'Ban not found' });
    addAudit(req.user.id, req.user.username, 'player.unban', `Unbanned ${ban.steamId} (${ban.playerName})`);
    res.json({ message: 'Ban removed', ban });
  });
};
