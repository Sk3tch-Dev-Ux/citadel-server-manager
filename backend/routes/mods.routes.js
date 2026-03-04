/**
 * Mod install, uninstall, toggle, reorder, type management, and cache routes.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { downloadWorkshopMod } = require('../lib/steamcmd');
const { installModToServer, updateLaunchParamsMods, reorderMods, setModType } = require('../lib/mod-manager');
const { addAudit } = require('../lib/audit');
const { addNotification, fireWebhooks } = require('../lib/notifications');
const { auth, authForServer } = require('../middleware/auth');
const modCache = require('../lib/mod-cache');

module.exports = function(app) {
  app.get('/api/servers/:id/mods', authForServer('mods.view'), (req, res) => {
    res.json(ctx.serverStates[req.params.id]?.modList || []);
  });

  app.post('/api/servers/:id/mods/install', authForServer('mods.install'), async (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id];
    const { workshopId, name } = req.body;
    if (!workshopId || !name) return res.status(400).json({ error: 'workshopId and name required' });
    if (state?.modList.find(m => m.workshopId === String(workshopId))) return res.status(400).json({ error: 'Already installed' });
    if (ctx.activeInstalls[workshopId]?.status === 'downloading') return res.status(409).json({ error: 'Already downloading' });

    ctx.activeInstalls[workshopId] = { status: 'starting', progress: 0, name };
    res.json({ message: 'Download started', workshopId });

    try {
      // Check mod cache first
      let contentPath = modCache.getCached(String(workshopId));
      if (contentPath) {
        ctx.activeInstalls[workshopId] = { status: 'installing', progress: 90, name };
        ctx.io.emit('modInstallProgress', { serverId: srv.id, workshopId, status: 'installing', progress: 90, message: `Installing from cache...` });
      } else {
        ctx.activeInstalls[workshopId] = { status: 'downloading', progress: 0, name };
        contentPath = await downloadWorkshopMod(String(workshopId), name, srv.id);
        // Store in cache for future use
        modCache.storeInCache(String(workshopId), contentPath, name);
        ctx.activeInstalls[workshopId] = { status: 'installing', progress: 90, name };
      }
      const folderName = installModToServer(contentPath, name, String(workshopId), srv.installDir);
      state.modList.push({ name: folderName, workshopId: String(workshopId), enabled: true, order: state.modList.length, type: 'client' });
      updateLaunchParamsMods(srv.id);
      ctx.activeInstalls[workshopId] = { status: 'complete', progress: 100, name };
      ctx.io.emit('modInstallProgress', { serverId: srv.id, workshopId, status: 'complete', progress: 100, message: `${name} installed!` });
      ctx.io.emit('mods', { serverId: srv.id, mods: state.modList });
      addAudit(req.user.id, req.user.username, 'mod.install', `Installed ${name} on ${srv.name}`);
      addNotification(srv.id, 'mod.installed', 'Mod Installed', `${name} installed on ${srv.name}`, 'success');
      fireWebhooks('mod.installed', { serverId: srv.id, serverName: srv.name, modName: name, modId: String(workshopId) });
      setTimeout(() => delete ctx.activeInstalls[workshopId], 30000);
    } catch (err) {
      ctx.activeInstalls[workshopId] = { status: 'error', progress: 0, name, error: err.message };
      ctx.io.emit('modInstallProgress', { serverId: srv.id, workshopId, status: 'error', progress: 0, message: err.message });
      setTimeout(() => delete ctx.activeInstalls[workshopId], 60000);
    }
  });

  app.delete('/api/servers/:id/mods/uninstall/:workshopId', authForServer('mods.install'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id];
    const mod = state?.modList.find(m => m.workshopId === req.params.workshopId);
    if (!mod) return res.status(404).json({ error: 'Mod not found' });
    try {
      const modPath = path.join(srv.installDir, mod.name);
      if (fs.existsSync(modPath)) fs.rmSync(modPath, { recursive: true, force: true });
      state.modList = state.modList.filter(m => m.workshopId !== req.params.workshopId);
      updateLaunchParamsMods(srv.id);
      ctx.io.emit('mods', { serverId: srv.id, mods: state.modList });
      addAudit(req.user.id, req.user.username, 'mod.uninstall', `Uninstalled ${mod.name} from ${srv.name}`);
      addNotification(srv.id, 'mod.removed', 'Mod Uninstalled', `${mod.name} removed from ${srv.name}`, 'info');
      fireWebhooks('mod.removed', { serverId: srv.id, serverName: srv.name, modName: mod.name, modId: mod.workshopId });
      res.json({ message: `${mod.name} uninstalled` });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/servers/:id/mods/:workshopId', authForServer('mods.install'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    const mod = state.modList.find(m => m.workshopId === req.params.workshopId);
    if (!mod) return res.status(404).json({ error: 'Mod not found' });
    const allowed = ['enabled', 'order', 'type', 'name'];
    for (const key of allowed) { if (req.body[key] !== undefined) mod[key] = req.body[key]; }
    updateLaunchParamsMods(req.params.id);
    res.json(mod);
  });

  // ─── Mod Reordering ────────────────────────────────────────────────
  app.post('/api/servers/:id/mods/reorder', authForServer('mods.install'), (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of mod folder names' });
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    reorderMods(req.params.id, order);
    addAudit(req.user.id, req.user.username, 'mod.reorder', `Reordered mods on server ${req.params.id}`);
    res.json({ message: 'Mods reordered', mods: state.modList });
  });

  // ─── Mod Type Designation (client / server) ────────────────────────
  app.patch('/api/servers/:id/mods/:modName/type', authForServer('mods.install'), (req, res) => {
    const { type } = req.body;
    if (!type || !['client', 'server'].includes(type)) {
      return res.status(400).json({ error: "type must be 'client' or 'server'" });
    }
    const mod = setModType(req.params.id, req.params.modName, type);
    if (!mod) return res.status(404).json({ error: 'Mod not found' });
    addAudit(req.user.id, req.user.username, 'mod.type', `Changed ${req.params.modName} to ${type} on server ${req.params.id}`);
    res.json(mod);
  });

  // ─── Mod Cache Routes ──────────────────────────────────────────────
  app.get('/api/mods/cache/stats', auth(), (req, res) => {
    res.json(modCache.getCacheStats());
  });

  app.post('/api/mods/cache/clean', auth(), (req, res) => {
    const result = modCache.cleanCache();
    addAudit(req.user.id, req.user.username, 'mod.cache.clean', `Cleaned mod cache: ${result.removed} mods, ${result.freedFormatted} freed`);
    res.json(result);
  });

  app.get('/api/mods/install-status', auth(), (req, res) => { res.json(ctx.activeInstalls); });
};
