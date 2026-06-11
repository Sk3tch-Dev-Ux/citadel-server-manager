/**
 * BattlEye RCON configuration management.
 *
 * The DayZ x64 server reads `<battleyeDir>\BEServer_x64.cfg`, where
 * battleyeDir is `<installDir>\battleye` unless a `-BEpath=` launch param
 * overrides it. Without that file — or with an empty RConPassword — BattlEye
 * never opens the RCON port, and everything that depends on RCON silently
 * degrades: reason-visible kicks, ban appeal messages, player slot
 * resolution, external RCON tools.
 *
 * ensureRconConfig() makes RCON work out of the box for every server:
 *   - no password on the server record → adopt a non-empty one from an
 *     existing cfg (respect operator-managed config), else generate one and
 *     persist it to servers.json
 *   - cfg missing → write it; cfg present but password/port drifted from the
 *     dashboard (the source of truth) → rewrite just the RCON directives,
 *     preserving any other operator lines
 *   - stale `beserver_x64_active_*.cfg` copies are removed when (re)writing —
 *     BattlEye prefers the active copy, which would resurrect the old password
 *
 * Called from server-lifecycle.startServer() BEFORE spawn (the server must be
 * stopped for cfg changes to take effect). Never throws.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const ctx = require('./context');
const { saveJSON } = require('./data-store');

const CFG_NAME = 'BEServer_x64.cfg';

/**
 * Resolve the BattlEye directory for a server: `-BEpath=` launch param if
 * present (absolute or relative to installDir), else `<installDir>\battleye`.
 */
function resolveBattlEyeDir(srv) {
  const m = (srv.launchParams || '').match(/-BEpath=["']?([^"'\s]+)["']?/i);
  if (m) {
    return path.isAbsolute(m[1]) ? m[1] : path.join(srv.installDir || '', m[1]);
  }
  return path.join(srv.installDir || '', 'battleye');
}

/** Parse RConPassword / RConPort out of a BE cfg, keeping all lines. */
function parseCfg(text) {
  const out = { password: '', port: null, lines: String(text).split(/\r?\n/) };
  for (const line of out.lines) {
    const pw = line.match(/^\s*RConPassword\s+(\S+)/i);
    if (pw) out.password = pw[1];
    const pt = line.match(/^\s*RConPort\s+(\d+)/i);
    if (pt) out.port = parseInt(pt[1], 10);
  }
  return out;
}

/**
 * Ensure the server has a usable RCON setup. See module docs for the rules.
 * @returns {{ok: boolean, created: boolean, updated: boolean,
 *            generatedPassword: boolean, adoptedPassword: boolean, port: number}}
 */
function ensureRconConfig(srv) {
  const result = {
    ok: false, created: false, updated: false,
    generatedPassword: false, adoptedPassword: false,
    port: parseInt(srv?.rconPort, 10) || 2305,
  };
  try {
    if (!srv?.installDir || !fs.existsSync(srv.installDir)) return result;

    const beDir = resolveBattlEyeDir(srv);
    const cfgPath = path.join(beDir, CFG_NAME);
    let existing = null;
    if (fs.existsSync(cfgPath)) {
      existing = parseCfg(fs.readFileSync(cfgPath, 'utf-8'));
    }

    // Password resolution: dashboard value wins; otherwise adopt a non-empty
    // password from an operator-managed cfg; otherwise generate one. The
    // generated/adopted value is persisted so the RCON client, the cloud
    // bridge, and the next boot all agree.
    if (!srv.rconPassword) {
      if (existing && existing.password) {
        srv.rconPassword = existing.password;
        result.adoptedPassword = true;
      } else {
        srv.rconPassword = crypto.randomBytes(10).toString('hex'); // 20 alnum chars
        result.generatedPassword = true;
      }
      saveJSON(ctx.CONFIG.dataDir, 'servers.json', ctx.servers);
    }

    const inSync = existing
      && existing.password === srv.rconPassword
      && existing.port === result.port;

    if (!inSync) {
      if (!fs.existsSync(beDir)) fs.mkdirSync(beDir, { recursive: true });
      // Preserve operator-added directives; replace only the RCON lines.
      const kept = existing
        ? existing.lines.filter(l => !/^\s*RCon(Password|Port)\b/i.test(l) && l.trim() !== '')
        : [];
      const lines = [`RConPassword ${srv.rconPassword}`, `RConPort ${result.port}`, ...kept];
      fs.writeFileSync(cfgPath, lines.join('\r\n') + '\r\n');
      if (existing) result.updated = true;
      else result.created = true;

      // Drop stale "active" copies — BattlEye reads those in preference to
      // the base cfg, which would resurrect the old password. The server is
      // stopped at this point; a locked file just means we leave it be.
      for (const f of fs.readdirSync(beDir)) {
        if (/^beserver(_x64)?_active.*\.cfg$/i.test(f)) {
          try { fs.unlinkSync(path.join(beDir, f)); } catch { /* locked — skip */ }
        }
      }
    }

    result.ok = true;
  } catch (err) {
    logger.warn({ err: err.message, server: srv?.name }, 'ensureRconConfig failed');
  }
  return result;
}

module.exports = { ensureRconConfig, resolveBattlEyeDir, parseCfg };
