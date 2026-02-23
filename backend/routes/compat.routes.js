/**
 * Legacy single-server backward compatibility routes.
 * Maps /api/xxx to /api/servers/:firstServerId/xxx for older clients.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { readServerConfig, writeServerConfig } = require('../lib/dayz-config');
const { safePath } = require('../lib/helpers');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/server/status', auth(), (req, res) => {
    const srv = ctx.servers[0]; const state = srv ? ctx.serverStates[srv.id] : null;
    res.json({ status: state?.status || 'stopped', players: state?.players || [], playerCount: state?.players?.length || 0, maxPlayers: state?.config?.maxPlayers || 60, serverName: state?.config?.hostname || 'DayZ Server', uptime: state?.startedAt ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000) : 0 });
  });

  app.get('/api/mods', auth(), (req, res) => { res.json(ctx.serverStates[ctx.servers[0]?.id]?.modList || []); });
  app.get('/api/metrics', auth(), (req, res) => { res.json(ctx.serverStates[ctx.servers[0]?.id]?.metricsHistory || { cpu: [], ram: [], players: [], fps: [], timestamps: [] }); });

  app.get('/api/config', auth(), (req, res) => {
    const srv = ctx.servers[0]; if (!srv) return res.json({});
    const st = ctx.serverStates[srv.id]; if (st) st.config = readServerConfig(srv.installDir);
    res.json(st?.config || {});
  });

  app.patch('/api/config', auth('server.config'), (req, res) => {
    const srv = ctx.servers[0]; if (!srv) return res.status(400).json({ error: 'No server' });
    if (writeServerConfig(srv.installDir, req.body)) {
      if (ctx.serverStates[srv.id]) ctx.serverStates[srv.id].config = readServerConfig(srv.installDir);
      res.json(ctx.serverStates[srv.id]?.config || {});
    } else res.status(500).json({ error: 'Failed' });
  });

  app.get('/api/logs', auth(), (req, res) => {
    const { level, source, limit = 200 } = req.query;
    let logs = ctx.serverStates[ctx.servers[0]?.id]?.logs || [];
    if (level) logs = logs.filter(l => l.level === level);
    if (source) logs = logs.filter(l => l.source === source);
    res.json(logs.slice(0, parseInt(limit)));
  });

  app.get('/api/players', auth(), (req, res) => { res.json(ctx.serverStates[ctx.servers[0]?.id]?.players || []); });
  app.get('/api/bans', auth(), (req, res) => { res.json(ctx.serverStates[ctx.servers[0]?.id]?.banList || []); });
  app.get('/api/schedule', auth(), (req, res) => { res.json(ctx.serverStates[ctx.servers[0]?.id]?.scheduledRestarts || []); });

  app.get('/api/files', auth('files.browse'), (req, res) => {
    const srv = ctx.servers[0]; if (!srv) return res.status(400).json({ error: 'No server' });
    const { dir } = req.query;
    const td = safePath(srv.installDir, dir); if (!td) return res.status(403).json({ error: 'Access denied' });
    const bp = fs.realpathSync(srv.installDir);
    try {
      const entries = fs.readdirSync(td, { withFileTypes: true });
      const results = entries.map(e => { const fp = path.join(td, e.name); let size = 0, modified = 0; try { const s = fs.statSync(fp); size = s.size; modified = s.mtimeMs; } catch {} return { name: e.name, type: e.isDirectory() ? 'directory' : 'file', path: path.relative(bp, fp).replace(/\\/g, '/'), size, modified }; });
      results.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      res.json(results);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/files/read', auth('files.edit'), (req, res) => {
    const srv = ctx.servers[0]; if (!srv) return res.status(400).json({ error: 'No server' });
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'File path required' });
    const fp = safePath(srv.installDir, file); if (!fp) return res.status(403).json({ error: 'Access denied' });
    try {
      const stat = fs.statSync(fp);
      if (stat.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large' });
      const binaryExts = ['.exe','.dll','.pdb','.pbo','.pak','.bin','.so','.png','.jpg','.jpeg','.gif','.bmp','.ico','.wav','.ogg','.mp3','.zip','.rar','.7z','.bikey','.bisign'];
      if (binaryExts.includes(path.extname(fp).toLowerCase())) return res.status(400).json({ error: 'Binary file' });
      res.json({ content: fs.readFileSync(fp, 'utf8'), path: file, size: stat.size, modified: stat.mtimeMs });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/files/write', auth('files.edit'), (req, res) => {
    const srv = ctx.servers[0]; if (!srv) return res.status(400).json({ error: 'No server' });
    const { file, content } = req.body;
    if (!file) return res.status(400).json({ error: 'File path required' });
    const fp = safePath(srv.installDir, file); if (!fp) return res.status(403).json({ error: 'Access denied' });
    try {
      const bd = path.join(srv.installDir, '.backups');
      if (!fs.existsSync(bd)) fs.mkdirSync(bd, { recursive: true });
      if (fs.existsSync(fp)) fs.copyFileSync(fp, path.join(bd, `${path.basename(file)}.${Date.now()}.bak`));
      fs.writeFileSync(fp, content);
      res.json({ message: 'Saved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
