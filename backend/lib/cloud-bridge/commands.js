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
 * Note on `ban`: matches the cloud-side alignment doc (§2). The durable
 * ban is propagated to the agent through `config_sync.bans`, not through
 * the outbound command. So `ban` here just kicks the player off the server
 * for immediate effect — the persistent ban list arrives via config-sync.
 *
 * Failure modes that produce ok=false:
 *   - Unknown action → reply immediately, no mod IPC
 *   - Missing required params → reply immediately
 *   - Mod IPC timeout (5s default in bridge) → reply with timeout error
 *   - Mod responds with {ok:false, error}  → pass error through
 */
const { getBridge } = require('../citadel-bridge');
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
  const params = (message?.params && typeof message.params === 'object') ? message.params : {};

  if (!id) {
    logger.warn({ localServerId, action }, 'cloud-bridge: command missing id — cannot reply');
    return;
  }

  const reply = (success, msg) => {
    client.send({ type: 'command_result', id, success, message: String(msg || '') });
  };

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
