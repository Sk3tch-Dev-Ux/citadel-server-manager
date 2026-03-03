/**
 * Live Map API routes — map data, configuration, and map-based actions.
 *
 * All admin actions delegate to the server-actions executor (no direct
 * CFTools SDK calls). Map data/config endpoints remain unchanged.
 */
const ctx = require('../lib/context');
const auth = require('../middleware/auth');
const { getMapConfig, getMapData, addMapEvent, clearMapEvents } = require('../lib/map-data');
const { addAudit } = require('../lib/audit');
const {
  getProviderForAction,
  findSession,
  ActionType,
} = require('../lib/server-actions/executor');
const { AUDIT_CODES, VEHICLE_ACTION_MAP, WORLD_ACTION_MAP, PLAYER_ACTION_MAP } = require('../lib/server-actions/types');

module.exports = function(app) {

  // ─── Map Configuration ──────────────────────────────────
  app.get('/api/servers/:id/map/config', auth('server.view'), (req, res) => {
    const config = getMapConfig(req.params.id);
    if (!config) return res.status(404).json({ error: 'Server not found' });
    res.json(config);
  });

  // ─── Map Data (players + vehicles + events) ─────────────
  app.get('/api/servers/:id/map/data', auth('server.view'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    const data = getMapData(req.params.id);
    data.serverStatus = state.status || 'stopped';
    res.json(data);
  });

  // ─── Teleport Player to Coordinates ─────────────────────
  app.post('/api/servers/:id/map/teleport', auth('server.rcon'), async (req, res) => {
    const { steamId, x, y, z } = req.body;
    if (!steamId || x == null || z == null) {
      return res.status(400).json({ error: 'steamId, x, and z required' });
    }

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.TELEPORT_PLAYER);
      // Map page sends x/z as horizontal, y as altitude
      await provider.teleportPlayer(req.params.id, session, { x, y: z, z: y || 0 });
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

    const actionType = VEHICLE_ACTION_MAP[action] || VEHICLE_ACTION_MAP[action === 'eject' ? 'eject-driver' : action];
    if (!actionType) return res.status(400).json({ error: `Unknown action: ${action}` });

    try {
      const provider = getProviderForAction(req.params.id, actionType);
      await provider.vehicleAction(req.params.id, vehicleId, actionType);
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

    const actionType = WORLD_ACTION_MAP[action];
    if (!actionType) return res.status(400).json({ error: `Unknown action: ${action}` });

    try {
      const provider = getProviderForAction(req.params.id, actionType);

      switch (actionType) {
        case ActionType.SET_TIME:
          await provider.setTime(req.params.id, params?.hour, params?.minute);
          break;
        case ActionType.SET_WEATHER:
          await provider.setWeather(req.params.id, params || {});
          break;
        case ActionType.CLEAR_WEATHER:
          await provider.clearWeather(req.params.id);
          break;
        case ActionType.WIPE_AI:
          await provider.wipeAI(req.params.id);
          break;
        case ActionType.WIPE_VEHICLES:
          await provider.wipeVehicles(req.params.id);
          break;
      }

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

    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_ITEM_WORLD);
      await provider.spawnItemWorld(req.params.id, itemClass, { x, y: y || 0, z });
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

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    const actionType = PLAYER_ACTION_MAP[action];
    if (!actionType) return res.status(400).json({ error: `Unknown action: ${action}` });

    try {
      const provider = getProviderForAction(req.params.id, actionType);
      const playerName = session.playerName;

      switch (actionType) {
        case ActionType.HEAL_PLAYER:
          await provider.healPlayer(req.params.id, session);
          break;
        case ActionType.KILL_PLAYER:
          await provider.killPlayer(req.params.id, session);
          break;
        case ActionType.STRIP_PLAYER:
          await provider.stripPlayer(req.params.id, steamId);
          break;
        case ActionType.EXPLODE_PLAYER:
          await provider.explodePlayer(req.params.id, steamId);
          break;
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
