/**
 * Discord bot action endpoint with API key authentication.
 *
 * Uses shared lifecycle functions for start/stop/restart (same as web panel).
 * Includes audit logging and Discord user attribution for all mutating actions.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ctx = require('../lib/context');
const { sanitizeString } = require('../lib/helpers');
const { downloadWorkshopMod } = require('../lib/steamcmd');
const { installModToServer, updateLaunchParamsMods } = require('../lib/mod-manager');
const { listBans } = require('../lib/ban-engine');
const { getProviderForAction, findSession, ActionType } = require('../lib/server-actions/executor');
const { startServer, stopServer, restartServer } = require('../lib/server-lifecycle');
const { addAudit, addLog } = require('../lib/audit');
const { addNotification, fireWebhooks } = require('../lib/notifications');

const ALLOWED_ACTIONS = [
  'status', 'start', 'stop', 'restart', 'players', 'lock', 'unlock', 'rcon', 'message', 'kick',
  'mods', 'modStatus', 'modInstall', 'modUninstall', 'modEnable', 'modDisable',
  'chatFeed', 'banWhitelist', 'watchList', 'priorityQueue', 'timeWeather', 'killfeed', 'leaderboard',
  'playerInfo', 'actionHeal', 'actionKill', 'actionTeleport', 'actionSpawnItem',
  'actionUnstuck', 'actionFreeze', 'actionStrip', 'actionExplode', 'actionMessage',
  'servers',
];

module.exports = function(app) {
  app.post('/api/discord/action', async (req, res) => {
    const { action, apiKey, params } = req.body;
    const expectedKey = process.env.DISCORD_BOT_API_KEY;
    if (!expectedKey) return res.status(500).json({ error: 'DISCORD_BOT_API_KEY not configured on server' });
    if (!apiKey || typeof apiKey !== 'string') return res.status(400).json({ error: 'API key required' });
    const apiKeyBuf = Buffer.from(apiKey);
    const expectedKeyBuf = Buffer.from(expectedKey);
    if (apiKeyBuf.length !== expectedKeyBuf.length || !crypto.timingSafeEqual(apiKeyBuf, expectedKeyBuf)) {
      return res.status(403).json({ error: 'Invalid API key' });
    }
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `Invalid action: ${sanitizeString(String(action || ''))}` });
    }

    // Discord user attribution from bot
    const discordUser = params?.discordUser || 'Discord Bot';
    const discordUserId = params?.discordUserId || 'bot';

    // Support multi-server: use params.serverId if provided, otherwise default to first server
    const targetSrv = (params?.serverId && ctx.servers.find(s => s.id === params.serverId)) || ctx.servers[0];
    const state = targetSrv ? ctx.serverStates[targetSrv.id] : null;

    switch (action) {
      case 'servers':
        return res.json({
          servers: ctx.servers.map(s => {
            const st = ctx.serverStates[s.id];
            return {
              id: s.id, name: s.name,
              status: st?.status || 'unknown',
              playerCount: st?.players?.length || 0,
              maxPlayers: s.maxPlayers || st?.config?.maxPlayers || 60,
              map: s.map || 'unknown',
            };
          }),
        });

      case 'status': {
        const metrics = state?.metricsHistory || {};
        const cpu = metrics.cpu?.length ? metrics.cpu[metrics.cpu.length - 1] : 0;
        const ram = metrics.ram?.length ? metrics.ram[metrics.ram.length - 1] : 0;
        const fps = metrics.fps?.length ? metrics.fps[metrics.fps.length - 1] : 0;
        const ramMB = state?.pid ? Math.round((ram / 100) * require('os').totalmem() / (1024 * 1024)) : 0;
        return res.json({
          serverId: targetSrv?.id,
          status: state?.status || 'unknown',
          players: state?.players || [],
          playerCount: state?.players?.length || 0,
          maxPlayers: targetSrv?.maxPlayers || state?.config?.maxPlayers || 60,
          serverName: targetSrv?.name || 'DayZ Server',
          cpu: Math.round(cpu * 10) / 10,
          ram: Math.round(ram * 10) / 10,
          ramMB,
          fps: Math.round(fps * 10) / 10,
          startedAt: state?.startedAt || null,
          map: targetSrv?.map || 'unknown',
          ip: targetSrv?.ip || '0.0.0.0',
          gamePort: targetSrv?.gamePort || 2302,
          queryPort: targetSrv?.queryPort || 2303,
          modCount: state?.modList?.length || 0,
          version: state?.config?.version || null,
        });
      }

      case 'start': {
        if (!targetSrv) return res.status(400).json({ error: 'No server' });
        addAudit(discordUserId, discordUser, 'server.start', `Started via Discord: ${targetSrv.name}`);
        const result = await startServer(targetSrv.id, `Started via Discord by ${discordUser}`);
        if (result.success) return res.json({ message: result.message });
        return res.status(500).json({ error: result.error });
      }

      case 'stop': {
        if (!targetSrv) return res.status(400).json({ error: 'No server' });
        addAudit(discordUserId, discordUser, 'server.stop', `Stopped via Discord: ${targetSrv.name}`);
        const result = await stopServer(targetSrv.id, `Stopped via Discord by ${discordUser}`);
        if (result.success) return res.json({ message: result.message });
        return res.status(500).json({ error: result.error });
      }

      case 'restart': {
        if (!targetSrv) return res.status(400).json({ error: 'No server' });
        addAudit(discordUserId, discordUser, 'server.restart', `Restarting via Discord: ${targetSrv.name}`);
        const result = await restartServer(targetSrv.id, `Restarted via Discord by ${discordUser}`);
        if (result.success) return res.json({ message: 'Restarting...' });
        return res.status(500).json({ error: result.error });
      }

      case 'players':
        return res.json({ players: state?.players || [] });

      case 'lock':
        if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
        try {
          await state.rcon.lock();
          addAudit(discordUserId, discordUser, 'server.lock', `Server locked via Discord`);
          return res.json({ message: 'Server locked' });
        } catch (err) { return res.status(500).json({ error: err.message }); }

      case 'unlock':
        if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
        try {
          await state.rcon.unlock();
          addAudit(discordUserId, discordUser, 'server.unlock', `Server unlocked via Discord`);
          return res.json({ message: 'Server unlocked' });
        } catch (err) { return res.status(500).json({ error: err.message }); }

      case 'rcon':
        if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
        try {
          const result = await state.rcon.send(params?.command || '');
          addAudit(discordUserId, discordUser, 'rcon.command', `RCON: ${sanitizeString(params?.command || '')}`);
          return res.json({ result });
        } catch (err) { return res.status(500).json({ error: err.message }); }

      case 'message':
        if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
        try {
          await state.rcon.say(params?.message || '');
          addAudit(discordUserId, discordUser, 'server.broadcast', `Broadcast via Discord`);
          return res.json({ message: 'Sent' });
        } catch (err) { return res.status(500).json({ error: err.message }); }

      case 'kick':
        if (!state?.rcon) return res.status(400).json({ error: 'RCON not configured' });
        try {
          const kickReason = params?.reason || 'Kicked via Discord';
          // Resolve BattlEye slot number — RCON kick requires slot# for reason display
          const kickPlayer = state.players?.find(p => p.id === params?.playerId || p.steamId === params?.playerId);
          const kickRconId = kickPlayer?.rconSlot != null ? String(kickPlayer.rconSlot) : params?.playerId;
          await state.rcon.kick(kickRconId, kickReason);
          state.players = state.players.filter(p => p.id !== params?.playerId && p.steamId !== params?.playerId);
          ctx.io.emit('players', { serverId: targetSrv.id, players: state.players });
          addAudit(discordUserId, discordUser, 'player.kick', `Kicked ${kickPlayer?.name || params?.playerId}: ${kickReason}`);
          fireWebhooks('player.kick', { serverId: targetSrv.id, playerId: params?.playerId, reason: kickReason });
          return res.json({ message: 'Kicked' });
        } catch (err) { return res.status(500).json({ error: err.message }); }

      case 'mods':
        return res.json({ mods: state?.modList || [] });

      case 'modStatus':
        return res.json(ctx.activeInstalls);

      case 'modInstall': {
        const { workshopId, name } = params || {};
        if (!workshopId || !name) return res.status(400).json({ error: 'workshopId and name required' });
        if (ctx.activeInstalls[workshopId]?.status === 'downloading') return res.status(409).json({ error: 'Already downloading' });
        ctx.activeInstalls[workshopId] = { status: 'starting', progress: 0, name };
        addAudit(discordUserId, discordUser, 'mod.install', `Installing mod ${name} (${workshopId}) via Discord`);
        res.json({ message: 'Download started', workshopId });
        downloadWorkshopMod(String(workshopId), name, targetSrv.id)
          .then(contentPath => {
            ctx.activeInstalls[workshopId] = { status: 'installing', progress: 90, name };
            const folderName = installModToServer(contentPath, name, String(workshopId), targetSrv.installDir);
            state.modList.push({ name: folderName, workshopId: String(workshopId), enabled: true, order: state.modList.length });
            updateLaunchParamsMods(targetSrv.id);
            ctx.activeInstalls[workshopId] = { status: 'complete', progress: 100, name };
            ctx.io.emit('modInstallProgress', { serverId: targetSrv.id, workshopId, status: 'complete', progress: 100, message: `${name} installed!` });
            addNotification(targetSrv.id, 'mod.installed', 'Mod Installed', `${name} installed via Discord`, 'success');
            fireWebhooks('mod.installed', { serverId: targetSrv.id, workshopId, name });
          })
          .catch(err => {
            ctx.activeInstalls[workshopId] = { status: 'error', progress: 0, name, error: err.message };
            setTimeout(() => delete ctx.activeInstalls[workshopId], 60000);
          });
        return;
      }

      case 'modUninstall': {
        const { workshopId: unWid } = params || {};
        if (!unWid) return res.status(400).json({ error: 'workshopId required' });
        const mod = state?.modList?.find(m => m.workshopId === String(unWid));
        if (!mod) return res.status(404).json({ error: 'Mod not found' });
        const modPath = path.join(targetSrv.installDir, mod.name);
        try { if (fs.existsSync(modPath)) fs.rmSync(modPath, { recursive: true, force: true }); } catch {}
        state.modList = state.modList.filter(m => m.workshopId !== String(unWid));
        updateLaunchParamsMods(targetSrv.id);
        addAudit(discordUserId, discordUser, 'mod.uninstall', `Uninstalled mod ${unWid} via Discord`);
        fireWebhooks('mod.removed', { serverId: targetSrv.id, workshopId: unWid });
        return res.json({ message: `Mod ${unWid} uninstalled` });
      }

      case 'modEnable': {
        const mod = state?.modList?.find(m => m.workshopId === String(params?.workshopId));
        if (!mod) return res.status(404).json({ error: 'Mod not found' });
        mod.enabled = true;
        updateLaunchParamsMods(targetSrv.id);
        addAudit(discordUserId, discordUser, 'mod.enable', `Enabled mod ${params?.workshopId} via Discord`);
        return res.json({ message: `Mod ${params?.workshopId} enabled` });
      }

      case 'modDisable': {
        const mod = state?.modList?.find(m => m.workshopId === String(params?.workshopId));
        if (!mod) return res.status(404).json({ error: 'Mod not found' });
        mod.enabled = false;
        updateLaunchParamsMods(targetSrv.id);
        addAudit(discordUserId, discordUser, 'mod.disable', `Disabled mod ${params?.workshopId} via Discord`);
        return res.json({ message: `Mod ${params?.workshopId} disabled` });
      }

      case 'chatFeed':
        return res.json({ messages: state?.chatMessages || [] });

      case 'banWhitelist': {
        const bans = listBans();
        return res.json({ entries: bans.map(b => ({ player: b.playerName || b.steamId, status: 'Banned', reason: b.reason || '' })) });
      }

      case 'watchList':
        return res.json({ players: ctx.watchList });

      case 'priorityQueue':
        return res.json({ entries: ctx.priorityQueue });

      case 'timeWeather': {
        const cfg = state?.config || {};
        const lines = [
          cfg.serverTime           ? `🕐 Server Time: \`${cfg.serverTime}\``                        : null,
          cfg.serverTimeAcceleration != null ? `⚡ Time Speed: \`${cfg.serverTimeAcceleration}x\`` : null,
          cfg.serverTimePersistent != null   ? `💾 Persistent: \`${cfg.serverTimePersistent ? 'Yes' : 'No'}\`` : null,
          cfg.weather              ? `🌤️ Weather: \`${cfg.weather}\``                               : null,
        ].filter(Boolean);
        return res.json({ info: lines.length ? lines.join('\n') : null });
      }

      case 'killfeed':
        return res.json({ kills: state?.killFeed || state?.recentKills || [] });

      case 'leaderboard': {
        const playerStats = state?.playerStats || {};
        const entries = Object.entries(playerStats)
          .map(([id, s]) => ({ name: s.name || id, kills: s.kills || 0, deaths: s.deaths || 0 }))
          .sort((a, b) => b.kills - a.kills)
          .slice(0, 20);
        return res.json({ entries });
      }

      case 'playerInfo': {
        const { steamId } = params || {};
        if (!steamId) return res.status(400).json({ error: 'steamId required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.GET_PLAYER_DETAILS);
          const details = await provider.getPlayerDetails(targetSrv.id, steamId);
          const stats = details.statistics;
          return res.json({
            names: details.names,
            playtime: details.playtime,
            sessions: details.sessions,
            firstSeen: details.firstSeen,
            lastSeen: details.lastSeen,
            kills: stats?.kills || 0,
            deaths: stats?.deaths?.total || 0,
            kdratio: stats?.kdratio || 0,
            longestKill: stats?.longestKill || 0,
            longestShot: stats?.longestShot || 0,
            hits: stats?.hits || 0,
          });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      case 'actionHeal': {
        const { steamId } = params || {};
        if (!steamId) return res.status(400).json({ error: 'steamId required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        const session = findSession(targetSrv.id, steamId);
        if (!session) return res.status(404).json({ error: 'Player not in active session' });
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.HEAL_PLAYER);
          await provider.healPlayer(targetSrv.id, session);
          addAudit(discordUserId, discordUser, 'player.heal', `Healed ${session.playerName} via Discord`);
          return res.json({ message: `Healed ${session.playerName}` });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      case 'actionKill': {
        const { steamId } = params || {};
        if (!steamId) return res.status(400).json({ error: 'steamId required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        const session = findSession(targetSrv.id, steamId);
        if (!session) return res.status(404).json({ error: 'Player not in active session' });
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.KILL_PLAYER);
          await provider.killPlayer(targetSrv.id, session);
          addAudit(discordUserId, discordUser, 'player.kill', `Killed ${session.playerName} via Discord`);
          return res.json({ message: `Killed ${session.playerName}` });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      case 'actionTeleport': {
        const { steamId, x, y, z } = params || {};
        if (!steamId || x == null || y == null) return res.status(400).json({ error: 'steamId, x, and y required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        const session = findSession(targetSrv.id, steamId);
        if (!session) return res.status(404).json({ error: 'Player not in active session' });
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.TELEPORT_PLAYER);
          await provider.teleportPlayer(targetSrv.id, session, { x, y, z: z || 0 });
          addAudit(discordUserId, discordUser, 'player.teleport', `Teleported ${session.playerName} to [${x}, ${y}, ${z || 0}] via Discord`);
          return res.json({ message: `Teleported ${session.playerName} to [${x}, ${y}, ${z || 0}]` });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      case 'actionSpawnItem': {
        const { steamId, itemClass, quantity } = params || {};
        if (!steamId || !itemClass) return res.status(400).json({ error: 'steamId and itemClass required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        const session = findSession(targetSrv.id, steamId);
        if (!session) return res.status(404).json({ error: 'Player not in active session' });
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.SPAWN_ITEM);
          await provider.spawnItem(targetSrv.id, session, itemClass, quantity || 1);
          addAudit(discordUserId, discordUser, 'player.spawnItem', `Spawned ${itemClass} x${quantity || 1} on ${session.playerName} via Discord`);
          return res.json({ message: `Spawned ${itemClass} x${quantity || 1} on ${session.playerName}` });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      case 'actionUnstuck': {
        const { steamId } = params || {};
        if (!steamId) return res.status(400).json({ error: 'steamId required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        const session = findSession(targetSrv.id, steamId);
        if (!session) return res.status(404).json({ error: 'Player not in active session' });
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.UNSTUCK_PLAYER);
          await provider.unstuckPlayer(targetSrv.id, session);
          addAudit(discordUserId, discordUser, 'action.unstuck', `Unstuck ${session.playerName || session.name} via Discord`);
          return res.json({ message: `Unstuck ${session.playerName || session.name}` });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      case 'actionFreeze': {
        const { steamId, frozen } = params || {};
        if (!steamId) return res.status(400).json({ error: 'steamId required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        const session = findSession(targetSrv.id, steamId);
        if (!session) return res.status(404).json({ error: 'Player not in active session' });
        const isFrozen = frozen !== 0 && frozen !== '0' && frozen !== false;
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.FREEZE_PLAYER);
          await provider.freezePlayer(targetSrv.id, session, isFrozen);
          const label = isFrozen ? 'Froze' : 'Unfroze';
          addAudit(discordUserId, discordUser, 'action.freeze', `${label} ${session.playerName || session.name} via Discord`);
          return res.json({ message: `${label} ${session.playerName || session.name}` });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      case 'actionStrip': {
        const { steamId } = params || {};
        if (!steamId) return res.status(400).json({ error: 'steamId required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        const session = findSession(targetSrv.id, steamId);
        if (!session) return res.status(404).json({ error: 'Player not in active session' });
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.STRIP_PLAYER);
          await provider.stripPlayer(targetSrv.id, steamId);
          addAudit(discordUserId, discordUser, 'action.strip', `Stripped ${session.playerName || session.name} via Discord`);
          return res.json({ message: `Stripped ${session.playerName || session.name}` });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      case 'actionExplode': {
        const { steamId } = params || {};
        if (!steamId) return res.status(400).json({ error: 'steamId required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        const session = findSession(targetSrv.id, steamId);
        if (!session) return res.status(404).json({ error: 'Player not in active session' });
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.EXPLODE_PLAYER);
          await provider.explodePlayer(targetSrv.id, steamId);
          addAudit(discordUserId, discordUser, 'action.explode', `Exploded ${session.playerName || session.name} via Discord`);
          return res.json({ message: `Exploded ${session.playerName || session.name}` });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      case 'actionMessage': {
        const { steamId, message: msg } = params || {};
        if (!steamId || !msg) return res.status(400).json({ error: 'steamId and message required' });
        if (!targetSrv) return res.status(400).json({ error: 'No server configured' });
        const session = findSession(targetSrv.id, steamId);
        if (!session) return res.status(404).json({ error: 'Player not in active session' });
        try {
          const provider = getProviderForAction(targetSrv.id, ActionType.MESSAGE_PLAYER);
          await provider.messagePlayer(targetSrv.id, steamId, msg);
          addAudit(discordUserId, discordUser, 'action.message', `Messaged ${session.playerName || session.name} via Discord`);
          return res.json({ message: `Message sent to ${session.playerName || session.name}` });
        } catch (err) { return res.status(500).json({ error: err.message }); }
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  });
};
