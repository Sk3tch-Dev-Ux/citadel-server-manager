/**
 * Citadel Sidecar — Main Server
 *
 * Self-hosted REST API that runs alongside a DayZ server to provide
 * enterprise-level admin actions without external API dependencies.
 *
 * Architecture:
 *   Citadel Backend → InHouseProvider → HTTP → THIS SERVER → File Queue → DayZ Mod
 *
 * The sidecar writes command files to a shared directory. The DayZ mod
 * (CitadelAdmin) reads them, executes in-game, and writes response files.
 *
 * Endpoints match the contract defined in InHouseProvider (providers/inhouse.js).
 */
require('dotenv').config();

const express = require('express');
const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');
const { sendCommand, cleanupStaleFiles } = require('./command-queue');
const banStore = require('./ban-store');
const playerStore = require('./player-store');
const gameDataStore = require('./game-data-store');

const app = express();
app.use(express.json());
app.use(auth);

// Convert coords object { x, y, z } to DayZ vector string "x y z"
function coordsToString(coords) {
  if (typeof coords === 'string') return coords;
  return `${coords.x || 0} ${coords.y || 0} ${coords.z || 0}`;
}

// ─── Health Check ────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: require('./package.json').version,
    uptime: process.uptime(),
    queueDir: config.queueDir,
  });
});

// ─── Player Actions ──────────────────────────────────────

