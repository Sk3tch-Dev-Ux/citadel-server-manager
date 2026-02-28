/**
 * GameLabs admin action routes (requires CFTools + GameLabs mod on server).
 */
const ctx = require('../lib/context');
const { getClient, isConfiguredForServer } = require('../lib/cftools-client');
const { addAudit } = require('../lib/audit');
const auth = require('../middleware/auth');

/**
 * Find the active GameSession for a player by steamId.
 */
function findSession(serverId, steamId) {
  const state = ctx.serverStates[serverId];
  const sessions = state?.cftools?.gameSessions || [];
  return sessions.find(s => s.steamId?.id === steamId) || null;
}

module.exports = function(app) {
  // Spawn item on a player
  app.post('/api/servers/:id/gamelabs/spawn-item', auth('server.rcon'), async (req, res) => {
    const { steamId, itemClass, quantity } = req.body;
    if (!steamId || !itemClass) return res.status(400).json({ error: 'steamId and itemClass required' });
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.spawnItem({ session, itemClass, quantity: quantity || 1 });
      addAudit(req.user.id, req.user.username, 'gamelabs.spawn', `Spawned ${itemClass} x${quantity || 1} on ${session.playerName}`);
      res.json({ message: `Spawned ${itemClass} x${quantity || 1}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Heal player
  app.post('/api/servers/:id/gamelabs/heal', auth('server.rcon'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.healPlayer({ session });
      addAudit(req.user.id, req.user.username, 'gamelabs.heal', `Healed ${session.playerName}`);
      res.json({ message: `Healed ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Kill player
  app.post('/api/servers/:id/gamelabs/kill', auth('server.rcon'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.killPlayer({ session });
      addAudit(req.user.id, req.user.username, 'gamelabs.kill', `Killed ${session.playerName}`);
      res.json({ message: `Killed ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Teleport player
  app.post('/api/servers/:id/gamelabs/teleport', auth('server.rcon'), async (req, res) => {
    const { steamId, x, y, z } = req.body;
    if (!steamId || x == null || y == null) return res.status(400).json({ error: 'steamId, x, and y required' });
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.teleport({ session, coordinates: { x, y: z || 0, z: y } });
      addAudit(req.user.id, req.user.username, 'gamelabs.teleport', `Teleported ${session.playerName} to [${x}, ${y}, ${z || 0}]`);
      res.json({ message: `Teleported ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Additional Player Actions (from GameLabs mod) ──────

  // Strip player inventory
  app.post('/api/servers/:id/gamelabs/strip', auth('server.rcon'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode: 'CFCloud_StripPlayer',
        actionContext: 'player',
        referenceKey: steamId,
        parameters: {},
      });
      addAudit(req.user.id, req.user.username, 'gamelabs.strip', `Stripped inventory of ${session.playerName}`);
      res.json({ message: `Stripped ${session.playerName}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Explode player
  app.post('/api/servers/:id/gamelabs/explode', auth('server.rcon'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode: 'CFCloud_ExplodePlayer',
        actionContext: 'player',
        referenceKey: steamId,
        parameters: {},
      });
      addAudit(req.user.id, req.user.username, 'gamelabs.explode', `Exploded ${session.playerName}`);
      res.json({ message: `Exploded ${session.playerName}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Vehicle Actions ───────────────────────────────────

  // Generic vehicle action handler
  app.post('/api/servers/:id/gamelabs/vehicle/:action', auth('server.rcon'), async (req, res) => {
    const { vehicleId } = req.body;
    const action = req.params.action;
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId required' });
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    const actionMap = {
      'delete': 'CFCloud_DeleteVehicle',
      'repair': 'CFCloud_RepairVehicle',
      'refuel': 'CFCloud_RefuelVehicle',
      'unstuck': 'CFCloud_UnstuckVehicle',
      'explode': 'CFCloud_VehicleExplode',
      'kill-engine': 'CFCloud_KillVehicleEngine',
      'eject-driver': 'CFCloud_VehicleEjectDriver',
    };

    const actionCode = actionMap[action];
    if (!actionCode) return res.status(400).json({ error: `Unknown vehicle action: ${action}` });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode,
        actionContext: 'vehicle',
        referenceKey: vehicleId,
        parameters: {},
      });
      addAudit(req.user.id, req.user.username, `gamelabs.vehicle.${action}`, `Vehicle ${action} on ${vehicleId}`);
      res.json({ message: `Vehicle ${action} executed` });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── World Control Actions ─────────────────────────────

  // Set world time
  app.post('/api/servers/:id/gamelabs/world/time', auth('server.rcon'), async (req, res) => {
    const { hour, minute } = req.body;
    if (hour == null) return res.status(400).json({ error: 'hour required' });
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode: 'CFCloud_WorldTime',
        actionContext: 'world',
        referenceKey: '',
        parameters: {
          hour: { dataType: 'int', valueInt: parseInt(hour) },
          minute: { dataType: 'int', valueInt: parseInt(minute || 0) },
        },
      });
      addAudit(req.user.id, req.user.username, 'gamelabs.world.time', `Set time to ${hour}:${minute || '00'}`);
      res.json({ message: `Time set to ${hour}:${minute || '00'}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Set world weather
  app.post('/api/servers/:id/gamelabs/world/weather', auth('server.rcon'), async (req, res) => {
    const { overcast, rain, fog, snow, wind } = req.body;
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    const parameters = {};
    if (overcast != null) parameters.overcast = { dataType: 'float', valueFloat: parseFloat(overcast) };
    if (rain != null) parameters.rain = { dataType: 'float', valueFloat: parseFloat(rain) };
    if (fog != null) parameters.fog = { dataType: 'float', valueFloat: parseFloat(fog) };
    if (snow != null) parameters.snowfall = { dataType: 'float', valueFloat: parseFloat(snow) };
    if (wind != null) parameters.windSpeed = { dataType: 'float', valueFloat: parseFloat(wind) };

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode: 'CFCloud_WorldWeather',
        actionContext: 'world',
        referenceKey: '',
        parameters,
      });
      addAudit(req.user.id, req.user.username, 'gamelabs.world.weather', 'Weather updated');
      res.json({ message: 'Weather updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Clear weather (sunny)
  app.post('/api/servers/:id/gamelabs/world/sunny', auth('server.rcon'), async (req, res) => {
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode: 'CFCloud_WorldWeatherSunny',
        actionContext: 'world',
        referenceKey: '',
        parameters: {},
      });
      addAudit(req.user.id, req.user.username, 'gamelabs.world.sunny', 'Weather set to sunny');
      res.json({ message: 'Weather set to sunny' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Wipe all AI (zombies)
  app.post('/api/servers/:id/gamelabs/world/wipe-ai', auth('server.rcon'), async (req, res) => {
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode: 'CFCloud_WorldWipeAI',
        actionContext: 'world',
        referenceKey: '',
        parameters: {},
      });
      addAudit(req.user.id, req.user.username, 'gamelabs.world.wipeAI', 'Wiped all AI');
      res.json({ message: 'All AI wiped' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Wipe all vehicles
  app.post('/api/servers/:id/gamelabs/world/wipe-vehicles', auth('server.rcon'), async (req, res) => {
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode: 'CFCloud_WorldWipeVehicles',
        actionContext: 'world',
        referenceKey: '',
        parameters: {},
      });
      addAudit(req.user.id, req.user.username, 'gamelabs.world.wipeVehicles', 'Wiped all vehicles');
      res.json({ message: 'All vehicles wiped' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Get player details (stats, playtime, etc.)
  app.get('/api/servers/:id/gamelabs/player/:steamId', auth('players.view'), async (req, res) => {
    if (!isConfiguredForServer(req.params.id)) return res.status(400).json({ error: 'CFTools not configured for this server' });

    try {
      const client = getClient(req.params.id);
      const sdk = require('../lib/cftools-client').getSdkTypes();
      if (!client || !sdk) return res.status(500).json({ error: 'CFTools client unavailable' });

      const player = await client.getPlayerDetails(sdk.SteamId64.of(req.params.steamId));
      res.json({
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
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
