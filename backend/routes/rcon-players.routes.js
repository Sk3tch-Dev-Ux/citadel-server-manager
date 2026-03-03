/**
 * RCON commands, player management, and ban routes.
 */
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { addNotification, fireWebhooks } = require('../lib/notifications');
const { banPlayer, listBans, unbanPlayer } = require('../lib/cftools-bans');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.post('/api/servers/:id/rcon', auth('server.rcon'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
    try { const result = await state.rcon.send(req.body.command); res.json({ result }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/servers/:id/message', auth('chat.send'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
    await state.rcon.say(req.body.message);
    res.json({ message: 'Sent' });
  });

  app.get('/api/servers/:id/players', auth('players.view'), (req, res) => {
    res.json(ctx.serverStates[req.params.id]?.players || []);
  });

  app.post('/api/servers/:id/players/:playerId/kick', auth('players.kick'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
    await state.rcon.kick(req.params.playerId, req.body.reason || 'Kicked');
    state.players = state.players.filter(p => p.id !== req.params.playerId);
    ctx.io.emit('players', { serverId: req.params.id, players: state.players });
    addAudit(req.user.id, req.user.username, 'player.kick', `Kicked player ${req.params.playerId}`);
    addNotification(req.params.id, 'player.kick', 'Player Kicked', `Player ${req.params.playerId} was kicked`, 'warning');
    const kickSrv = ctx.servers.find(s => s.id === req.params.id);
    fireWebhooks('player.kick', { serverId: req.params.id, serverName: kickSrv?.name || 'Unknown', playerId: req.params.playerId, reason: req.body.reason || 'Kicked' });
    res.json({ message: 'Kicked' });
  });

  app.post('/api/servers/:id/players/:playerId/ban', auth('players.ban'), async (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(400).json({ error: 'Server not found' });
    await banPlayer(req.params.id, req.params.playerId, req.body.reason, req.body.expiration);
    state.players = state.players.filter(p => p.id !== req.params.playerId && p.steamId !== req.params.playerId);
    ctx.io.emit('players', { serverId: req.params.id, players: state.players });
    addAudit(req.user.id, req.user.username, 'player.ban', `Banned player ${req.params.playerId}`);
    addNotification(req.params.id, 'player.ban', 'Player Banned', `Player ${req.params.playerId} was banned`, 'error');
    const banSrv = ctx.servers.find(s => s.id === req.params.id);
    fireWebhooks('player.ban', { serverId: req.params.id, serverName: banSrv?.name || 'Unknown', playerId: req.params.playerId, reason: req.body.reason || 'Banned' });
    res.json({ message: 'Banned' });
  });

  app.get('/api/servers/:id/bans', auth(), async (req, res) => {
    res.json(await listBans(req.params.id));
  });

  app.delete('/api/servers/:id/bans/:banId', auth('players.ban'), async (req, res) => {
    await unbanPlayer(req.params.id, req.params.banId);
    res.json({ message: 'Ban removed' });
  });
};
