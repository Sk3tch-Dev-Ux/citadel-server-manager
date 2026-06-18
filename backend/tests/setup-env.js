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

// At-rest credential encryption (servers-store → credential-encryption) needs a
// key. Set a deterministic test key so the encrypt path — exercised by
// ensureRconConfig's save and any test that persists a server — works in EVERY
// test, regardless of whether lib/config loaded/persisted a JWT_SECRET first.
// (Tests that don't require lib/config otherwise have neither key and the
// encrypt throws, e.g. rcon-config.test.js's generate path.)
process.env.CREDENTIAL_ENCRYPTION_KEY =
  process.env.CREDENTIAL_ENCRYPTION_KEY || 'test-credential-encryption-key-not-for-production';
