/**
 * Citadel Sidecar — Main Server
 *
 * Self-hosted REST API that runs alongside a DayZ server to provide
 * enterprise-level admin actions without CFTools or GameLabs dependency.
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

// ─── Vehicle Actions ─────────────────────────────────────

const VEHICLE_ACTIONS = ['delete', 'repair', 'refuel', 'unstuck', 'explode', 'kill-engine', 'eject-driver'];

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
