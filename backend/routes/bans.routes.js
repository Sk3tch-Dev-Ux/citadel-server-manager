/**
 * Global Ban Database — CRUD + Import/Export routes.
 *
 * All endpoints require authentication with 'bans.manage' permission.
 * Route order: fixed paths before parameterized to avoid collisions.
 *
 * Phase 3 hook: paying Citadel Cloud customers can opt their bans into
 * the community ban DB. The hook is best-effort — local ban write succeeds
 * even if community submission fails (network, rate limit, weight lock).
 */
const auth = require('../middleware/auth');
const { addAudit } = require('../lib/audit');
const { fireWebhooks } = require('../lib/notifications');
const cloudBans = require('../lib/cloud-bans');
const logger = require('../lib/logger');
const {
  listBans, getBanById, addBan, removeBan,
  importBans, exportBans,
} = require('../lib/ban-engine');

const ALLOWED_REASON_CATEGORIES = new Set(['cheating', 'griefing', 'exploiting', 'other']);

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
  app.post('/api/bans', auth('bans.manage'), async (req, res) => {
    const {
      steamId,
      playerName,
      reason,
      expiresAt,
      // Phase 3: Cloud Bans hook. Both fields optional — when present and the
      // customer has an active Citadel Cloud subscription, we forward the ban
      // to citadels.cc/api/v1/cloud-bans/submit on a fire-and-forget basis.
      submitToCommunity,
      reasonCategory,
    } = req.body;
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

    // Phase 3 hook — community submission. Only runs when the customer has
    // an active Citadel Cloud subscription AND has explicitly opted in for
    // this ban. We never auto-submit silently — the dashboard's Ban dialog
    // shows the toggle so customers always see what's being sent.
    let cloudResult = null;
    if (submitToCommunity === true && reasonCategory && ALLOWED_REASON_CATEGORIES.has(reasonCategory)) {
      try {
        cloudResult = await cloudBans.submitFromLocalBan({
          steamId,
          reasonCategory,
          // Customer's existing free-text reason becomes the private notes_local —
          // it stays on citadels.cc tied to this customer's account but is never
          // shared with other customers in /sync.
          notesLocal: reason || undefined,
        });
        if (cloudResult?.ok) {
          addAudit(req.user.id, req.user.username, 'cloud-bans.submit', `Submitted ${steamId} to community DB (${reasonCategory})`);
        } else {
          logger.warn({ steamId, reason: cloudResult?.reason }, 'Cloud ban submit returned non-ok');
        }
      } catch (err) {
        logger.warn({ err: err.message, steamId }, 'Cloud ban submit threw');
      }
    }

    res.json({ ...ban, cloudSubmission: cloudResult });
  });

  // ─── Remove ban by UUID ─────────────────────────────────
  app.delete('/api/bans/:id', auth('bans.manage'), async (req, res) => {
    const ban = removeBan(req.params.id);
    if (!ban) return res.status(404).json({ error: 'Ban not found' });
    addAudit(req.user.id, req.user.username, 'bans.remove', `Unbanned ${ban.steamId} (${ban.playerName})`);
    fireWebhooks('player.unban', {
      serverId: 'global',
      serverName: 'Global Ban Database',
      playerId: ban.steamId,
      playerName: ban.playerName,
    });

    // Phase 3 hook — auto-unenroll from the community DB on unban. No flag
    // needed: removing locally implies the customer no longer endorses this
    // ban. If they never submitted it, citadels.cc returns a benign no-op.
    let cloudResult = null;
    try {
      cloudResult = await cloudBans.unenrollFromLocalBan({ steamId: ban.steamId });
      if (cloudResult?.ok) {
        addAudit(req.user.id, req.user.username, 'cloud-bans.unenroll', `Unenrolled ${ban.steamId} from community DB`);
      }
    } catch (err) {
      logger.warn({ err: err.message, steamId: ban.steamId }, 'Cloud ban unenroll threw');
    }

    res.json({ message: 'Ban removed', ban, cloudUnenroll: cloudResult });
  });
};
