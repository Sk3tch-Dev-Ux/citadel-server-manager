/**
 * Per-Discord-user → Citadel-role mapping (audit H6 Layer 3).
 *
 *   GET    /api/discord/user-roles                   — list all mappings
 *   PUT    /api/discord/user-roles/:discordUserId    — set/update mapping
 *   DELETE /api/discord/user-roles/:discordUserId    — remove mapping
 *
 * The map is stored in data/discord-user-roles.json as a flat object:
 *   { '<discordUserId>': '<citadel-role-id>', ... }
 *
 * Used by backend/routes/discord.routes.js → resolveRoleForCall(): when a
 * Discord-bot call is HMAC-verified (Layer 2) and the user appears in
 * this map, the mapped role's permissions decide what actions are
 * allowed. Unmapped Discord users — including unsigned legacy bot calls
 * — fall back to the built-in 'discord-bot' role.
 *
 * Auth: admin only. The mapping is privileged config (it can grant any
 * Citadel role to any Discord user) so we gate on 'users.manage' to keep
 * it consistent with how user roles are managed elsewhere in the panel.
 */
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { addAudit } = require('../lib/audit');
const auth = require('../middleware/auth');
const logger = require('../lib/logger');

// Discord snowflakes are 17–20 digit numbers. Validate to a forgiving
// shape rather than the strict /^\d{17,20}$/ used by the bot's
// permissions.js — operators occasionally paste with extra whitespace
// from Discord's "Copy ID" UI on different clients.
function isValidDiscordSnowflake(id) {
  return typeof id === 'string' && /^\d{16,21}$/.test(id);
}

function persist() {
  try {
    saveJSON(ctx.CONFIG.dataDir, 'discord-user-roles.json', ctx.discordUserRoles || {});
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to persist discord-user-roles.json');
  }
}

module.exports = function (app) {
  // ── GET /api/discord/user-roles ──────────────────────────
  // Returns: { mappings: [{ discordUserId, roleId, roleName }] }
  // Resolves role names for the UI so the frontend doesn't need a second
  // lookup. Unknown role ids (mapping points at a deleted role) come back
  // with roleName: null and a 'orphaned: true' flag so the UI can offer
  // to clean them up.
  app.get('/api/discord/user-roles', auth('users.manage'), (req, res) => {
    const map = ctx.discordUserRoles || {};
    const mappings = Object.entries(map).map(([discordUserId, roleId]) => {
      const role = ctx.roles.find(r => r.id === roleId);
      return {
        discordUserId,
        roleId,
        roleName: role ? role.name : null,
        orphaned: !role,
      };
    });
    res.json({ mappings });
  });

  // ── PUT /api/discord/user-roles/:discordUserId ───────────
  // Body: { roleId: string }. Creates or replaces the mapping.
  app.put('/api/discord/user-roles/:discordUserId', auth('users.manage'), (req, res) => {
    const { discordUserId } = req.params;
    const { roleId } = req.body || {};

    if (!isValidDiscordSnowflake(discordUserId)) {
      return res.status(400).json({ error: 'discordUserId must be a 17–20 digit Discord snowflake' });
    }
    if (typeof roleId !== 'string' || roleId.length === 0) {
      return res.status(400).json({ error: 'roleId is required' });
    }
    const role = ctx.roles.find(r => r.id === roleId);
    if (!role) {
      return res.status(400).json({ error: `Unknown role: ${roleId}` });
    }

    if (!ctx.discordUserRoles) ctx.discordUserRoles = {};
    const previous = ctx.discordUserRoles[discordUserId] || null;
    ctx.discordUserRoles[discordUserId] = roleId;
    persist();

    addAudit(req.user.id, req.user.username, 'discord.user-role.set',
      previous
        ? `Changed Discord user ${discordUserId} role: ${previous} → ${roleId}`
        : `Mapped Discord user ${discordUserId} → role ${roleId}`);

    res.json({ discordUserId, roleId, roleName: role.name });
  });

  // ── DELETE /api/discord/user-roles/:discordUserId ────────
  // Removes the mapping; the user falls back to the default discord-bot
  // role on subsequent calls. Idempotent — deleting a non-existent
  // mapping returns 200 with deleted: false.
  app.delete('/api/discord/user-roles/:discordUserId', auth('users.manage'), (req, res) => {
    const { discordUserId } = req.params;
    if (!isValidDiscordSnowflake(discordUserId)) {
      return res.status(400).json({ error: 'discordUserId must be a 17–20 digit Discord snowflake' });
    }
    if (!ctx.discordUserRoles || !ctx.discordUserRoles[discordUserId]) {
      return res.json({ discordUserId, deleted: false });
    }
    const previous = ctx.discordUserRoles[discordUserId];
    delete ctx.discordUserRoles[discordUserId];
    persist();
    addAudit(req.user.id, req.user.username, 'discord.user-role.remove',
      `Removed Discord user ${discordUserId} role mapping (was: ${previous})`);
    res.json({ discordUserId, deleted: true });
  });
};
