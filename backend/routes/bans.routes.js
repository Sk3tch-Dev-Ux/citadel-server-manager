/**
 * Global Ban Database — CRUD + Import/Export routes.
 *
 * All endpoints require authentication with 'bans.manage' permission.
 * Route order: fixed paths before parameterized to avoid collisions.
 */
const auth = require('../middleware/auth');
const { addAudit } = require('../lib/audit');
const { fireWebhooks } = require('../lib/notifications');
const {
  listBans, getBanById, addBan, removeBan,
  importBans, exportBans,
} = require('../lib/ban-engine');

module.exports = function (app) {

  // ─── List all bans ──────────────────────────────────────
  app.get('/api/bans', auth('bans.manage'), (req, res) => {
    res.json(listBans());
  });

  // ─── Export bans as JSON download ───────────────────────
  app.get('/api/bans/export', auth('bans.manage'), (req, res) => {
    const data = exportBans();
    const filename = `citadel-bans-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  });

  // ─── Import bans from JSON array ────────────────────────
  app.post('/api/bans/import', auth('bans.manage'), (req, res) => {
    const bansArray = req.body;
    if (!Array.isArray(bansArray)) {
      return res.status(400).json({ error: 'Request body must be a JSON array of bans' });
    }
    const result = importBans(bansArray, req.user.username);
    addAudit(req.user.id, req.user.username, 'bans.import', `Imported bans: ${result.added} added, ${result.skipped} skipped, ${result.errors} errors`);
    res.json(result);
  });

  // ─── Get single ban by UUID ─────────────────────────────
  app.get('/api/bans/:id', auth('bans.manage'), (req, res) => {
    const ban = getBanById(req.params.id);
    if (!ban) return res.status(404).json({ error: 'Ban not found' });
    res.json(ban);
  });

  // ─── Add a manual ban by SteamID ────────────────────────
  app.post('/api/bans', auth('bans.manage'), (req, res) => {
    const { steamId, playerName, reason, expiresAt } = req.body;
    if (!steamId) return res.status(400).json({ error: 'steamId is required' });
    const ban = addBan({
      steamId,
      playerName: playerName || 'Unknown',
      reason: reason || 'Banned',
      expiresAt: expiresAt || null,
      bannedBy: req.user.username,
      source: 'manual',
    });
    addAudit(req.user.id, req.user.username, 'bans.add', `Banned ${steamId} (${playerName || 'Unknown'}): ${reason || 'Banned'}`);
    fireWebhooks('player.ban', {
      serverId: 'global',
      serverName: 'Global Ban Database',
      playerId: steamId,
      playerName: playerName || 'Unknown',
      reason: reason || 'Banned',
    });
    res.json(ban);
  });

  // ─── Remove ban by UUID ─────────────────────────────────
  app.delete('/api/bans/:id', auth('bans.manage'), (req, res) => {
    const ban = removeBan(req.params.id);
    if (!ban) return res.status(404).json({ error: 'Ban not found' });
    addAudit(req.user.id, req.user.username, 'bans.remove', `Unbanned ${ban.steamId} (${ban.playerName})`);
    fireWebhooks('player.unban', {
      serverId: 'global',
      serverName: 'Global Ban Database',
      playerId: ban.steamId,
      playerName: ban.playerName,
    });
    res.json({ message: 'Ban removed', ban });
  });
};
