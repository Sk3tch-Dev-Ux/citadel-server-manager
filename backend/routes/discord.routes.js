/**
 * Discord bot action endpoint with API key authentication.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ctx = require('../lib/context');
const { sanitizeString } = require('../lib/helpers');
const { detectRunningProcess, detectProcessByPid, killProcess, spawnDayZServer } = require('../lib/process-manager');
const { downloadWorkshopMod } = require('../lib/steamcmd');
const { installModToServer, updateStartBatMods } = require('../lib/mod-manager');
const { scrapeRPTForKills } = require('../lib/rpt-scraper');

module.exports = function(app) {
  app.post('/api/discord/action', async (req, res) => {
    const { action, apiKey, params } = req.body;
    const expectedKey = process.env.DISCORD_BOT_API_KEY;
    if (!expectedKey) return res.status(500).json({ error: 'DISCORD_BOT_API_KEY not configured on server' });
    if (!apiKey || typeof apiKey !== 'string') return res.status(400).json({ error: 'API key required' });
    if (apiKey.length !== expectedKey.length || !crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(expectedKey))) {
      return res.status(403).json({ error: 'Invalid API key' });
    }
    const allowedActions = ['status','start','stop','restart','players','lock','unlock','rcon','message','kick',
      'mods','modStatus','modInstall','modUninstall','modEnable','modDisable',
      'chatFeed','banWhitelist','killfeed','watchList','priorityQueue','timeWeather','leaderboard'];
    if (!action || !allowedActions.includes(action)) return res.status(400).json({ error: `Invalid action: ${sanitizeString(String(action || ''))}` });
    const defaultSrv = ctx.servers[0];
    const state = defaultSrv ? ctx.serverStates[defaultSrv.id] : null;

    switch (action) {
      case 'status':
        return res.json({ status: state?.status || 'unknown', players: state?.players || [], playerCount: state?.players?.length || 0, maxPlayers: state?.config?.maxPlayers || 60, serverName: defaultSrv?.name || 'DayZ Server' });
      case 'start':
        if (!defaultSrv || !state) return res.status(400).json({ error: 'No server' });
        if (state.status === 'running' || state.status === 'starting') return res.json({ message: `Server is already ${state.status}` });
        state.status = 'starting'; ctx.io.emit('serverStatus', { serverId: defaultSrv.id, status: 'starting' });
        try {
          const { child, launchFailed } = spawnDayZServer(defaultSrv);
          state.process = child; state.pid = child.pid;
          launchFailed.then(async (failReason) => {
            if (failReason) { state.status = 'crashed'; state.pid = null; state.process = null; ctx.io.emit('serverStatus', { serverId: defaultSrv.id, status: 'crashed' }); return; }
            const alive = await detectProcessByPid(child.pid);
            if (alive) { state.pid = child.pid; state.status = 'running'; state.startedAt = new Date().toISOString(); ctx.io.emit('serverStatus', { serverId: defaultSrv.id, status: 'running' }); }
            else { state.status = 'crashed'; state.pid = null; state.process = null; ctx.io.emit('serverStatus', { serverId: defaultSrv.id, status: 'crashed' }); }
          });
        } catch (err) { state.status = 'crashed'; return res.json({ error: err.message }); }
        return res.json({ message: 'Starting...' });
      case 'stop':
        if (!state || state.status !== 'running') return res.json({ message: 'Not running' });
        try { await killProcess(state.pid, defaultSrv.executable); state.status = 'stopped'; state.pid = null; state.players = []; state.startedAt = null; ctx.io.emit('serverStatus', { serverId: defaultSrv.id, status: 'stopped' }); }
        catch (err) { return res.json({ error: err.message }); }
        return res.json({ message: 'Stopped' });
      case 'restart':
        if (!state) return res.json({ error: 'No server' });
        try {
          if (state.pid) await killProcess(state.pid, defaultSrv.executable);
          state.status = 'starting'; state.pid = null; state.players = [];
          ctx.io.emit('serverStatus', { serverId: defaultSrv.id, status: 'starting' });
          await new Promise(r => setTimeout(r, 3000));
          const { child, launchFailed } = spawnDayZServer(defaultSrv);
          state.process = child; state.pid = child.pid;
          launchFailed.then(async (failReason) => {
            if (failReason) { state.status = 'crashed'; state.pid = null; state.process = null; ctx.io.emit('serverStatus', { serverId: defaultSrv.id, status: 'crashed' }); return; }
            const alive = await detectProcessByPid(child.pid);
            if (alive) { state.pid = child.pid; state.status = 'running'; state.startedAt = new Date().toISOString(); ctx.io.emit('serverStatus', { serverId: defaultSrv.id, status: 'running' }); }
            else { state.status = 'crashed'; state.pid = null; state.process = null; ctx.io.emit('serverStatus', { serverId: defaultSrv.id, status: 'crashed' }); }
          });
        } catch (err) { return res.json({ error: err.message }); }
        return res.json({ message: 'Restarting...' });
      case 'players': return res.json({ players: state?.players || [] });
      case 'lock':
        if (!state?.rcon) return res.json({ error: 'RCON not configured' });
        try { await state.rcon.lock(); return res.json({ message: 'Server locked' }); }
        catch (err) { return res.json({ error: err.message }); }
      case 'unlock':
        if (!state?.rcon) return res.json({ error: 'RCON not configured' });
        try { await state.rcon.unlock(); return res.json({ message: 'Server unlocked' }); }
        catch (err) { return res.json({ error: err.message }); }
      case 'rcon':
        if (!state?.rcon) return res.json({ error: 'RCON not configured' });
        try { const result = await state.rcon.send(params?.command || ''); return res.json({ result }); }
        catch (err) { return res.json({ error: err.message }); }
      case 'message':
        if (!state?.rcon) return res.json({ error: 'RCON not configured' });
        try { await state.rcon.say(params?.message || ''); return res.json({ message: 'Sent' }); }
        catch (err) { return res.json({ error: err.message }); }
      case 'kick':
        if (!state?.rcon) return res.json({ error: 'RCON not configured' });
        try {
          await state.rcon.kick(params?.playerId, params?.reason || 'Kicked via Discord');
          state.players = state.players.filter(p => p.id !== params?.playerId);
          ctx.io.emit('players', { serverId: defaultSrv.id, players: state.players });
          return res.json({ message: 'Kicked' });
        } catch (err) { return res.json({ error: err.message }); }
      case 'mods':
        return res.json({ mods: state?.modList || [] });
      case 'modStatus':
        return res.json(ctx.activeInstalls);
      case 'modInstall': {
        const { workshopId, name } = params || {};
        if (!workshopId || !name) return res.json({ error: 'workshopId and name required' });
        if (ctx.activeInstalls[workshopId]?.status === 'downloading') return res.json({ error: 'Already downloading' });
        ctx.activeInstalls[workshopId] = { status: 'starting', progress: 0, name };
        res.json({ message: 'Download started', workshopId });
        downloadWorkshopMod(String(workshopId), name, defaultSrv.id)
          .then(contentPath => {
            ctx.activeInstalls[workshopId] = { status: 'installing', progress: 90, name };
            const folderName = installModToServer(contentPath, name, String(workshopId), defaultSrv.installDir);
            state.modList.push({ name: folderName, workshopId: String(workshopId), enabled: true, order: state.modList.length });
            updateStartBatMods(defaultSrv.id);
            ctx.activeInstalls[workshopId] = { status: 'complete', progress: 100, name };
            ctx.io.emit('modInstallProgress', { serverId: defaultSrv.id, workshopId, status: 'complete', progress: 100, message: `${name} installed!` });
          })
          .catch(err => {
            ctx.activeInstalls[workshopId] = { status: 'error', progress: 0, name, error: err.message };
            setTimeout(() => delete ctx.activeInstalls[workshopId], 60000);
          });
        return;
      }
      case 'modUninstall': {
        const { workshopId: unWid } = params || {};
        if (!unWid) return res.json({ error: 'workshopId required' });
        const mod = state?.modList?.find(m => m.workshopId === String(unWid));
        if (!mod) return res.json({ error: 'Mod not found' });
        const modPath = path.join(defaultSrv.installDir, mod.name);
        try { if (fs.existsSync(modPath)) fs.rmSync(modPath, { recursive: true, force: true }); } catch {}
        state.modList = state.modList.filter(m => m.workshopId !== String(unWid));
        updateStartBatMods(defaultSrv.id);
        return res.json({ message: `Mod ${unWid} uninstalled` });
      }
      case 'modEnable': {
        const mod = state?.modList?.find(m => m.workshopId === String(params?.workshopId));
        if (!mod) return res.json({ error: 'Mod not found' });
        mod.enabled = true;
        updateStartBatMods(defaultSrv.id);
        return res.json({ message: `Mod ${params?.workshopId} enabled` });
      }
      case 'modDisable': {
        const mod = state?.modList?.find(m => m.workshopId === String(params?.workshopId));
        if (!mod) return res.json({ error: 'Mod not found' });
        mod.enabled = false;
        updateStartBatMods(defaultSrv.id);
        return res.json({ message: `Mod ${params?.workshopId} disabled` });
      }
      case 'chatFeed':
        return res.json({ messages: state?.chatMessages || [] });
      case 'banWhitelist':
        return res.json({ entries: (state?.banList || []).map(b => ({ player: b.name || b.id, status: 'Banned', reason: b.reason || '' })) });
      case 'killfeed':
        return res.json({ kills: scrapeRPTForKills(defaultSrv, 20) });
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
      case 'leaderboard':
        return res.json({ entries: ctx.leaderboard.slice(0, 10) });
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  });
};