app.post('/player/heal', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  try {
    const data = await sendCommand('player.heal', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/kill', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  try {
    const data = await sendCommand('player.kill', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/teleport', async (req, res) => {
  const { steamId, x, y, z } = req.body;
  if (!steamId || x == null || y == null) {
    return res.status(400).json({ ok: false, error: 'steamId, x, and y required' });
  }

  try {
    const data = await sendCommand('player.teleport', {
      steamId,
      x: parseFloat(x),
      y: parseFloat(y),
      z: parseFloat(z || 0),
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/spawnItem', async (req, res) => {
  const { steamId, itemClass, quantity } = req.body;
  if (!steamId || !itemClass) {
    return res.status(400).json({ ok: false, error: 'steamId and itemClass required' });
  }

  try {
    const data = await sendCommand('player.spawnItem', {
      steamId,
      itemClass,
      quantity: Math.min(parseInt(quantity) || 1, 100),
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/strip', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  try {
    const data = await sendCommand('player.strip', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/explode', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  try {
    const data = await sendCommand('player.explode', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/unstuck', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  try {
    const data = await sendCommand('player.unstuck', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/freeze', async (req, res) => {
  const { steamId, frozen } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  try {
    const data = await sendCommand('player.freeze', {
      steamId,
      frozen: frozen != null ? parseInt(frozen) : 1,
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/teleportToPlayer', async (req, res) => {
  const { steamId, targetSteamId } = req.body;
  if (!steamId || !targetSteamId) {
    return res.status(400).json({ ok: false, error: 'steamId and targetSteamId required' });
  }

  try {
    const data = await sendCommand('player.teleportToPlayer', { steamId, targetSteamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/player/loadout', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  try {
    const data = await sendCommand('player.getLoadout', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/message', async (req, res) => {
  const { steamId, message } = req.body;
  if (!steamId || !message) {
    return res.status(400).json({ ok: false, error: 'steamId and message required' });
  }

  try {
    const data = await sendCommand('player.message', { steamId, text: message });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/kick', async (req, res) => {
  const { steamId, reason } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  try {
    const data = await sendCommand('player.kick', {
      steamId,
      reason: reason || 'Kicked by admin',
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/ban', async (req, res) => {
  const { steamId, reason, duration } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  // Store ban locally
  const player = playerStore.findPlayer(steamId);
  const ban = banStore.add(steamId, player?.name, reason, duration);

  // Also kick via the mod
  try {
    await sendCommand('player.kick', {
      steamId,
      reason: reason || 'Banned by admin',
    });
  } catch { /* Player might already be offline */ }

  res.json({ ok: true, data: ban });
});

app.get('/player/details', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });

  const stats = playerStore.getPlayerStats(steamId);
  const player = playerStore.findPlayer(steamId);

  res.json({
    ok: true,
    data: {
      names: stats?.names || (player ? [player.name] : []),
      playtime: stats?.playtimeSeconds || 0,
      sessions: stats?.sessions || 0,
      firstSeen: stats?.firstSeen || null,
      lastSeen: stats?.lastSeen || null,
      statistics: stats ? {
        kills: stats.kills,
        deaths: { total: stats.deaths },
        kdratio: stats.deaths > 0 ? +(stats.kills / stats.deaths).toFixed(2) : stats.kills,
        longestKill: stats.longestKill,
        hits: stats.hits,
        suicides: stats.suicides,
      } : null,
      online: !!player,
      position: player?.position || null,
    },
  });
});

// ─── Player Actions — Health/Status ─────────────────────

app.post('/player/dry', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.dry', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/breakLegs', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.breakLegs', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/makeSick', async (req, res) => {
  const { steamId, diseaseType } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.makeSick', { steamId, diseaseType: diseaseType || 'cholera' });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/cure', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.cure', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/setBloodType', async (req, res) => {
  const { steamId, bloodType } = req.body;
  if (!steamId || !bloodType) return res.status(400).json({ ok: false, error: 'steamId and bloodType required' });
  try {
    const data = await sendCommand('player.setBloodType', { steamId, bloodType });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/forceDrink', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.forceDrink', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/forceEat', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.forceEat', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/knockout', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.knockout', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/wake', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.wake', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/setBleeding', async (req, res) => {
  const { steamId, sourceCount } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.setBleeding', { steamId, sourceCount: parseInt(sourceCount) || 1 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/stopBleeding', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.stopBleeding', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Player Actions — Ability/State ─────────────────────

app.post('/player/dropGear', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.dropGear', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/launch', async (req, res) => {
  const { steamId, power, angle } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.launch', {
      steamId,
      power: parseFloat(power) || 50,
      angle: parseFloat(angle) || 75,
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/setStat', async (req, res) => {
  const { steamId, stat, value } = req.body;
  if (!steamId || !stat) return res.status(400).json({ ok: false, error: 'steamId and stat required' });
  try {
    const data = await sendCommand('player.setStat', { steamId, stat, value: value || '0' });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/ragdoll', async (req, res) => {
  const { steamId, duration } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.ragdoll', { steamId, duration: duration || '5' });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/setGodmode', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.setGodmode', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/removeGodmode', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.removeGodmode', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/setInvisible', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.setInvisible', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/removeInvisible', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.removeInvisible', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/setStaminaInfinite', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.setStaminaInfinite', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/removeStaminaInfinite', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.removeStaminaInfinite', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/respawn', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.respawn', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/clearInventory', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.clearInventory', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/player/fillMagazines', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.fillMagazines', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Player Query Actions ───────────────────────────────

app.get('/player/position', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.getPosition', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/player/info', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.getInfo', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/player/gear', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.getGear', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/player/inventory', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.getInventory', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/player/stats', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.getStats', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/player/full', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.getFull', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/player/gearFull', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.getGearFull', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/player/handsData', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('player.getHandsData', { steamId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Vehicle Actions ─────────────────────────────────────

const VEHICLE_ACTIONS = ['delete', 'repair', 'refuel', 'unstuck', 'explode', 'kill-engine', 'eject-driver'];

// Vehicle teleport has special params (coordinates), handle before parameterized route
app.post('/vehicle/teleport', async (req, res) => {
  const { vehicleId, x, y, z } = req.body;
  if (!vehicleId) return res.status(400).json({ ok: false, error: 'vehicleId required' });

  try {
    const data = await sendCommand('vehicle.teleport', {
      vehicleId,
      x: parseFloat(x || 0),
      y: parseFloat(y || 0),
      z: parseFloat(z || 0),
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/vehicle/:action', async (req, res) => {
  const { action } = req.params;
  const { vehicleId } = req.body;

  if (!VEHICLE_ACTIONS.includes(action)) {
    return res.status(400).json({ ok: false, error: `Unknown vehicle action: ${action}` });
  }
  if (!vehicleId) {
    return res.status(400).json({ ok: false, error: 'vehicleId required' });
  }

  try {
    const data = await sendCommand(`vehicle.${action}`, { vehicleId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── World Actions ───────────────────────────────────────

app.post('/world/time', async (req, res) => {
  const { hour, minute } = req.body;
  if (hour == null) return res.status(400).json({ ok: false, error: 'hour required' });

  try {
    const data = await sendCommand('world.time', {
      hour: parseInt(hour),
      minute: parseInt(minute || 0),
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/world/weather', async (req, res) => {
  const { overcast, rain, fog, snow, wind } = req.body;

  try {
    const data = await sendCommand('world.weather', {
      overcast: overcast != null ? parseFloat(overcast) : undefined,
      rain: rain != null ? parseFloat(rain) : undefined,
      fog: fog != null ? parseFloat(fog) : undefined,
      snow: snow != null ? parseFloat(snow) : undefined,
      wind: wind != null ? parseFloat(wind) : undefined,
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/world/sunny', async (req, res) => {
  try {
    const data = await sendCommand('world.sunny', {});
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/world/wipe-ai', async (req, res) => {
  try {
    const data = await sendCommand('world.wipeAI', {});
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/world/wipe-vehicles', async (req, res) => {
  try {
    const data = await sendCommand('world.wipeVehicles', {});
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/world/spawn-item', async (req, res) => {
  const { itemClass, x, y, z } = req.body;
  if (!itemClass) return res.status(400).json({ ok: false, error: 'itemClass required' });

  try {
    const data = await sendCommand('world.spawnItem', {
      itemClass,
      x: parseFloat(x || 0),
      y: parseFloat(y || 0),
      z: parseFloat(z || 0),
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── World Actions — Extended ───────────────────────────

app.post('/world/set-fog', async (req, res) => {
  const { density } = req.body;
  try {
    const data = await sendCommand('world.setFog', { density: parseFloat(density) || 0 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/world/set-wind', async (req, res) => {
  const { speed, direction } = req.body;
  try {
    const data = await sendCommand('world.setWind', {
      speed: parseFloat(speed) || 0,
      direction: parseFloat(direction) || 0,
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/world/flatten-trees', async (req, res) => {
  const { steamId, radius, x, y, z } = req.body;
  if (!steamId && x == null) return res.status(400).json({ ok: false, error: 'steamId or coordinates required' });
  try {
    const params = { radius: parseFloat(radius) || 50 };
    if (x != null) {
      params.x = parseFloat(x);
      params.y = parseFloat(y || 0);
      params.z = parseFloat(z);
    } else {
      params.steamId = steamId;
    }
    const data = await sendCommand('world.flattenTrees', params);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/world/clear-zombies', async (req, res) => {
  const { steamId, radius, x, y, z } = req.body;
  if (!steamId && x == null) return res.status(400).json({ ok: false, error: 'steamId or coordinates required' });
  try {
    const params = { radius: parseFloat(radius) || 100 };
    if (x != null) {
      params.x = parseFloat(x);
      params.y = parseFloat(y || 0);
      params.z = parseFloat(z);
    } else {
      params.steamId = steamId;
    }
    const data = await sendCommand('world.clearZombies', params);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/world/delete-objects-radius', async (req, res) => {
  const { steamId, radius, objectType, x, y, z } = req.body;
  if (!steamId && x == null) return res.status(400).json({ ok: false, error: 'steamId or coordinates required' });
  try {
    const params = { radius: parseFloat(radius) || 50, objectType: objectType || 'all' };
    if (x != null) {
      params.x = parseFloat(x);
      params.y = parseFloat(y || 0);
      params.z = parseFloat(z);
    } else {
      params.steamId = steamId;
    }
    const data = await sendCommand('world.deleteObjectsRadius', params);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Spawn Actions ──────────────────────────────────────

app.post('/spawn/zombie', async (req, res) => {
  const { steamId, count, coords } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('spawn.zombie', { steamId, count: parseInt(count) || 1, coords });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/animal', async (req, res) => {
  const { steamId, animalType, coords } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('spawn.animal', { steamId, animalType: animalType || 'Animal_CervusElaphus', coords });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/vehicle', async (req, res) => {
  const { steamId, vehicleClass, coords } = req.body;
  if (!steamId || !vehicleClass) return res.status(400).json({ ok: false, error: 'steamId and vehicleClass required' });
  try {
    const data = await sendCommand('spawn.vehicle', { steamId, vehicleClass, coords });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/building', async (req, res) => {
  const { steamId, buildingClass, coords } = req.body;
  if (!steamId || !buildingClass) return res.status(400).json({ ok: false, error: 'steamId and buildingClass required' });
  try {
    const data = await sendCommand('spawn.building', { steamId, buildingClass, coords });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/horde', async (req, res) => {
  const { steamId, count } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('spawn.horde', { steamId, count: parseInt(count) || 20 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/supply-crate', async (req, res) => {
  const { crateType, coords } = req.body;
  if (!coords) return res.status(400).json({ ok: false, error: 'coords required' });
  try {
    const data = await sendCommand('spawn.supplyCrate', { crateType: crateType || 'military', coords: coordsToString(coords) });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/loot-pile', async (req, res) => {
  const { steamId, lootType, coords } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('spawn.lootPile', { steamId, lootType: lootType || 'military', coords });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/item-attached', async (req, res) => {
  const { steamId, itemClass, attachments } = req.body;
  if (!steamId || !itemClass) return res.status(400).json({ ok: false, error: 'steamId and itemClass required' });
  try {
    const data = await sendCommand('spawn.itemAttached', { steamId, itemClass, attachments: attachments || '' });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/item-at', async (req, res) => {
  const { itemClass, coords } = req.body;
  if (!itemClass || !coords) return res.status(400).json({ ok: false, error: 'itemClass and coords required' });
  try {
    const data = await sendCommand('spawn.itemAt', { itemClass, coords: coordsToString(coords) });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/zombie-at', async (req, res) => {
  const { count, coords } = req.body;
  if (!coords) return res.status(400).json({ ok: false, error: 'coords required' });
  try {
    const data = await sendCommand('spawn.zombieAt', { count: parseInt(count) || 1, coords: coordsToString(coords) });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/animal-at', async (req, res) => {
  const { animalType, coords } = req.body;
  if (!coords) return res.status(400).json({ ok: false, error: 'coords required' });
  try {
    const data = await sendCommand('spawn.animalAt', { animalType: animalType || 'Animal_CervusElaphus', coords: coordsToString(coords) });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/fire', async (req, res) => {
  const { steamId, fireType, coords } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('spawn.fire', { steamId, fireType: fireType || 'small', coords });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/smoke', async (req, res) => {
  const { steamId, color, coords } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('spawn.smoke', { steamId, color: color || 'white', coords });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/heli-crash', async (req, res) => {
  const { heliType, coords } = req.body;
  if (!coords) return res.status(400).json({ ok: false, error: 'coords required' });
  try {
    const data = await sendCommand('spawn.heliCrash', { heliType: heliType || 'default', coords: coordsToString(coords) });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/spawn/gas-zone', async (req, res) => {
  const { zoneType, coords } = req.body;
  if (!coords) return res.status(400).json({ ok: false, error: 'coords required' });
  try {
    const data = await sendCommand('spawn.gasZone', { zoneType: zoneType || 'default', coords: coordsToString(coords) });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Structure Actions ──────────────────────────────────

app.post('/structure/open-doors', async (req, res) => {
  const { steamId, radius } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('structure.openDoors', { steamId, radius: parseFloat(radius) || 50 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/structure/close-doors', async (req, res) => {
  const { steamId, radius } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('structure.closeDoors', { steamId, radius: parseFloat(radius) || 50 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/structure/loot-magnet', async (req, res) => {
  const { steamId, radius } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('structure.lootMagnet', { steamId, radius: parseFloat(radius) || 50 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Item Actions ───────────────────────────────────────

app.post('/item/delete', async (req, res) => {
  const { persistentId } = req.body;
  if (!persistentId) return res.status(400).json({ ok: false, error: 'persistentId required' });
  try {
    const data = await sendCommand('item.delete', { persistentId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/item/repair', async (req, res) => {
  const { persistentId } = req.body;
  if (!persistentId) return res.status(400).json({ ok: false, error: 'persistentId required' });
  try {
    const data = await sendCommand('item.repair', { persistentId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Query Actions ──────────────────────────────────────

app.get('/data/online-players', async (req, res) => {
  try {
    const data = await sendCommand('data.onlinePlayers', {});
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/all-players', async (req, res) => {
  try {
    const data = await sendCommand('data.allPlayers', {});
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/server-info', async (req, res) => {
  try {
    const data = await sendCommand('data.serverInfo', {});
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/nearby-vehicles', async (req, res) => {
  const { steamId, radius } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('data.nearbyVehicles', { steamId, radius: parseFloat(radius) || 100 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/vehicle-info', async (req, res) => {
  const { steamId, radius } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('data.vehicleInfo', { steamId, radius: parseFloat(radius) || 50 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/item-details', async (req, res) => {
  const { persistentId } = req.query;
  if (!persistentId) return res.status(400).json({ ok: false, error: 'persistentId required' });
  try {
    const data = await sendCommand('data.itemDetails', { persistentId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/base-objects', async (req, res) => {
  const { steamId, radius } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('data.baseObjects', { steamId, radius: parseFloat(radius) || 100 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/storage-contents', async (req, res) => {
  const { persistentId, steamId, position } = req.query;
  try {
    const data = await sendCommand('data.storageContents', { persistentId, steamId, position });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/all-storage-objects', async (req, res) => {
  try {
    const data = await sendCommand('data.allStorageObjects', {});
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/nearby-players', async (req, res) => {
  const { steamId, radius } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('data.nearbyPlayers', { steamId, radius: parseFloat(radius) || 100 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/nearby-loot', async (req, res) => {
  const { steamId, radius, limit } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('data.nearbyLoot', {
      steamId,
      radius: parseFloat(radius) || 50,
      limit: parseInt(limit) || 100,
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/nearby-entities', async (req, res) => {
  const { steamId, radius } = req.query;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  try {
    const data = await sendCommand('data.nearbyEntities', { steamId, radius: parseFloat(radius) || 100 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/nearby-entities-at', async (req, res) => {
  const { coords, radius } = req.query;
  if (!coords) return res.status(400).json({ ok: false, error: 'coords required' });
  try {
    const data = await sendCommand('data.nearbyEntitiesAt', { coords, radius: parseFloat(radius) || 100 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/data/nearby-loot-at', async (req, res) => {
  const { coords, radius } = req.query;
  if (!coords) return res.status(400).json({ ok: false, error: 'coords required' });
  try {
    const data = await sendCommand('data.nearbyLootAt', { coords, radius: parseFloat(radius) || 50 });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Config Actions ─────────────────────────────────────

app.post('/config/reload', async (req, res) => {
  try {
    const data = await sendCommand('config.reload', {});
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Ban Management ──────────────────────────────────────

app.get('/bans', (req, res) => {
  res.json({ ok: true, data: banStore.list() });
});

app.post('/bans', (req, res) => {
  const { steamId, name, reason, expiration } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  const ban = banStore.add(steamId, name, reason, expiration);
  res.json({ ok: true, data: ban });
});

app.delete('/bans/:id', (req, res) => {
  const removed = banStore.remove(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Ban not found' });
  res.json({ ok: true });
});

app.get('/bans/check/:steamId', (req, res) => {
  res.json({ ok: true, banned: banStore.isBanned(req.params.steamId) });
});

// ─── Player Sessions & Stats ─────────────────────────────

app.get('/players', (req, res) => {
  res.json({ ok: true, data: playerStore.getPlayers() });
});

app.get('/leaderboard', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ ok: true, data: playerStore.getLeaderboard(limit) });
});

app.get('/stats/:steamId', (req, res) => {
  const stats = playerStore.getPlayerStats(req.params.steamId);
  if (!stats) return res.status(404).json({ ok: false, error: 'No stats for player' });
  res.json({ ok: true, data: stats });
});

// ─── Game Data (metrics, vehicles, world events) ────────

app.get('/metrics', (req, res) => {
  const data = gameDataStore.getMetrics();
  if (!data) return res.json({ ok: true, data: null });
  res.json({ ok: true, data });
});

app.get('/vehicles', (req, res) => {
  res.json({ ok: true, data: gameDataStore.getVehicles() });
});

app.get('/world-events', (req, res) => {
  res.json({ ok: true, data: gameDataStore.getWorldEvents() });
});

// ─── Priority Queue (local) ─────────────────────────────

const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const priorityFile = path.join(path.dirname(config.playerDataFile), 'priority-queue.json');

function loadPriority() {
  try {
    if (fs.existsSync(priorityFile)) return JSON.parse(fs.readFileSync(priorityFile, 'utf-8'));
  } catch { /* ignore */ }
  return [];
}

function savePriority(list) {
  fs.writeFileSync(priorityFile, JSON.stringify(list, null, 2));
}

app.get('/priority-queue', (req, res) => {
  res.json({ ok: true, data: loadPriority() });
});

app.post('/priority-queue', (req, res) => {
  const { steamId, name, role, expiration } = req.body;
  if (!steamId) return res.status(400).json({ ok: false, error: 'steamId required' });
  const list = loadPriority();
  const entry = {
    id: uuid(),
    steamId,
    name: name || 'Unknown',
    role: role || 'VIP',
    addedAt: new Date().toISOString(),
    expiresAt: expiration || null,
  };
  list.push(entry);
  savePriority(list);
  res.json({ ok: true, data: entry });
});

app.delete('/priority-queue/:id', (req, res) => {
  let list = loadPriority();
  const before = list.length;
  list = list.filter(e => e.id !== req.params.id);
  if (list.length === before) return res.status(404).json({ ok: false, error: 'Entry not found' });
  savePriority(list);
  res.json({ ok: true });
});

// ─── Background Tasks ────────────────────────────────────

// Refresh player data from mod every 5 seconds
setInterval(() => playerStore.refreshPlayers(), 5000);

// Refresh game data (metrics, vehicles, world events) every 5 seconds
setInterval(() => gameDataStore.refreshMetrics(), 5000);
setInterval(() => gameDataStore.refreshVehicles(), 5000);
setInterval(() => gameDataStore.refreshWorldEvents(), 5000);

// Process event log (kills, deaths) every 10 seconds
setInterval(() => playerStore.processEventLog(), 10000);

// Cleanup stale command files every 60 seconds
setInterval(() => cleanupStaleFiles(), 60000);

// Purge expired bans every 5 minutes
setInterval(() => banStore.purgeExpired(), 300000);

// ─── Start Server ────────────────────────────────────────

app.listen(config.port, () => {
  logger.info({
    port: config.port,
    queueDir: config.queueDir,
    auth: config.apiKey ? 'enabled' : 'disabled (dev mode)',
  }, 'Citadel Sidecar API started');
});
