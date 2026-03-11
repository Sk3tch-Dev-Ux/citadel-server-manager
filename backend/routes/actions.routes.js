/**
 * Admin Action routes — vendor-neutral server actions via the provider system.
 *
 * Server admin actions — teleport, heal, kick, spawn items, etc.
 * Uses the provider pattern to delegate to the best available backend.
 */
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const {
  getProviderForAction,
  findSession,
  getCapabilities,
  ActionType,
} = require('../lib/server-actions/executor');
const { AUDIT_CODES, VEHICLE_ACTION_MAP, WORLD_ACTION_MAP, SPAWN_ACTION_MAP } = require('../lib/server-actions/types');

module.exports = function(app) {

  // ─── Capabilities Endpoint (NEW) ──────────────────────
  // Frontend uses this to show/hide action buttons per-server
  app.get('/api/servers/:id/actions/capabilities', authForServer('server.view'), (req, res) => {
    res.json(getCapabilities(req.params.id));
  });

  // ─── Spawn Item on Player ─────────────────────────────
  app.post('/api/servers/:id/actions/spawn-item', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/heal', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/kill', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/teleport', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/message', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/unstuck', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/freeze', authForServer('server.rcon'), async (req, res) => {
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

  // ─── Kick Player ──────────────────────────────────
  app.post('/api/servers/:id/actions/kick', authForServer('players.kick'), async (req, res) => {
    const { steamId, reason } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    const kickReason = reason || 'Kicked by admin';

    try {
      // RCON kick shows the reason natively in DayZ ("BattlEye: Admin Kick (reason)").
      // Always prefer RCON kick with the player's BattlEye slot number for reason display.
      const state = require('../lib/context').serverStates[req.params.id];
      const player = state?.players?.find(p => p.steamId === steamId || p.id === steamId);
      let kicked = false;

      if (state?.rcon?.loggedIn && player?.rconSlot != null) {
        // RCON kick with slot number — reason will show in DayZ client
        await state.rcon.kick(player.rconSlot, kickReason);
        kicked = true;
      }

      if (!kicked) {
        // Fall back to provider kick (sidecar/RCON) — reason may not display
        const provider = getProviderForAction(req.params.id, ActionType.KICK_PLAYER);
        await provider.kickPlayer(req.params.id, steamId, kickReason);
      }

      // Remove from cached player list
      if (state) {
        state.players = state.players.filter(p => p.steamId !== steamId && p.id !== steamId);
        require('../lib/context').io.emit('players', { serverId: req.params.id, players: state.players });
      }
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.KICK_PLAYER],
        `Kicked ${session.playerName || session.name}: ${kickReason}`);
      const { addNotification, fireWebhooks } = require('../lib/notifications');
      addNotification(req.params.id, 'player.kick', 'Player Kicked', `${session.playerName || session.name} was kicked`, 'warning');
      const kickSrv = require('../lib/context').servers.find(s => s.id === req.params.id);
      fireWebhooks('player.kick', { serverId: req.params.id, serverName: kickSrv?.name || 'Unknown', playerId: steamId, playerName: session.playerName || session.name, reason: kickReason });
      res.json({ message: `Kicked ${session.playerName || session.name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Ban Player ───────────────────────────────────
  // Routes through the global ban database: persists to bans.json, writes ban.txt,
  // RCON ban + kick for immediate enforcement, and updates the player list.
  app.post('/api/servers/:id/actions/ban', authForServer('players.ban'), async (req, res) => {
    const { steamId, reason } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const { banPlayer } = require('../lib/ban-engine');
      const ban = await banPlayer(req.params.id, steamId, reason || 'Banned by admin', null, req.user.username);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.BAN_PLAYER],
        `Banned ${session.playerName || session.name}: ${reason || 'Banned by admin'}`);
      const { addNotification, fireWebhooks } = require('../lib/notifications');
      addNotification(req.params.id, 'player.ban', 'Player Banned', `${session.playerName || session.name} was banned`, 'error');
      const banSrv = require('../lib/context').servers.find(s => s.id === req.params.id);
      fireWebhooks('player.ban', { serverId: req.params.id, serverName: banSrv?.name || 'Unknown', playerId: steamId, playerName: session.playerName || session.name, reason: reason || 'Banned by admin' });
      res.json({ message: `Banned ${session.playerName || session.name}`, ban });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Teleport To Player ────────────────────────────
  app.post('/api/servers/:id/actions/teleport-to-player', authForServer('server.rcon'), async (req, res) => {
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
  app.get('/api/servers/:id/actions/loadout/:steamId', authForServer('server.view'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/strip', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/explode', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/vehicle/teleport', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/vehicle/:action', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/world/time', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/world/weather', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/world/sunny', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/world/wipe-ai', authForServer('server.rcon'), async (req, res) => {
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
  app.post('/api/servers/:id/actions/world/wipe-vehicles', authForServer('server.rcon'), async (req, res) => {
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
  app.get('/api/servers/:id/actions/player/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_DETAILS);
      const details = await provider.getPlayerDetails(req.params.id, req.params.steamId);
      res.json(details);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Config: Reload ──────────────────────────────────
  app.post('/api/servers/:id/actions/config/reload', authForServer('server.rcon'), async (req, res) => {
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

  // ═══════════════════════════════════════════════════════
  // NEW ACTIONS — from CommandRelay integration
  // ═══════════════════════════════════════════════════════

  // ─── Helper: simple player action (steamId only) ──────
  function playerRoute(app, slug, actionType, providerMethod, label) {
    app.post(`/api/servers/:id/actions/${slug}`, authForServer('server.rcon'), async (req, res) => {
      const { steamId } = req.body;
      if (!steamId) return res.status(400).json({ error: 'steamId required' });

      const session = findSession(req.params.id, steamId);
      if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

      try {
        const provider = getProviderForAction(req.params.id, actionType);
        await provider[providerMethod](req.params.id, session);
        addAudit(req.user.id, req.user.username, AUDIT_CODES[actionType],
          `${label} ${session.playerName || session.name}`);
        res.json({ message: `${label} ${session.playerName || session.name}` });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // Player — Health/Status (simple)
  playerRoute(app, 'dry',            ActionType.DRY_PLAYER,         'dryPlayer',        'Dried');
  playerRoute(app, 'break-legs',     ActionType.BREAK_LEGS,         'breakLegs',        'Broke legs of');
  playerRoute(app, 'cure',           ActionType.CURE_PLAYER,        'curePlayer',       'Cured');
  playerRoute(app, 'force-drink',    ActionType.FORCE_DRINK,        'forceDrink',       'Force-fed drink to');
  playerRoute(app, 'force-eat',      ActionType.FORCE_EAT,          'forceEat',         'Force-fed food to');
  playerRoute(app, 'knockout',       ActionType.KNOCKOUT_PLAYER,    'knockoutPlayer',   'Knocked out');
  playerRoute(app, 'wake',           ActionType.WAKE_PLAYER,        'wakePlayer',       'Woke up');
  playerRoute(app, 'stop-bleeding',  ActionType.STOP_BLEEDING,      'stopBleeding',     'Stopped bleeding on');

  // Player — Ability/State (simple)
  playerRoute(app, 'drop-gear',      ActionType.DROP_GEAR,          'dropGear',         'Dropped gear of');
  playerRoute(app, 'set-godmode',    ActionType.SET_GODMODE,        'setGodmode',       'Enabled god mode on');
  playerRoute(app, 'remove-godmode', ActionType.REMOVE_GODMODE,     'removeGodmode',    'Disabled god mode on');
  playerRoute(app, 'set-invisible',  ActionType.SET_INVISIBLE,      'setInvisible',     'Made invisible');
  playerRoute(app, 'remove-invisible', ActionType.REMOVE_INVISIBLE, 'removeInvisible',  'Made visible');
  playerRoute(app, 'set-stamina-infinite', ActionType.SET_STAMINA_INFINITE, 'setStaminaInfinite', 'Set infinite stamina on');
  playerRoute(app, 'remove-stamina-infinite', ActionType.REMOVE_STAMINA_INFINITE, 'removeStaminaInfinite', 'Removed infinite stamina from');
  playerRoute(app, 'respawn',        ActionType.RESPAWN_PLAYER,     'respawnPlayer',    'Respawned');
  playerRoute(app, 'clear-inventory', ActionType.CLEAR_INVENTORY,   'clearInventory',   'Cleared inventory of');
  playerRoute(app, 'fill-magazines', ActionType.FILL_MAGAZINES,     'fillMagazines',    'Filled magazines of');

  // ─── Make Sick (with disease type param) ───────────────
  app.post('/api/servers/:id/actions/make-sick', authForServer('server.rcon'), async (req, res) => {
    const { steamId, diseaseType } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.MAKE_SICK);
      await provider.makeSick(req.params.id, session, diseaseType);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.MAKE_SICK],
        `Made ${session.playerName || session.name} sick (${diseaseType || 'cholera'})`);
      res.json({ message: `Made ${session.playerName || session.name} sick` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Set Blood Type ────────────────────────────────────
  app.post('/api/servers/:id/actions/set-blood-type', authForServer('server.rcon'), async (req, res) => {
    const { steamId, bloodType } = req.body;
    if (!steamId || !bloodType) return res.status(400).json({ error: 'steamId and bloodType required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.SET_BLOOD_TYPE);
      await provider.setBloodType(req.params.id, session, bloodType);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SET_BLOOD_TYPE],
        `Set blood type of ${session.playerName || session.name} to ${bloodType}`);
      res.json({ message: `Blood type set to ${bloodType}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Set Bleeding (with source count) ──────────────────
  app.post('/api/servers/:id/actions/set-bleeding', authForServer('server.rcon'), async (req, res) => {
    const { steamId, sourceCount } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.SET_BLEEDING);
      await provider.setBleeding(req.params.id, session, sourceCount);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SET_BLEEDING],
        `Set bleeding on ${session.playerName || session.name}`);
      res.json({ message: `Set bleeding on ${session.playerName || session.name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Launch Player (power + angle) ─────────────────────
  app.post('/api/servers/:id/actions/launch', authForServer('server.rcon'), async (req, res) => {
    const { steamId, power, angle } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.LAUNCH_PLAYER);
      await provider.launchPlayer(req.params.id, session, power, angle);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.LAUNCH_PLAYER],
        `Launched ${session.playerName || session.name}`);
      res.json({ message: `Launched ${session.playerName || session.name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Set Player Stat ───────────────────────────────────
  app.post('/api/servers/:id/actions/set-stat', authForServer('server.rcon'), async (req, res) => {
    const { steamId, stat, value } = req.body;
    if (!steamId || !stat) return res.status(400).json({ error: 'steamId and stat required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.SET_STAT);
      await provider.setStat(req.params.id, session, stat, value);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SET_STAT],
        `Set ${stat}=${value} on ${session.playerName || session.name}`);
      res.json({ message: `Set ${stat} to ${value}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Ragdoll Player (with duration) ────────────────────
  app.post('/api/servers/:id/actions/ragdoll', authForServer('server.rcon'), async (req, res) => {
    const { steamId, duration } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });

    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found in active sessions' });

    try {
      const provider = getProviderForAction(req.params.id, ActionType.RAGDOLL_PLAYER);
      await provider.ragdollPlayer(req.params.id, session, duration);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.RAGDOLL_PLAYER],
        `Ragdolled ${session.playerName || session.name}`);
      res.json({ message: `Ragdolled ${session.playerName || session.name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── World: Extended Actions ───────────────────────────

  app.post('/api/servers/:id/actions/world/set-fog', authForServer('server.rcon'), async (req, res) => {
    const { density } = req.body;
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SET_FOG);
      await provider.setFog(req.params.id, density);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SET_FOG],
        `Set fog density to ${density || 0}`);
      res.json({ message: `Fog set to ${density || 0}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/world/set-wind', authForServer('server.rcon'), async (req, res) => {
    const { speed, direction } = req.body;
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SET_WIND);
      await provider.setWind(req.params.id, speed, direction);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SET_WIND],
        `Set wind speed=${speed || 0}, direction=${direction || 0}`);
      res.json({ message: 'Wind updated' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/world/flatten-trees', authForServer('server.rcon'), async (req, res) => {
    const { steamId, radius } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.FLATTEN_TREES);
      await provider.flattenTrees(req.params.id, session, radius);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.FLATTEN_TREES],
        `Flattened trees near ${session.playerName || session.name} (radius: ${radius || 50})`);
      res.json({ message: 'Trees flattened' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/world/clear-zombies', authForServer('server.rcon'), async (req, res) => {
    const { steamId, radius } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.CLEAR_ZOMBIES);
      await provider.clearZombies(req.params.id, session, radius);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.CLEAR_ZOMBIES],
        `Cleared zombies near ${session.playerName || session.name} (radius: ${radius || 100})`);
      res.json({ message: 'Zombies cleared' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/world/delete-objects-radius', authForServer('server.rcon'), async (req, res) => {
    const { steamId, radius, objectType } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.DELETE_OBJECTS_RADIUS);
      await provider.deleteObjectsRadius(req.params.id, session, radius, objectType);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.DELETE_OBJECTS_RADIUS],
        `Deleted ${objectType || 'all'} objects near ${session.playerName || session.name} (radius: ${radius || 50})`);
      res.json({ message: 'Objects deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Spawn Actions ────────────────────────────────────

  app.post('/api/servers/:id/actions/spawn/zombie', authForServer('server.rcon'), async (req, res) => {
    const { steamId, count, coords } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_ZOMBIE);
      await provider.spawnZombie(req.params.id, session, count, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_ZOMBIE],
        `Spawned ${count || 1} zombie(s) near ${session.playerName || session.name}`);
      res.json({ message: `Spawned ${count || 1} zombie(s)` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/animal', authForServer('server.rcon'), async (req, res) => {
    const { steamId, animalType, coords } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_ANIMAL);
      await provider.spawnAnimal(req.params.id, session, animalType, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_ANIMAL],
        `Spawned ${animalType || 'deer'} near ${session.playerName || session.name}`);
      res.json({ message: `Spawned ${animalType || 'deer'}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/vehicle', authForServer('server.rcon'), async (req, res) => {
    const { steamId, vehicleClass, coords } = req.body;
    if (!steamId || !vehicleClass) return res.status(400).json({ error: 'steamId and vehicleClass required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_VEHICLE);
      await provider.spawnVehicle(req.params.id, session, vehicleClass, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_VEHICLE],
        `Spawned vehicle ${vehicleClass} near ${session.playerName || session.name}`);
      res.json({ message: `Spawned ${vehicleClass}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/building', authForServer('server.rcon'), async (req, res) => {
    const { steamId, buildingClass, coords } = req.body;
    if (!steamId || !buildingClass) return res.status(400).json({ error: 'steamId and buildingClass required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_BUILDING);
      await provider.spawnBuilding(req.params.id, session, buildingClass, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_BUILDING],
        `Spawned building ${buildingClass}`);
      res.json({ message: `Spawned ${buildingClass}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/horde', authForServer('server.rcon'), async (req, res) => {
    const { steamId, count } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_HORDE);
      await provider.spawnHorde(req.params.id, session, count);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_HORDE],
        `Spawned horde (${count || 20}) near ${session.playerName || session.name}`);
      res.json({ message: `Spawned horde of ${count || 20}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/supply-crate', authForServer('server.rcon'), async (req, res) => {
    const { crateType, coords } = req.body;
    if (!coords) return res.status(400).json({ error: 'coords required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_SUPPLY_CRATE);
      await provider.spawnSupplyCrate(req.params.id, crateType, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_SUPPLY_CRATE],
        `Spawned supply crate (${crateType || 'military'})`);
      res.json({ message: 'Supply crate spawned' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/loot-pile', authForServer('server.rcon'), async (req, res) => {
    const { steamId, lootType, coords } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_LOOT_PILE);
      await provider.spawnLootPile(req.params.id, session, lootType, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_LOOT_PILE],
        `Spawned loot pile (${lootType || 'military'}) near ${session.playerName || session.name}`);
      res.json({ message: 'Loot pile spawned' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/item-attached', authForServer('server.rcon'), async (req, res) => {
    const { steamId, itemClass, attachments } = req.body;
    if (!steamId || !itemClass) return res.status(400).json({ error: 'steamId and itemClass required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_ITEM_ATTACHED);
      await provider.spawnItemAttached(req.params.id, session, itemClass, attachments);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_ITEM_ATTACHED],
        `Spawned ${itemClass} with attachments on ${session.playerName || session.name}`);
      res.json({ message: `Spawned ${itemClass} with attachments` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/item-at', authForServer('server.rcon'), async (req, res) => {
    const { itemClass, coords } = req.body;
    if (!itemClass || !coords) return res.status(400).json({ error: 'itemClass and coords required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_ITEM_AT);
      await provider.spawnItemAt(req.params.id, itemClass, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_ITEM_AT],
        `Spawned ${itemClass} at ${coords}`);
      res.json({ message: `Spawned ${itemClass}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/zombie-at', authForServer('server.rcon'), async (req, res) => {
    const { count, coords } = req.body;
    if (!coords) return res.status(400).json({ error: 'coords required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_ZOMBIE_AT);
      await provider.spawnZombieAt(req.params.id, count, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_ZOMBIE_AT],
        `Spawned ${count || 1} zombie(s) at ${coords}`);
      res.json({ message: `Spawned ${count || 1} zombie(s)` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/animal-at', authForServer('server.rcon'), async (req, res) => {
    const { animalType, coords } = req.body;
    if (!coords) return res.status(400).json({ error: 'coords required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_ANIMAL_AT);
      await provider.spawnAnimalAt(req.params.id, animalType, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_ANIMAL_AT],
        `Spawned ${animalType || 'deer'} at ${coords}`);
      res.json({ message: `Spawned ${animalType || 'deer'}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/fire', authForServer('server.rcon'), async (req, res) => {
    const { steamId, fireType, coords } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_FIRE);
      await provider.spawnFire(req.params.id, session, fireType, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_FIRE],
        `Spawned fire near ${session.playerName || session.name}`);
      res.json({ message: 'Fire spawned' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/smoke', authForServer('server.rcon'), async (req, res) => {
    const { steamId, color, coords } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_SMOKE);
      await provider.spawnSmoke(req.params.id, session, color, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_SMOKE],
        `Spawned smoke near ${session.playerName || session.name}`);
      res.json({ message: 'Smoke spawned' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/heli-crash', authForServer('server.rcon'), async (req, res) => {
    const { heliType, coords } = req.body;
    if (!coords) return res.status(400).json({ error: 'coords required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_HELI_CRASH);
      await provider.spawnHeliCrash(req.params.id, heliType, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_HELI_CRASH],
        `Spawned heli crash at ${coords}`);
      res.json({ message: 'Heli crash spawned' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/spawn/gas-zone', authForServer('server.rcon'), async (req, res) => {
    const { zoneType, coords } = req.body;
    if (!coords) return res.status(400).json({ error: 'coords required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.SPAWN_GAS_ZONE);
      await provider.spawnGasZone(req.params.id, zoneType, coords);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.SPAWN_GAS_ZONE],
        `Spawned gas zone at ${coords}`);
      res.json({ message: 'Gas zone spawned' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Structure Actions ────────────────────────────────

  app.post('/api/servers/:id/actions/structure/open-doors', authForServer('server.rcon'), async (req, res) => {
    const { steamId, radius } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.OPEN_DOORS);
      await provider.openDoors(req.params.id, session, radius);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.OPEN_DOORS],
        `Opened doors near ${session.playerName || session.name}`);
      res.json({ message: 'Doors opened' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/structure/close-doors', authForServer('server.rcon'), async (req, res) => {
    const { steamId, radius } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.CLOSE_DOORS);
      await provider.closeDoors(req.params.id, session, radius);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.CLOSE_DOORS],
        `Closed doors near ${session.playerName || session.name}`);
      res.json({ message: 'Doors closed' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/structure/loot-magnet', authForServer('server.rcon'), async (req, res) => {
    const { steamId, radius } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    const session = findSession(req.params.id, steamId);
    if (!session) return res.status(404).json({ error: 'Player not found' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.LOOT_MAGNET);
      await provider.lootMagnet(req.params.id, session, radius);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.LOOT_MAGNET],
        `Loot magnet near ${session.playerName || session.name}`);
      res.json({ message: 'Loot magnet activated' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Item Actions ─────────────────────────────────────

  app.post('/api/servers/:id/actions/item/delete', authForServer('server.rcon'), async (req, res) => {
    const { persistentId } = req.body;
    if (!persistentId) return res.status(400).json({ error: 'persistentId required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.DELETE_ITEM);
      await provider.deleteItem(req.params.id, persistentId);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.DELETE_ITEM],
        `Deleted item ${persistentId}`);
      res.json({ message: 'Item deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/item/repair', authForServer('server.rcon'), async (req, res) => {
    const { persistentId } = req.body;
    if (!persistentId) return res.status(400).json({ error: 'persistentId required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.REPAIR_ITEM);
      await provider.repairItem(req.params.id, persistentId);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.REPAIR_ITEM],
        `Repaired item ${persistentId}`);
      res.json({ message: 'Item repaired' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Data / Query Actions ─────────────────────────────

  app.get('/api/servers/:id/actions/data/online-players', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_ONLINE_PLAYERS);
      const data = await provider.getOnlinePlayers(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/all-players', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_ALL_PLAYERS);
      const data = await provider.getAllPlayers(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/server-info', authForServer('server.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_SERVER_INFO);
      const data = await provider.getServerInfo(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/player-position/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_POSITION);
      const data = await provider.getPlayerPosition(req.params.id, req.params.steamId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/player-info/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_INFO);
      const data = await provider.getPlayerInfo(req.params.id, req.params.steamId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/player-gear/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_GEAR);
      const data = await provider.getPlayerGear(req.params.id, req.params.steamId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/player-inventory/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_INVENTORY);
      const data = await provider.getPlayerInventory(req.params.id, req.params.steamId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/player-stats/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_STATS);
      const data = await provider.getPlayerStats(req.params.id, req.params.steamId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/player-full/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_FULL);
      const data = await provider.getPlayerFull(req.params.id, req.params.steamId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/player-gear-full/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_GEAR_FULL);
      const data = await provider.getPlayerGearFull(req.params.id, req.params.steamId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/player-hands/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_PLAYER_HANDS_DATA);
      const data = await provider.getPlayerHandsData(req.params.id, req.params.steamId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/nearby-vehicles/:steamId', authForServer('server.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_NEARBY_VEHICLES);
      const data = await provider.getNearbyVehicles(req.params.id, req.params.steamId, req.query.radius);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/vehicle-info/:steamId', authForServer('server.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_VEHICLE_INFO);
      const data = await provider.getVehicleInfo(req.params.id, req.params.steamId, req.query.radius);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/item-details/:persistentId', authForServer('server.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_ITEM_DETAILS);
      const data = await provider.getItemDetails(req.params.id, req.params.persistentId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/base-objects/:steamId', authForServer('server.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_BASE_OBJECTS);
      const data = await provider.getBaseObjects(req.params.id, req.params.steamId, req.query.radius);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/storage-contents', authForServer('server.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_STORAGE_CONTENTS);
      const data = await provider.getStorageContents(req.params.id, req.query.persistentId, req.query.steamId, req.query.position);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/all-storage-objects', authForServer('server.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_ALL_STORAGE_OBJECTS);
      const data = await provider.getAllStorageObjects(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/nearby-players/:steamId', authForServer('players.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_NEARBY_PLAYERS);
      const data = await provider.getNearbyPlayers(req.params.id, req.params.steamId, req.query.radius);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/nearby-loot/:steamId', authForServer('server.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_NEARBY_LOOT);
      const data = await provider.getNearbyLoot(req.params.id, req.params.steamId, req.query.radius, req.query.limit);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/nearby-entities/:steamId', authForServer('server.view'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_NEARBY_ENTITIES);
      const data = await provider.getNearbyEntities(req.params.id, req.params.steamId, req.query.radius);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/nearby-entities-at', authForServer('server.view'), async (req, res) => {
    const { coords, radius } = req.query;
    if (!coords) return res.status(400).json({ error: 'coords required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_NEARBY_ENTITIES_AT);
      const data = await provider.getNearbyEntitiesAt(req.params.id, coords, radius);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/nearby-loot-at', authForServer('server.view'), async (req, res) => {
    const { coords, radius } = req.query;
    if (!coords) return res.status(400).json({ error: 'coords required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_NEARBY_LOOT_AT);
      const data = await provider.getNearbyLootAt(req.params.id, coords, radius);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/servers/:id/actions/data/bans', authForServer('players.ban'), async (req, res) => {
    try {
      const provider = getProviderForAction(req.params.id, ActionType.GET_BANS);
      const data = await provider.getBans(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/servers/:id/actions/unban', authForServer('players.ban'), async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId required' });
    try {
      const provider = getProviderForAction(req.params.id, ActionType.UNBAN_PLAYER);
      await provider.unbanPlayer(req.params.id, steamId);
      addAudit(req.user.id, req.user.username, AUDIT_CODES[ActionType.UNBAN_PLAYER],
        `Unbanned ${steamId}`);
      res.json({ message: `Unbanned ${steamId}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};
