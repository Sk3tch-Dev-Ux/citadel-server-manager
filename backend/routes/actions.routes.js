/**
 * Admin Action routes — vendor-neutral server actions via the provider system.
 *
 * Replaces the old gamelabs.routes.js. All CFCloud_* codes are now hidden
 * inside providers/cftools.js — this file only uses ActionType constants.
 */
const { addAudit } = require('../lib/audit');
const auth = require('../middleware/auth');
const {
  getProviderForAction,
  findSession,
  getCapabilities,
  ActionType,
} = require('../lib/server-actions/executor');
const { AUDIT_CODES, VEHICLE_ACTION_MAP, WORLD_ACTION_MAP } = require('../lib/server-actions/types');

module.exports = function(app) {

  // ─── Capabilities Endpoint (NEW) ──────────────────────
  // Frontend uses this to show/hide action buttons per-server
  app.get('/api/servers/:id/actions/capabilities', auth('server.view'), (req, res) => {
    res.json(getCapabilities(req.params.id));
  });

  // ─── Spawn Item on Player ─────────────────────────────
  app.post('/api/servers/:id/actions/spawn-item', auth('server.rcon'), async (req, res) => {
    const { steamId, itemClass, quantity } = req.body;
    if (!steamId || !itemClass) return res.status(400).json({ error: 'steamId and itemClass required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_ITEM);
      await provider.spawnItem(req.params.id, session, itemClass, quantity || 1);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_ITEM],
        `Spawned ${itemClass} x${quantity || 1} on ${session.playerName}`);
      res.json({ message: `Spawned ${itemClass} x${quantity || 1}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Heal Player ──────────────────────────────────────
  app.post('/api/servers/:id/actions/heal', auth('server.rcon'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.HEAL_PLAYER);
      await provider.healPlayer(req.params.id, session);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.HEAL_PLAYER],
        `Healed ${session.playerName}`);
      res.json({ message: `Healed ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Kill Player ──────────────────────────────────────
  app.post('/api/servers/:id/actions/kill', auth('server.rcon'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.KILL_PLAYER);
      await provider.killPlayer(req.params.id, session);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.KILL_PLAYER],
        `Killed ${session.playerName}`);
      res.json({ message: `Killed ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Teleport Player ─────────────────────────────────
  app.post('/api/servers/:id/actions/teleport', auth('server.rcon'), async (req, res) => {
    const { steamId, x, y, z } = req.body;
    if (!steamId || x == null || y == null) return res.status(400).json({ error: 'steamId, x, and y required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.TELEPORT_PLAYER);
      await provider.teleportPlayer(req.params.id, session, { x, y, z: z || 0 });
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.TELEPORT_PLAYER],
        `Teleported ${session.playerName} to [${x}, ${y}, ${z || 0}]`);
      res.json({ message: `Teleported ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Message Player ─────────────────────────────────
  app.post('/api/servers/:id/actions/message', auth('server.rcon'), async (req, res) => {
    const { steamId, message } = req.body;
    if (!steamId || !message) return res.status(400).json({ error: 'steamId and message required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.MESSAGE_PLAYER);
      await provider.messagePlayer(req.params.id, steamId, message);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.MESSAGE_PLAYER],
        `Messaged ${session.playerName || session.name}: ${message.substring(0, 50)}`);
      res.json({ message: `Message sent to ${session.playerName || session.name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Unstuck Player ─────────────────────────────────
  app.post('/api/servers/:id/actions/unstuck', auth('server.rcon'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.UNSTUCK_PLAYER);
      await provider.unstuckPlayer(req.params.id, session);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.UNSTUCK_PLAYER],
        `Unstuck ${session.playerName || session.name}`);
      res.json({ message: `Unstuck ${session.playerName || session.name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Freeze Player ─────────────────────────────────
  app.post('/api/servers/:id/actions/freeze', auth('server.rcon'), async (req, res) => {
    const { steamId, frozen } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    const isFrozen = frozen !== false && frozen !== 0 && frozen !== '0';

    try {
      const provider = getProviderForAction(req.params.id, ActionType.FREEZE_PLAYER);
      await provider.freezePlayer(req.params.id, session, isFrozen);
      const label = isFrozen ? 'Froze' : 'Unfroze';
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.FREEZE_PLAYER],
        `${label} ${session.playerName || session.name}`);
      res.json({ message: `${label} ${session.playerName || session.name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Teleport To Player ────────────────────────────
  app.post('/api/servers/:id/actions/teleport-to-player', auth('server.rcon'), async (req, res) => {
    const { steamId, targetSteamId } = req.body;
    if (!steamId || !targetSteamId) return res.status(400).json({ error: 'steamId and targetSteamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Source player not found in active sessions' });

    const targetSession = findSession(req.params.id, targetSteamId);
    if (!targetSession) return res.status(404).json({ error: 'Target player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.TELEPORT_TO_PLAYER);
      await provider.teleportToPlayer(req.params.id, session, targetSteamId);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.TELEPORT_TO_PLAYER],
        `Teleported ${session.playerName || session.name} to ${targetSession.playerName || targetSession.name}`);
      res.json({ message: `Teleported to ${targetSession.playerName || targetSession.name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Get Player Loadout ────────────────────────────
  app.get('/api/servers/:id/actions/loadout/:steamId', auth('server.view'), async (req, res) => {
    const { steamId } = req.params;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_LOADOUT);
      const result = await provider.getLoadout(req.params.id, steamId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Strip Player Inventory ───────────────────────────
  app.post('/api/servers/:id/actions/strip', auth('server.rcon'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.STRIP_PLAYER);
      await provider.stripPlayer(req.params.id, steamId);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.STRIP_PLAYER],
        `Stripped inventory of ${session.playerName}`);
      res.json({ message: `Stripped ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Explode Player ───────────────────────────────────
  app.post('/api/servers/:id/actions/explode', auth('server.rcon'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.EXPLODE_PLAYER);
      await provider.explodePlayer(req.params.id, steamId);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.EXPLODE_PLAYER],
        `Exploded ${session.playerName}`);
      res.json({ message: `Exploded ${session.playerName}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Vehicle Teleport (special — needs coordinates) ──
  app.post('/api/servers/:id/actions/vehicle/teleport', auth('server.rcon'), async (req, res) => {
    const { vehicleId, x, y, z } = req.body;
    if (!vehicleId || x == null || z == null) {
      return res.status(400).json({ error: 'vehicleId, x, and z required' });
    }

    try {
      const provider = getProviderForAction(req.params.id, ActionType.TELEPORT_VEHICLE);
      await provider.teleportVehicle(req.params.id, vehicleId, { x, y, z });
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.TELEPORT_VEHICLE],
        `Teleported vehicle ${vehicleId} to [${x}, ${y || 0}, ${z}]`);
      res.json({ message: 'Vehicle teleported' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Vehicle Actions (parameterized) ──────────────────
  app.post('/api/servers/:id/actions/vehicle/:action', auth('server.rcon'), async (req, res) => {
    const { vehicleId } = req.body;
    const action = req.params.action;
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId required' });

    const actionType = VEHICLE_ACTION_MAP[action];
    if (!actionType) return res.status(400).json({ error: `Unknown vehicle action: ${action}` });

    try {
      const provider = getProviderForAction(req.params.id, actionType);
      await provider.vehicleAction(req.params.id, vehicleId, actionType);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[actionType],
        `Vehicle ${action} on ${vehicleId}`);
      res.json({ message: `Vehicle ${action} executed` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── World: Set Time ──────────────────────────────────
  app.post('/api/servers/:id/actions/world/time', auth('server.rcon'), async (req, res) => {
    const { hour, minute } = req.body;
    if (hour == null) return res.status(400).json({ error: 'hour required' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.SET_TIME);
      await provider.setTime(req.params.id, hour, minute);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SET_TIME],
        `Set time to ${hour}:${minute || '00'}`);
      res.json({ message: `Time set to ${hour}:${minute || '00'}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── World: Set Weather ───────────────────────────────
  app.post('/api/servers/:id/actions/world/weather', auth('server.rcon'), async (req, res) => {
    const { overcast, rain, fog, snow, wind } = req.body;

    try {
      const provider = getProviderForAction(req.params.id, ActionType.SET_WEATHER);
      await provider.setWeather(req.params.id, { overcast, rain, fog, snow, wind });
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SET_WEATHER],
        'Weather updated');
      res.json({ message: 'Weather updated' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── World: Clear Weather (Sunny) ─────────────────────
  app.post('/api/servers/:id/actions/world/sunny', auth('server.rcon'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.CLEAR_WEATHER);
      await provider.clearWeather(req.params.id);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.CLEAR_WEATHER],
        'Weather set to sunny');
      res.json({ message: 'Weather set to sunny' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── World: Wipe AI ───────────────────────────────────
  app.post('/api/servers/:id/actions/world/wipe-ai', auth('server.rcon'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.WIPE_AI);
      await provider.wipeAI(req.params.id);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.WIPE_AI],
        'Wiped all AI');
      res.json({ message: 'All AI wiped' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── World: Wipe Vehicles ─────────────────────────────
  app.post('/api/servers/:id/actions/world/wipe-vehicles', auth('server.rcon'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.WIPE_VEHICLES);
      await provider.wipeVehicles(req.params.id);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.WIPE_VEHICLES],
        'Wiped all vehicles');
      res.json({ message: 'All vehicles wiped' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Get Player Details ───────────────────────────────
  app.get('/api/servers/:id/actions/player/:steamId', auth('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_DETAILS);
      const details = await provider.getPlayerDetails(req.params.id, req.params.steamId);
      res.json(details);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Config: Reload ──────────────────────────────────
  app.post('/api/servers/:id/actions/config/reload', auth('server.rcon'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.RELOAD_CONFIG);
      await provider.reloadConfig(req.params.id);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.RELOAD_CONFIG],
        'Reloaded server config');
      res.json({ message: 'Config reloaded' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Backwards Compatibility ──────────────────────────
  // Old /gamelabs/ URLs redirect to /actions/ (307 preserves method)
  // Remove in next major version.
  app.all('/api/servers/:id/gamelabs/*', (req, res) => {
    const newPath = req.originalUrl.replace('/gamelabs/', '/actions/');
    res.redirect(307, newPath);
  });
};
