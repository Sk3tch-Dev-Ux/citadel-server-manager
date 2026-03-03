/**
 * Mod install, uninstall, toggle, and install status routes.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { downloadWorkshopMod } = require('../lib/steamcmd');
const { installModToServer, updateLaunchParamsMods } = require('../lib/mod-manager');
const { addAudit } = require('../lib/audit');
const { addNotification, fireWebhooks } = require('../lib/notifications');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/servers/:id/mods', auth('mods.view'), (req, res) => {
    res.json(ctx.serverStates[req.params.id]?.modList || []);
  });

  app.post('/api/servers/:id/mods/install', auth('mods.install'), async (req, res) => {
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
      ctx.activeInstalls[workshopId] = { status: 'downloading', progress: 0, name };
      const contentPath = await downloadWorkshopMod(String(workshopId), name, srv.id);
      ctx.activeInstalls[workshopId] = { status: 'installing', progress: 90, name };
      const folderName = installModToServer(contentPath, name, String(workshopId), srv.installDir);
      state.modList.push({ name: folderName, workshopId: String(workshopId), enabled: true, order: state.modList.length });
      updateLaunchParamsMods(srv.id);
      ctx.activeInstalls[workshopId] = { status: 'complete', progress: 100, name };
      ctx.io.emit('modInstallProgress', { serverId: srv.id, workshopId, status: 'complete', progress: 100, message: `${name} installed!` });
      ctx.io.emit('mods', { serverId: srv.id, mods: state.modList });
      addAudit(req.user.id, req.user.username, 'mod.install', `Installed ${name} on ${srv.name}`);
      addNotification(srv.id, 'mod.installed', 'Mod Installed', `${name} installed on ${srv.name}`, 'success');
      fireWebhooks('mod.installed', { serverId: srv.id, modName: name });
      setTimeout(() => delete ctx.activeInstalls[workshopId], 30000);
    } catch (err) {
      ctx.activeInstalls[workshopId] = { status: 'error', progress: 0, name, error: err.message };
      ctx.io.emit('modInstallProgress', { serverId: srv.id, workshopId, status: 'error', progress: 0, message: err.message });
      setTimeout(() => delete ctx.activeInstalls[workshopId], 60000);
    }
  });

  app.delete('/api/servers/:id/mods/uninstall/:workshopId', auth('mods.install'), (req, res) => {
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
      fireWebhooks('mod.removed', { serverId: srv.id, modName: mod.name });
      res.json({ message: `${mod.name} uninstalled` });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/servers/:id/mods/:workshopId', auth('mods.install'), (req, res) => {
    const state = ctx.serverStates[req.params.id];
    if (!state) return res.status(404).json({ error: 'Server not found' });
    const mod = state.modList.find(m => m.workshopId === req.params.workshopId);
    if (!mod) return res.status(404).json({ error: 'Mod not found' });
    Object.assign(mod, req.body);
    updateLaunchParamsMods(req.params.id);
    res.json(mod);
  });

  app.get('/api/mods/install-status', auth(), (req, res) => { res.json(ctx.activeInstalls); });
};
