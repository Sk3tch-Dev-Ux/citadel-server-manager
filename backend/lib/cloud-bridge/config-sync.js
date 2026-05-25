/**
 * Inbound config_sync handler — persists cloud-pushed config bundles into
 * the linked server's `$profile:Citadel/config_<type>.json` file, where
 * the DayZ mod can read them on its next tick.
 *
 * Today only `config_type: 'bans'` is actively pushed by the cloud (per
 * the alignment doc §3). The other types (chat_filters, name_filters,
 * whitelist, priority_queue, schedules, messenger) are reserved in the
 * shared types but not yet shipped by the cloud side — we still persist
 * them blindly so when the cloud starts pushing them the mod-side
 * consumer just has to read the file. Single write path, future-proof.
 *
 * The bans payload shape from the cloud:
 *   { full: true, bans: [ { steamId, reasonCategory, activatedAt }, ... ] }
 * `full: true` means "this is the authoritative complete set" → mod
 * should replace its local cache. The Agent doesn't interpret the payload;
 * it just writes it through verbatim.
 *
 * Mod-side enforcement (deny/kick on connect) is a separate task tracked
 * in CITADEL_AGENT_ALIGNMENT.md §3 — not in scope here.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../context');
const logger = require('../logger');

const ALLOWED_TYPES = new Set([
  'bans',
  'chat_filters',
  'name_filters',
  'whitelist',
  'priority_queue',
  'schedules',
  'messenger',
]);

/**
 * Resolve the `$profile:Citadel/` directory for a given local server,
 * creating it if it doesn't exist. Mirrors how citadel-bridge.js builds
 * the path so the mod reads from the same place.
 */
function _citadelDir(localServerId) {
  const srv = (ctx.servers || []).find((s) => s.id === localServerId);
  if (!srv) return null;
  const profileDir = srv.profileDir
    ? path.resolve(srv.installDir, srv.profileDir)
    : path.join(srv.installDir, 'profiles');
  const dir = path.join(profileDir, 'Citadel');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

/**
 * Persist a CloudConfigSyncMessage. Never throws — logs and returns false
 * on failure so the caller doesn't crash the WS loop over a bad write.
 *
 * @param {object} args
 * @param {string} args.localServerId
 * @param {object} args.message   the `{ type:'config_sync', config_type, data }` frame
 * @returns {boolean} success
 */
function handle({ localServerId, message }) {
  const cfgType = String(message?.config_type || '');
  if (!ALLOWED_TYPES.has(cfgType)) {
    logger.warn({ localServerId, config_type: cfgType }, 'cloud-bridge: rejecting unknown config_sync type');
    return false;
  }

  const dir = _citadelDir(localServerId);
  if (!dir) {
    logger.warn({ localServerId }, 'cloud-bridge: cannot resolve Citadel dir for config_sync');
    return false;
  }

  const file = path.join(dir, `config_${cfgType}.json`);
  const payload = message.data ?? null;
  try {
    // Atomic-ish write: stage to a sibling .tmp then rename. Avoids the
    // mod reading a half-written file if it polls in the same instant.
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
    logger.info({ localServerId, config_type: cfgType, file }, 'cloud-bridge: config_sync persisted');
    return true;
  } catch (err) {
    logger.error({ err: err.message, localServerId, config_type: cfgType }, 'cloud-bridge: config_sync write failed');
    return false;
  }
}

module.exports = { handle, ALLOWED_TYPES };
