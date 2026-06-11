/**
 * Inbound command dispatch — translates a cloud `CloudCommandMessage` into
 * the matching mod-side action via the existing CitadelBridge file-IPC,
 * and emits a `command_result` frame back to the cloud with the same id.
 *
 * Cloud's `CommandAction` vocabulary (citadel-cloud/packages/shared/types/plugin.ts):
 *   kick, ban, heal, kill, teleport, spawn_item, message, broadcast,
 *   set_time, set_weather, wipe_ai, wipe_vehicles
 *
 * Map to mod actions (the bridge writes commands/{id}.cmd.json with these):
 *   kick           → player.kick           {steamId, reason?}
 *   ban            → player.kick           {steamId, reason?}   ← see note
 *   heal           → player.heal           {steamId}
 *   kill           → player.kill           {steamId}
 *   teleport       → player.teleport       {steamId, x, y, z}
 *   spawn_item     → player.spawnItem      {steamId, className, quantity?}
 *   message        → player.message        {steamId, text}
 *   broadcast      → world.broadcast       {text}
 *   set_time       → world.time            {hour, minute?}
 *   set_weather    → world.weather         {preset}  // 'clear'|'overcast'|'rain'|'storm'
 *   wipe_ai        → world.wipeAI          {}
 *   wipe_vehicles  → world.wipeVehicles    {}
 *
 * Note on `ban`: handled by the agent's own ban engine (durable global ban
 * + ban.txt sync + RCON kick with the configured ban message), NOT the mod
 * IPC. The alignment doc (§2) envisioned durability arriving via
 * `config_sync.bans`, but the cloud doesn't send that yet — and a kick-only
 * ban let players rejoin immediately. When cloud config-sync bans land,
 * the two mechanisms are idempotent (addBan dedupes by steamId).
 *
 * Failure modes that produce ok=false:
 *   - Unknown action → reply immediately, no mod IPC
 *   - Missing required params → reply immediately
 *   - Mod IPC timeout (5s default in bridge) → reply with timeout error
 *   - Mod responds with {ok:false, error}  → pass error through
 */
const { getBridge } = require('../citadel-bridge');
const { restartServer } = require('../server-lifecycle');
const { banPlayer } = require('../ban-engine');
const ctx = require('../context');
const logger = require('../logger');

const ACTION_MAP = Object.freeze({
  kick:          { mod: 'player.kick',         requires: ['steamId'] },
  ban:           { mod: 'player.kick',         requires: ['steamId'] },
  heal:          { mod: 'player.heal',         requires: ['steamId'] },
  kill:          { mod: 'player.kill',         requires: ['steamId'] },
  teleport:      { mod: 'player.teleport',     requires: ['steamId', 'x', 'y', 'z'] },
  spawn_item:    { mod: 'player.spawnItem',    requires: ['steamId', 'className'] },
  message:       { mod: 'player.message',      requires: ['steamId', 'text'] },
  broadcast:     { mod: 'world.broadcast',     requires: ['text'] },
  set_time:      { mod: 'world.time',          requires: ['hour'] },
  set_weather:   { mod: 'world.weather',       requires: ['preset'] },
  wipe_ai:       { mod: 'world.wipeAI',        requires: [] },
  wipe_vehicles: { mod: 'world.wipeVehicles',  requires: [] },
});

/**
 * Run a cloud command against the linked DayZ server, then send a
 * `command_result` back via the supplied client. Never throws — failures
 * are surfaced as command_result with ok:false so the cloud's dispatcher
 * doesn't sit on a hung promise.
 *
 * @param {object} ctx
 * @param {string} ctx.localServerId
 * @param {object} ctx.client                 CloudWsClient
 * @param {object} ctx.message                CloudCommandMessage
 */
