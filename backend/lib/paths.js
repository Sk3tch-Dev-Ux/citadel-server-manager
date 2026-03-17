/**
 * Bundle-aware path resolution.
 *
 * When running from source:   __dirname = backend/lib/  → ROOT = ../../
 * When running as esbuild bundle: __dirname = Citadel/   → ROOT = __dirname
 *
 * The build script defines __CITADEL_BUNDLED__ = true at compile time.
 */
const path = require('path');

/* global __CITADEL_BUNDLED__ */
const BUNDLED = typeof __CITADEL_BUNDLED__ !== 'undefined' && __CITADEL_BUNDLED__;

const ROOT = BUNDLED
  ? __dirname
  : path.resolve(__dirname, '..', '..');

const WEB_DIST = BUNDLED
  ? path.join(__dirname, 'web', 'dist')
  : path.join(ROOT, 'web', 'dist');

const BOT_ENTRY = BUNDLED
  ? path.join(__dirname, 'citadel-discord-bot.js')
  : path.join(ROOT, 'discord-bot', 'bot.js');

const SIDECAR_ENTRY = BUNDLED
  ? path.join(__dirname, 'citadel-sidecar.js')
  : path.join(ROOT, 'sidecar', 'server.js');

const SERVER_ENTRY = BUNDLED
  ? path.join(__dirname, 'citadel-server.js')
  : path.join(ROOT, 'backend', 'server.js');

const ENV_FILE = path.join(ROOT, '.env');

module.exports = { BUNDLED, ROOT, WEB_DIST, BOT_ENTRY, SIDECAR_ENTRY, SERVER_ENTRY, ENV_FILE };
