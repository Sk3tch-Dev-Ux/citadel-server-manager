/**
 * Live Map API routes — map data, configuration, and map-based actions.
 *
 * All admin actions delegate to the server-actions executor.
 * Map data/config endpoints remain unchanged.
 */
const ctx = require('../lib/context');
const { authForServer } = require('../middleware/auth');
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
  app.get('/api/servers/:id/map/config', authForServer('server.view'), (req, res) => {
    const config = getMapConfig(req.params.id);
    if (!config) return res.status(404).json({ error: 'Server not found' });
    res.json(config);
  });

  // ─── Map Data (players + vehicles + events) ─────────────
  app.get('/api/servers/:id/map/data', authForServer('server.view'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    const data = getMapData(req.params.id);
    data.serverStatus = state.status || 'stopped';
    res.json(data);
  });

  // ─── Teleport Player to Coordinates ─────────────────────
  app.post('/api/servers/:id/map/teleport', authForServer('server.rcon'), async (req, res) => {
    const { steamId, x, y, z } = req.body;
    if (!steamId || x == null || z == null) {
      return res.status(400).json({ error: 'steamId, x, and z required' });
    }

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.TELEPORT_PLAYER);
      // x = east-west, y = altitude (0 = surface), z = north-south
      await provider.teleportPlayer(req.params.id, session, { x, y: y || 0, z });
      addAudit(req.user.id, req.user.username, 'map.teleport',
        `Teleported ${session.playerName} to [${x}, ${y || 0}, ${z}]`);
      res.json({ message: `Teleported ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Vehicle Actions from Map ───────────────────────────
  app.post('/api/servers/:id/map/vehicle-action', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/map/world-action', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/map/spawn-at', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/map/player-action', authForServer('server.rcon'), async (req, res) => {
    const { steamId, action, message } = req.body;
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
        case ActionType.MESSAGE_PLAYER:
          if (!message) return res.status(400).json({ error: 'message is required for MessagePlayer' });
          await provider.messagePlayer(req.params.id, steamId, message);
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
  app.post('/api/servers/:id/map/events', authForServer('server.rcon'), (req, res) => {
    const { type, displayName, position, ttl } = req.body;
    if (!type || !position) return res.status(400).json({ error: 'type and position required' });

    addMapEvent(req.params.id, { type, displayName, position, ttl });
    addAudit(req.user.id, req.user.username, 'map.event.add',
      `Added map event '${displayName || type}' at [${position.x}, ${position.z}]`);
    res.json({ message: 'Event added' });
  });

  app.delete('/api/servers/:id/map/events', authForServer('server.rcon'), (req, res) => {
    clearMapEvents(req.params.id);
    addAudit(req.user.id, req.user.username, 'map.event.clear', 'Cleared all map events');
    res.json({ message: 'Events cleared' });
  });

  // ─── Available Map Icons Reference ──────────────────────
  // Returns the full list of icon names available for custom map markers.
  // Useful for users configuring MapMarkers.json or dynamic events.
  app.get('/api/map/icons', authForServer('server.view'), (req, res) => {
    const icons = [
      // Events
      { name: 'helicrash', category: 'Events', description: 'Helicopter crash site' },
      { name: 'airdrop', category: 'Events', description: 'Airdrop / supply drop' },
      { name: 'contamination', category: 'Events', description: 'Contamination zone' },
      { name: 'horde', category: 'Events', description: 'Infected horde' },
      // Vehicles
      { name: 'car', category: 'Vehicles', description: 'Car / sedan' },
      { name: 'truck', category: 'Vehicles', description: 'Truck' },
      { name: 'boat', category: 'Vehicles', description: 'Sailboat' },
      { name: 'ship', category: 'Vehicles', description: 'Ship / large vessel' },
      { name: 'helicopter', category: 'Vehicles', description: 'Helicopter' },
      // Structures
      { name: 'house', category: 'Structures', description: 'House / building' },
      { name: 'tent', category: 'Structures', description: 'Tent / camp' },
      { name: 'camp', category: 'Structures', description: 'Campsite' },
      { name: 'flag', category: 'Structures', description: 'Flag / territory' },
      // Items & Loot
      { name: 'chest', category: 'Loot', description: 'Chest / crate' },
      { name: 'barrel', category: 'Loot', description: 'Barrel / storage' },
      { name: 'briefcase', category: 'Loot', description: 'Briefcase / loot stash' },
      { name: 'military', category: 'Loot', description: 'Military area' },
      // Utilities
      { name: 'marker', category: 'General', description: 'Generic map pin' },
      { name: 'star', category: 'General', description: 'Star / point of interest' },
      { name: 'warning', category: 'General', description: 'Warning / danger' },
      { name: 'medical', category: 'General', description: 'Medical / hospital' },
      { name: 'food', category: 'General', description: 'Food / restaurant' },
      { name: 'water', category: 'General', description: 'Water source' },
      { name: 'fire', category: 'General', description: 'Fire / campfire' },
      { name: 'lock', category: 'General', description: 'Locked / secured' },
      { name: 'key', category: 'General', description: 'Key / access point' },
      { name: 'bolt', category: 'General', description: 'Power / electricity' },
      { name: 'skull', category: 'General', description: 'Death / danger zone' },
      { name: 'biohazard', category: 'General', description: 'Biohazard / toxic' },
      { name: 'hammer', category: 'General', description: 'Construction / crafting' },
      { name: 'wrench', category: 'General', description: 'Repair / mechanic' },
    ];
    res.json({ icons });
  });
};
