/**
 * Player profile endpoints — persistent, cross-wipe.
 *
 *   GET    /api/servers/:id/players/search[?q=...&limit=30]
 *   GET    /api/servers/:id/players/:steamId/profile
 *   POST   /api/servers/:id/players/:steamId/notes     { text }
 *   DELETE /api/servers/:id/players/:steamId/notes/:noteId
 *
 * The profile store is populated automatically by citadel-socket.js —
 * these endpoints are purely read/notes-crud.
 */
const ctx = require('../lib/context');
const profiles = require('../lib/player-profiles');
const { authForServer } = require('../middleware/auth');
const { validate } = require('../lib/request-validator');
const { addAudit } = require('../lib/audit');
const { safeError } = require('../lib/http-errors');

module.exports = function (app) {
  app.get('/api/servers/:id/players/search', authForServer('players.view'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
    try {
      res.json(profiles.search(ctx.CONFIG.dataDir, srv.id, { q, limit }));
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });

  app.get('/api/servers/:id/players/:steamId/profile', authForServer('players.view'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      const profile = profiles.getProfile(ctx.CONFIG.dataDir, srv.id, req.params.steamId);
      if (!profile) return res.status(404).json({ error: 'No profile on record for this player' });
      res.json(profile);
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });

  app.post('/api/servers/:id/players/:steamId/notes',
    authForServer('players.kick'),
    validate({ text: { type: 'string', required: true, minLength: 1, maxLength: 2000 } }),
    (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) return res.status(400).json({ error: 'Note text required' });
    try {
      const note = profiles.addNote(ctx.CONFIG.dataDir, srv.id, req.params.steamId, {
        authorId: req.user.id,
        authorName: req.user.username,
        text,
      });
      addAudit(req.user.id, req.user.username, 'player.note.add',
        `Added note to ${req.params.steamId} on ${srv.name}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);
      res.json({ ok: true, note });
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });

  app.delete('/api/servers/:id/players/:steamId/notes/:noteId', authForServer('players.kick'), (req, res) => {
    const srv = ctx.servers.find((s) => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    try {
      const removed = profiles.deleteNote(ctx.CONFIG.dataDir, srv.id, req.params.steamId, req.params.noteId);
      if (!removed) return res.status(404).json({ error: 'Note not found' });
      addAudit(req.user.id, req.user.username, 'player.note.delete',
        `Deleted note ${req.params.noteId} from ${req.params.steamId} on ${srv.name}`);
      res.json({ ok: true });
    } catch (err) {
      safeError(err, req, res, { status: 500 });
    }
  });
};
