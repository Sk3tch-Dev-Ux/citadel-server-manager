'use strict';

/**
 * Config hot-reload — watch citadel.config.json for external edits and apply
 * the safe sections at runtime without a restart.
 *
 * Uses fs.watchFile (stat polling) rather than fs.watch or chokidar: it needs
 * no dependency and, crucially, survives the write-temp-then-rename pattern
 * most editors use (which detaches an fs.watch inode-based watcher).
 *
 * Only "hot" sections are applied live; security/binding sections are reported
 * as needing a restart and left untouched. Env-overridden and sensitive fields
 * are never changed from the file (env always wins; secrets live in .env).
 */
const fs = require('fs');
const logger = require('./logger');
const CONFIG = require('./config');
const { CONFIG_SCHEMA } = require('./config-schema');

// Sections safe to apply at runtime. (polling values are read by loops on their
// next tick/rearm; logging.level takes effect immediately via the side-effect.)
const HOT_RELOADABLE = new Set(['logging', 'backups', 'polling']);
// Sections that only take effect after a restart — reported, not applied.
const RESTART_REQUIRED = new Set(['server', 'auth', 'directories']);

const POLL_INTERVAL_MS = 2000;
let watching = false;
const listeners = [];

/**
 * Diff a parsed config file against the current structured config.
 * Pure — does not mutate. Returns what *would* change.
 *
 * @param {object} parsed - parsed citadel.config.json
 * @param {object} structured - CONFIG._structured
 * @param {object} [envOverrides] - CONFIG._envOverrides (env-locked keys)
 * @returns {{ changed: string[], restartNeeded: string[], skippedSensitive: string[], apply: object }}
 */
function computeConfigChanges(parsed, structured, envOverrides = {}) {
  const changed = [];
  const restartNeeded = [];
  const skippedSensitive = [];
  const apply = {};

  for (const [section, fields] of Object.entries(parsed || {})) {
    if (!CONFIG_SCHEMA[section] || typeof fields !== 'object' || fields === null || Array.isArray(fields)) continue;
    for (const [key, value] of Object.entries(fields)) {
      const def = CONFIG_SCHEMA[section]?.[key];
      if (!def) continue;
      if (def.sensitive) { skippedSensitive.push(`${section}.${key}`); continue; }
      if (envOverrides[section]?.[key]) continue; // env wins — never overridden by file
      if (JSON.stringify(structured[section]?.[key]) === JSON.stringify(value)) continue; // unchanged

      if (RESTART_REQUIRED.has(section)) { restartNeeded.push(`${section}.${key}`); continue; }
      if (!HOT_RELOADABLE.has(section)) continue; // unknown/non-hot section — ignore

      (apply[section] = apply[section] || {})[key] = value;
      changed.push(`${section}.${key}`);
    }
  }
  return { changed, restartNeeded, skippedSensitive, apply };
}

/** Apply live side-effects for specific hot-reloaded keys. */
function applySideEffects(apply) {
  if (apply.logging && apply.logging.level) {
    try { logger.level = apply.logging.level; } catch { /* invalid level — ignore */ }
  }
}

/**
 * Re-read the config file and apply hot-reloadable changes to CONFIG._structured.
 * @param {string} [file] - path to the config file (defaults to CONFIG._configFilePath)
 * @returns {{ changed: string[], restartNeeded: string[] }}
 */
function reload(file = CONFIG._configFilePath) {
  let parsed;
  try {
    if (!fs.existsSync(file)) return { changed: [], restartNeeded: [] };
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    logger.warn({ err: err.message }, 'config-watcher: ignoring invalid config file');
    return { changed: [], restartNeeded: [] };
  }

  const { changed, restartNeeded, apply } = computeConfigChanges(parsed, CONFIG._structured, CONFIG._envOverrides);

  for (const [section, fields] of Object.entries(apply)) {
    for (const [key, value] of Object.entries(fields)) {
      CONFIG._structured[section][key] = value;
    }
  }

  if (changed.length) {
    applySideEffects(apply);
    logger.info({ changed }, 'config-watcher: hot-reloaded config');
    for (const fn of listeners) { try { fn(changed, apply); } catch (err) { logger.debug({ err: err.message }, 'config-watcher listener error'); } }
  }
  if (restartNeeded.length) {
    logger.warn({ restartNeeded }, 'config-watcher: these changes require a restart to take effect');
  }
  return { changed, restartNeeded };
}

/** Register a callback fired after a successful hot-reload. */
function onReload(fn) { if (typeof fn === 'function') listeners.push(fn); }

/** Start watching the config file. Idempotent. */
function start() {
  if (watching) return;
  const file = CONFIG._configFilePath;
  watching = true;
  fs.watchFile(file, { interval: POLL_INTERVAL_MS }, (curr, prev) => {
    // mtimeMs unchanged (or file removed) → nothing to do.
    if (curr.mtimeMs === 0 || curr.mtimeMs === prev.mtimeMs) return;
    reload(file);
  });
  logger.info({ file }, 'config-watcher: watching citadel.config.json for changes');
}

/** Stop watching (graceful shutdown / tests). */
function stop() {
  if (!watching) return;
  fs.unwatchFile(CONFIG._configFilePath);
  watching = false;
}

module.exports = { start, stop, reload, onReload, computeConfigChanges };
