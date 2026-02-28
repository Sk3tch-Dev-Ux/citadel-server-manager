/**
 * Live Map API routes — map data, configuration, and map-based actions.
 */
const ctx = require('../lib/context');
const auth = require('../middleware/auth');
const { getMapConfig, getMapData, addMapEvent, clearMapEvents } = require('../lib/map-data');
const { getClient, isConfiguredForServer } = require('../lib/cftools-client');
const { addAudit } = require('../lib/audit');

module.exports = function(app) {

  // ─── Map Configuration ──────────────────────────────────
  // Returns map dimensions, image path, and bounds for Leaflet
  app.get('/api/servers/:id/map/config', auth('server.view'), (req, res) => {
    const config = getMapConfig(req.params.id);
    if (!config) return res.status(404).json({ error: 'Server not found' });
    res.json(config);
  });

  // ─── Map Data (players + vehicles + events) ─────────────
  // Full snapshot of all map entities
  app.get('/api/servers/:id/map/data', auth('server.view'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    res.json(getMapData(req.params.id));
  });

  // ─── Teleport Player to Coordinates ─────────────────────
  // Click on map → teleport selected player there
  app.post('/api/servers/:id/map/teleport', auth('server.rcon'), async (req, res) => {
    const { steamId, x, y, z } = req.body;
    if (!steamId || x == null || z == null) {
      return res.status(400).json({ error: 'steamId, x, and z required' });
    }
    if (!isConfiguredForServer(req.params.id)) {
      return res.status(400).json({ error: 'CFTools not configured for this server' });
    }

    const state = ctx.serverStates[req.params.id];
    const sessions = state?.cftools?.gameSessions || [];
    const session = sessions.find(s => s.steamId?.id === steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      // DayZ coords: X=east-west, Z=north-south, Y=altitude
      // CFTools SDK coords: x=X, y=Z(altitude), z=Y(north-south) — swapped!
      await client.teleport({
        session,
        coordinates: { x: parseFloat(x), y: parseFloat(z || 0), z: parseFloat(y || 0) },
      });

      addAudit(req.user.id, req.user.username, 'map.teleport',
        `Teleported ${session.playerName} to [${x}, ${y || 0}, ${z}]`);
      res.json({ message: `Teleported ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Vehicle Actions from Map ───────────────────────────
  app.post('/api/servers/:id/map/vehicle-action', auth('server.rcon'), async (req, res) => {
    const { vehicleId, action } = req.body;
    if (!vehicleId || !action) {
      return res.status(400).json({ error: 'vehicleId and action required' });
    }
    if (!isConfiguredForServer(req.params.id)) {
      return res.status(400).json({ error: 'CFTools not configured for this server' });
    }

    const actionMap = {
      'delete':      'CFCloud_DeleteVehicle',
      'repair':      'CFCloud_RepairVehicle',
      'refuel':      'CFCloud_RefuelVehicle',
      'unstuck':     'CFCloud_UnstuckVehicle',
      'explode':     'CFCloud_VehicleExplode',
      'kill-engine': 'CFCloud_KillVehicleEngine',
      'eject':       'CFCloud_VehicleEjectDriver',
    };

    const actionCode = actionMap[action];
    if (!actionCode) return res.status(400).json({ error: `Unknown action: ${action}` });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode,
        actionContext: 'vehicle',
        referenceKey: vehicleId,
        parameters: {},
      });

      addAudit(req.user.id, req.user.username, `map.vehicle.${action}`,
        `Vehicle action '${action}' on vehicle ${vehicleId}`);
      res.json({ message: `Vehicle ${action} executed` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── World Actions from Map ─────────────────────────────
  app.post('/api/servers/:id/map/world-action', auth('server.rcon'), async (req, res) => {
    const { action, params } = req.body;
    if (!action) return res.status(400).json({ error: 'action required' });
    if (!isConfiguredForServer(req.params.id)) {
      return res.status(400).json({ error: 'CFTools not configured for this server' });
    }

    const actionMap = {
      'set-time':       'CFCloud_WorldTime',
      'set-weather':    'CFCloud_WorldWeather',
      'sunny':          'CFCloud_WorldWeatherSunny',
      'wipe-ai':        'CFCloud_WorldWipeAI',
      'wipe-vehicles':  'CFCloud_WorldWipeVehicles',
    };

    const actionCode = actionMap[action];
    if (!actionCode) return res.status(400).json({ error: `Unknown action: ${action}` });

    // Build parameters based on action type
    const parameters = {};
    if (action === 'set-time' && params) {
      if (params.hour != null) parameters.hour = { dataType: 'int', valueInt: parseInt(params.hour) };
      if (params.minute != null) parameters.minute = { dataType: 'int', valueInt: parseInt(params.minute) };
    }
    if (action === 'set-weather' && params) {
      if (params.overcast != null) parameters.overcast = { dataType: 'float', valueFloat: parseFloat(params.overcast) };
      if (params.rain != null) parameters.rain = { dataType: 'float', valueFloat: parseFloat(params.rain) };
      if (params.fog != null) parameters.fog = { dataType: 'float', valueFloat: parseFloat(params.fog) };
      if (params.snow != null) parameters.snowfall = { dataType: 'float', valueFloat: parseFloat(params.snow) };
      if (params.wind != null) parameters.windSpeed = { dataType: 'float', valueFloat: parseFloat(params.wind) };
    }

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode,
        actionContext: 'world',
        referenceKey: '',
        parameters,
      });

      addAudit(req.user.id, req.user.username, `map.world.${action}`,
        `World action '${action}' executed`);
      res.json({ message: `World ${action} executed` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Spawn Item at World Position ───────────────────────
  app.post('/api/servers/:id/map/spawn-at', auth('server.rcon'), async (req, res) => {
    const { itemClass, x, y, z } = req.body;
    if (!itemClass || x == null || z == null) {
      return res.status(400).json({ error: 'itemClass, x, and z required' });
    }
    if (!isConfiguredForServer(req.params.id)) {
      return res.status(400).json({ error: 'CFTools not configured for this server' });
    }

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      await client.gameLabsAction({
        actionCode: 'CFCloud_SpawnItemWorld',
        actionContext: 'world',
        referenceKey: '',
        parameters: {
          object: { dataType: 'string', valueString: itemClass },
          position: {
            dataType: 'vector',
            valueVectorX: parseFloat(x),
            valueVectorY: parseFloat(y || 0),
            valueVectorZ: parseFloat(z),
          },
        },
      });

      addAudit(req.user.id, req.user.username, 'map.spawn',
        `Spawned ${itemClass} at [${x}, ${y || 0}, ${z}]`);
      res.json({ message: `Spawned ${itemClass}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Player Actions from Map ────────────────────────────
  app.post('/api/servers/:id/map/player-action', auth('server.rcon'), async (req, res) => {
    const { steamId, action } = req.body;
    if (!steamId || !action) {
      return res.status(400).json({ error: 'steamId and action required' });
    }
    if (!isConfiguredForServer(req.params.id)) {
      return res.status(400).json({ error: 'CFTools not configured for this server' });
    }

    const state = ctx.serverStates[req.params.id];
    const sessions = state?.cftools?.gameSessions || [];
    const session = sessions.find(s => s.steamId?.id === steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const client = getClient(req.params.id);
      if (!client) return res.status(500).json({ error: 'CFTools client unavailable' });

      const playerName = session.playerName;

      switch (action) {
        case 'heal':
          await client.healPlayer({ session });
          break;
        case 'kill':
          await client.killPlayer({ session });
          break;
        case 'strip':
          await client.gameLabsAction({
            actionCode: 'CFCloud_StripPlayer',
            actionContext: 'player',
            referenceKey: steamId,
            parameters: {},
          });
          break;
        case 'explode':
          await client.gameLabsAction({
            actionCode: 'CFCloud_ExplodePlayer',
            actionContext: 'player',
            referenceKey: steamId,
            parameters: {},
          });
          break;
        default:
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }

      addAudit(req.user.id, req.user.username, `map.player.${action}`,
        `Player action '${action}' on ${playerName}`);
      res.json({ message: `${action} executed on ${playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Manual Event Management ────────────────────────────
  app.post('/api/servers/:id/map/events', auth('server.rcon'), (req, res) => {
    const { type, displayName, position, ttl } = req.body;
    if (!type || !position) return res.status(400).json({ error: 'type and position required' });

    addMapEvent(req.params.id, { type, displayName, position, ttl });
    addAudit(req.user.id, req.user.username, 'map.event.add',
      `Added map event '${displayName || type}' at [${position.x}, ${position.z}]`);
    res.json({ message: 'Event added' });
  });

  app.delete('/api/servers/:id/map/events', auth('server.rcon'), (req, res) => {
    clearMapEvents(req.params.id);
    addAudit(req.user.id, req.user.username, 'map.event.clear', 'Cleared all map events');
    res.json({ message: 'Events cleared' });
  });
};
