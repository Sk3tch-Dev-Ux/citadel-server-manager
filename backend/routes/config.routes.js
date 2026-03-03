/**
 * Server config (serverDZ.cfg) read/write routes.
 * Includes config template save & rollback endpoints.
 */
const crypto = require('crypto');
const ctx = require('../lib/context');
const { readServerConfig, writeServerConfig } = require('../lib/dayz-config');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const { loadJSON, saveJSON } = require('../lib/data-store');

const MAX_TEMPLATES = 20;

function getTemplates(serverId) {
  return loadJSON(ctx.CONFIG.dataDir, `config-templates-${serverId}.json`, []);
}

function persistTemplates(serverId, templates) {
  saveJSON(ctx.CONFIG.dataDir, `config-templates-${serverId}.json`, templates);
}

module.exports = function(app) {
  // ─── Read current config ─────────────────────────────────
  app.get('/api/servers/:id/config', authForServer('server.config'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const state = ctx.serverStates[srv.id];
    if (state) state.config = readServerConfig(srv.installDir);
    res.json(state?.config || {});
  });

  // ─── Update current config ──────────────────────────────
  app.patch('/api/servers/:id/config', authForServer('server.config'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (writeServerConfig(srv.installDir, req.body)) {
      if (ctx.serverStates[srv.id]) ctx.serverStates[srv.id].config = readServerConfig(srv.installDir);
      addAudit(req.user.id, req.user.username, 'config.update', `Updated config for ${srv.name}`);
      res.json(ctx.serverStates[srv.id]?.config || {});
    } else res.status(500).json({ error: 'Failed to write config' });
  });

  // ─── List config templates ──────────────────────────────
  app.get('/api/servers/:id/config/templates', authForServer('server.config'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const templates = getTemplates(srv.id);
    res.json(templates.map(t => ({ id: t.id, name: t.name, createdAt: t.createdAt })));
  });

  // ─── Save current config as template ────────────────────
  app.post('/api/servers/:id/config/templates', authForServer('server.config'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Template name is required' });
    }

    const templates = getTemplates(srv.id);
    if (templates.length >= MAX_TEMPLATES) {
      return res.status(400).json({ error: `Maximum of ${MAX_TEMPLATES} templates reached. Delete an existing template first.` });
    }

    const config = readServerConfig(srv.installDir);
    const template = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      config,
    };

    templates.push(template);
    persistTemplates(srv.id, templates);

    addAudit(req.user.id, req.user.username, 'config.template.save', `Saved config template "${template.name}" for ${srv.name}`);
    res.json({ id: template.id, name: template.name, createdAt: template.createdAt });
  });

  // ─── Restore a config template ──────────────────────────
  app.post('/api/servers/:id/config/templates/:templateId/restore', authForServer('server.config'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const templates = getTemplates(srv.id);
    const template = templates.find(t => t.id === req.params.templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    if (!writeServerConfig(srv.installDir, template.config)) {
      return res.status(500).json({ error: 'Failed to write config' });
    }

    const restoredConfig = readServerConfig(srv.installDir);
    if (ctx.serverStates[srv.id]) ctx.serverStates[srv.id].config = restoredConfig;

    addAudit(req.user.id, req.user.username, 'config.template.restore', `Restored config template "${template.name}" for ${srv.name}`);
    res.json(restoredConfig);
  });

  // ─── Delete a config template ───────────────────────────
  app.delete('/api/servers/:id/config/templates/:templateId', authForServer('server.config'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const templates = getTemplates(srv.id);
    const idx = templates.findIndex(t => t.id === req.params.templateId);
    if (idx === -1) return res.status(404).json({ error: 'Template not found' });

    const [removed] = templates.splice(idx, 1);
    persistTemplates(srv.id, templates);

    addAudit(req.user.id, req.user.username, 'config.template.delete', `Deleted config template "${removed.name}" for ${srv.name}`);
    res.json({ success: true });
  });
};
