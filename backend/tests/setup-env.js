'use strict';

/**
 * Jest setupFiles hook — runs before any module (including lib/config) loads.
 *
 * Redirects the Agent's data directory to a throwaway temp dir for the duration
 * of the test run. Without this, tests share the real ./data directory and
 * pollute persistent state — most visibly the fail2ban ip-bans.json, whose
 * accumulated failed-login records across repeated runs would eventually
 * 429 the auth tests. Isolating the data dir makes the suite hermetic.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-test-data-'));
process.env.CITADEL_DATA_DIR = dir; // consumed by lib/config-schema → config.js
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
