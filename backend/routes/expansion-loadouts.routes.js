/**
 * Expansion Loadout Routes — CRUD for Expansion loadout JSON files
 * (player spawn loadouts + AI/bandit/hero faction loadouts).
 *
 * Files live under <installDir>/Profiles/ExpansionMod/Loadouts/ and are
 * referenced by SpawnSettings.json (player) and AISettings / faction configs
 * (AI). Schema: backend/schemas/expansion/BanditLoadout.schema.json.
 *
 * Routes:
 *   GET    /api/servers/:id/expansion/loadouts            — List all loadout files (summary)
 *   GET    /api/servers/:id/expansion/loadouts/:name      — Read one loadout
 *   PUT    /api/servers/:id/expansion/loadouts/:name      — Save a loadout (creates if missing)
 *   DELETE /api/servers/:id/expansion/loadouts/:name      — Delete a loadout
 *
 * The `:name` param is the file basename WITHOUT the .json extension and is
 * validated against a strict allowlist to prevent path traversal.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const logger = require('../lib/logger');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const { safeError } = require('../lib/http-errors');

const SAFE_NAME = /^[A-Za-z0-9_-]{1,80}$/;

function loadoutsDir(srv) {
  const profileDir = srv.profileDir || 'profiles';
  return path.join(srv.installDir, profileDir, 'ExpansionMod', 'Loadouts');
}

function loadoutPath(srv, name) {
  if (!SAFE_NAME.test(name)) return null;
  const full = path.join(loadoutsDir(srv), `${name}.json`);
  // Belt-and-suspenders: ensure resolved path stays under loadoutsDir.
  const dir = loadoutsDir(srv);
  if (!full.startsWith(dir + path.sep)) return null;
  return full;
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) {
    logger.warn({ err, file: p }, 'Failed to parse loadout JSON');
    return null;
  }
}

/**
 * Best-effort categorization for the list view — looks at common Expansion
 * loadout naming patterns and a few well-known keys in the body. Used only
 * for the badge color/label in the sidebar; never trusted server-side.
 */
function inferKind(name, data) {
  const n = name.toLowerCase();
  if (n.includes('hero')) return 'Hero';
  if (n.includes('bandit')) return 'Bandit';
  if (n.includes('ai') || n.includes('patrol') || n.includes('guard')) return 'AI';
  if (n.includes('player') || n.includes('spawn') || n.includes('starter')) return 'Player';
  if (data && Array.isArray(data.AttachmentSlotItemSet)) return 'Loadout';
  return 'Custom';
}

module.exports = function(app) {

  app.get('/api/servers/:id/expansion/loadouts', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const dir = loadoutsDir(srv);
    if (!fs.existsSync(dir)) return res.json([]);

    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const summary = files.map(f => {
        const name = f.replace(/\.json$/, '');
        let data = null;
        let size = 0;
        try {
          const stat = fs.statSync(path.join(dir, f));
          size = stat.size;
          data = readJSON(path.join(dir, f));
        } catch { /* keep going */ }
        return {
          name,
          fileName: f,
          size,
          kind: inferKind(name, data),
          // Surface a couple of cheap diagnostics so the list can render
          // useful subtitles without a full per-file fetch.
          slotCount: data && Array.isArray(data.AttachmentSlotItemSet) ? data.AttachmentSlotItemSet.length : null,
          itemCount: data && Array.isArray(data.Items) ? data.Items.length : null,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      res.json(summary);
    } catch (err) {
      logger.error({ err, serverId: req.params.id }, 'Failed to list loadouts');
      safeError(err, req, res, { status: 500 });
    }
  });

  app.get('/api/servers/:id/expansion/loadouts/:name', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const fpath = loadoutPath(srv, req.params.name);
    if (!fpath) return res.status(400).json({ error: 'Invalid loadout name' });
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Loadout not found' });

    try {
      res.json(readJSON(fpath) ?? {});
    } catch (err) {
      logger.error({ err, file: fpath }, 'Failed to read loadout');
      safeError(err, req, res, { status: 500 });
    }
  });

  app.put('/api/servers/:id/expansion/loadouts/:name', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const fpath = loadoutPath(srv, req.params.name);
    if (!fpath) return res.status(400).json({ error: 'Invalid loadout name' });

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body must be a JSON object' });
    }

    try {
      const dir = path.dirname(fpath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Backup if pre-existing.
      if (fs.existsSync(fpath)) {
        const backupDir = path.join(srv.installDir, '.backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(fpath, path.join(backupDir, `${path.basename(fpath)}.${Date.now()}.bak`));
      }
      fs.writeFileSync(fpath, JSON.stringify(body, null, 2) + '\n', 'utf8');
      addAudit(req.user.id, req.user.username, 'expansion.loadout.save', `Saved loadout ${req.params.name} on ${srv.name}`);
      res.json({ message: 'Saved', name: req.params.name });
    } catch (err) {
      logger.error({ err, file: fpath }, 'Failed to save loadout');
      safeError(err, req, res, { status: 500 });
    }
  });

  app.delete('/api/servers/:id/expansion/loadouts/:name', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });

    const fpath = loadoutPath(srv, req.params.name);
    if (!fpath) return res.status(400).json({ error: 'Invalid loadout name' });
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Loadout not found' });

    try {
      // Back up before deletion so it's recoverable from the .backups dir.
      const backupDir = path.join(srv.installDir, '.backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(fpath, path.join(backupDir, `${path.basename(fpath)}.${Date.now()}.deleted.bak`));
      fs.unlinkSync(fpath);
      addAudit(req.user.id, req.user.username, 'expansion.loadout.delete', `Deleted loadout ${req.params.name} on ${srv.name}`);
      res.json({ message: 'Deleted', name: req.params.name });
    } catch (err) {
      logger.error({ err, file: fpath }, 'Failed to delete loadout');
      safeError(err, req, res, { status: 500 });
    }
  });
};