async function handle({ localServerId, client, message }) {
  const id = String(message?.id || '');
  const action = String(message?.action || '');
  const params = (message?.params && typeof message.params === 'object') ? { ...message.params } : {};

  // The cloud's wire convention is snake_case (its console, command validator,
  // enforcement worker, and RCON copilot all send `steam_id`); the mod IPC
  // vocabulary is camelCase. Normalize so neither side's convention breaks the
  // other — without this, every player-targeted Live Ops action died here with
  // "Missing required param: steamId".
  if (params.steamId == null && params.steam_id != null) params.steamId = params.steam_id;
  if (params.className == null && params.class_name != null) params.className = params.class_name;
  if (params.text == null && params.message != null) params.text = params.message;

  if (!id) {
    logger.warn({ localServerId, action }, 'cloud-bridge: command missing id — cannot reply');
    return;
  }

  const reply = (success, msg) => {
    logger.info({ localServerId, action, id, success, msg: String(msg || '') }, 'cloud-bridge: command result');
    client.send({ type: 'command_result', id, success, message: String(msg || '') });
  };
  logger.info({ localServerId, action, id }, 'cloud-bridge: command received');

  // Server lifecycle — `restart` is not a mod IPC action; it drives the
  // agent's own process control. The cloud owns scheduling (its schedule
  // worker dispatches this); the agent just executes. Reply fast because a
  // full restart (graceful stop + respawn + backoff) can outlast the cloud's
  // command-dispatch timeout — run it in the background.
  if (action === 'restart') {
    reply(true, 'restart initiated');
    Promise.resolve(restartServer(localServerId, 'cloud-requested')).catch((err) => {
      logger.error({ err: err.message, localServerId }, 'cloud-bridge: cloud-requested restart failed');
    });
    return;
  }

  const spec = ACTION_MAP[action];
  if (!spec) {
    reply(false, `Unknown action: ${action}`);
    return;
  }

  // Required-params guard. The cloud's command-bridge dispatcher already
  // refuses to send actions missing a target steamId on player-targeted
  // ones, but we re-validate so a future cloud change can't ship us a
  // missing field that the mod would crash on.
  for (const k of spec.requires) {
    if (params[k] == null || params[k] === '') {
      reply(false, `Missing required param: ${k}`);
      return;
    }
  }

  // `ban` — use the agent's full ban flow instead of the kick-only mod IPC:
  // durable global ban + ban.txt sync (the engine then refuses the reconnect)
  // + RCON kick showing the configured ban message (reason + appeal info) on
  // the player's screen. Previously a cloud ban was just a kick, so the
  // player saw no reason and could rejoin immediately.
  if (action === 'ban') {
    try {
      await banPlayer(localServerId, String(params.steamId), String(params.reason || 'Banned via Citadel Cloud'), null, 'cloud');
      reply(true, 'banned (durable) and kicked');
    } catch (err) {
      reply(false, `Ban failed: ${err.message}`);
    }
    return;
  }

  // `kick` — prefer BattlEye RCON: its kick displays the reason on the
  // player's disconnect screen, which the mod's DisconnectPlayer cannot.
  // Falls through to the mod IPC kick when RCON or the slot is unavailable.
  if (action === 'kick') {
    const state = ctx.serverStates[localServerId];
    const target = state?.players?.find(p => p.steamId === params.steamId || p.id === params.steamId);
    if (state?.rcon?.loggedIn && target?.rconSlot != null) {
      try {
        await state.rcon.kick(String(target.rconSlot), String(params.reason || 'Kicked by admin'));
        state.players = state.players.filter(p => p.steamId !== params.steamId && p.id !== params.steamId);
        if (ctx.io) ctx.emitServer('players', { serverId: localServerId, players: state.players });
        reply(true, 'kicked (RCON, reason shown)');
        return;
      } catch (err) {
        logger.warn({ err: err.message, localServerId }, 'cloud-bridge: RCON kick failed — falling back to mod IPC');
      }
    }
  }

  const bridge = getBridge(localServerId);
  if (!bridge) {
    reply(false, 'Citadel bridge unavailable on this server');
    return;
  }

  try {
    // Bridge's sendCommand awaits the mod's .res.json and returns
    // {id, ok, data, error?}. Default timeout is 10s in citadel-bridge.js
    // (COMMAND_TIMEOUT_MS) which sits comfortably under the cloud's 30s
    // dispatch timeout per the alignment doc.
    const res = await bridge.sendCommand(spec.mod, params);
    const ok = !!res?.ok;
    const msg = ok ? (res?.data?.message || 'ok') : (res?.error || 'mod reported failure');
    reply(ok, msg);
  } catch (err) {
    // sendCommand throws on timeout / file IO error. Translate.
    const timeout = /timed out/i.test(err?.message || '');
    reply(false, timeout ? `Command timed out (${spec.mod})` : `Bridge error: ${err.message}`);
  }
}

module.exports = { handle, ACTION_MAP };
