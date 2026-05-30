'use strict';

/**
 * DZSA Launcher mod-list publishing.
 *
 * The DayZ Standalone Launcher (DZSA) — and the aggregator APIs that feed it
 * (dayzsalauncher.com, daemonforge.dev) — discover a modded server's mod set by
 * reading a small HTTP endpoint the host serves on the conventional
 * `gamePort + 10`. Without it a modded server is hard to find and players can't
 * one-click-subscribe to the exact mod set before joining. CF Architect ships
 * this ("publish to DZSA every 60s"); Citadel previously did not.
 *
 * We host the endpoint in-process per server. Because it reads the live mod list
 * on every request it is always current — strictly better than a timed push.
 *
 * Opt-in per server via `dzsaPublish: true` (it binds an extra public port, so
 * it should be a deliberate choice and the port must be allowed through the
 * firewall). Best-effort; never throws into a caller.
 */
const http = require('http');
const ctx = require('./context');
const logger = require('./logger');

const DAYZ_APP_ID = 221100;          // Steam app id reported per mod (DayZ)
const DZSA_PORT_OFFSET = 10;         // DZSA convention: mod-list endpoint at gamePort + 10

/** serverId -> http.Server */
const _servers = new Map();

/** The conventional DZSA mod-list port for a server. */
function dzsaPort(srv) {
  return (Number(srv.gamePort) || 2302) + DZSA_PORT_OFFSET;
}

/** Build the mod array in the shape DZSA aggregators parse (`.mods[]`). */
function buildModList(serverId) {
  const state = ctx.serverStates[serverId];
  return (state?.modList || [])
    .filter((m) => m.enabled !== false && m.workshopId)
    .map((m) => ({
      name: m.name,
      id: Number(m.workshopId) || m.workshopId,
      app_id: DAYZ_APP_ID,
      type: m.type === 'server' ? 'server' : 'client',
    }));
}

/** Full JSON payload served on the endpoint. */
function buildPayload(srv) {
  return {
    name: srv.name,
    maxPlayers: Number(srv.maxPlayers) || 60,
    gamePort: Number(srv.gamePort) || 2302,
    queryPort: Number(srv.queryPort) || 2303,
    mods: buildModList(srv.id),
  };
}

/** The address a player/launcher uses to read this server's mod list. */
function publicUrl(srv) {
  const host = srv.ip || ctx.CONFIG?.dayz?.serverIp || 'YOUR_SERVER_IP';
  return `http://${host}:${dzsaPort(srv)}/`;
}

/**
 * Start the DZSA endpoint for a server (no-op unless dzsaPublish is enabled or
 * already running). Idempotent.
 */
function start(srv) {
  if (!srv || srv.dzsaPublish !== true) return;
  if (_servers.has(srv.id)) return;
  const port = dzsaPort(srv);
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      res.end(JSON.stringify(buildPayload(srv)));
    } catch (err) {
      res.statusCode = 500;
      res.end('{"error":"internal"}');
      logger.debug({ err: err.message, serverId: srv.id }, 'dzsa-publisher: payload error');
    }
  });
  server.on('error', (err) => {
    logger.warn({ err: err.message, serverId: srv.id, port }, 'dzsa-publisher: listen failed');
    _servers.delete(srv.id);
  });
  server.listen(port, '0.0.0.0', () =>
    logger.info({ serverId: srv.id, port }, 'dzsa-publisher: mod-list endpoint live'));
  _servers.set(srv.id, server);
}

/** Stop the DZSA endpoint for a server. */
function stop(serverId) {
  const s = _servers.get(serverId);
  if (s) {
    try { s.close(); } catch { /* ignore */ }
    _servers.delete(serverId);
  }
}

/** Reconcile to the current toggle (start if enabled, stop if disabled). */
function sync(srv) {
  if (!srv) return;
  if (srv.dzsaPublish === true) start(srv);
  else stop(srv.id);
}

function isPublishing(serverId) { return _servers.has(serverId); }

module.exports = {
  start, stop, sync, isPublishing, buildPayload, buildModList, dzsaPort, publicUrl,
  DZSA_PORT_OFFSET,
};
