'use strict';

/**
 * Root cause B: the install route used to call modCache.getCached(workshopId)
 * with NO steamTimeUpdated, so the version-invalidation branch was dead and a
 * stale cached copy was reinstalled forever. The route now fetches the remote
 * Workshop time_updated and passes it through.
 *
 * These tests prove the cache helper actually version-invalidates when the
 * remote time_updated is newer (the wiring the route now exercises), and that
 * the null / network-fail path falls back to TTL-only behaviour.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const modCache = require('../lib/mod-cache');

const WORKSHOP_ID = '99999';
let cacheDir;

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-modcache-'));
  modCache.initCache(cacheDir);
});

afterEach(() => {
  try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch { /* ok */ }
});

// Seed a non-expired cache entry with a known time_updated.
function seedEntry(timeUpdated) {
  const contentDir = path.join(cacheDir, WORKSHOP_ID);
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'config.cpp'), 'cached bytes');
  const meta = {
    workshopId: WORKSHOP_ID,
    name: 'CitadelAdmin',
    cachedAt: new Date().toISOString(), // fresh — not TTL-expired
    time_updated: timeUpdated,
    size: 12,
  };
  fs.writeFileSync(path.join(cacheDir, `${WORKSHOP_ID}.json`), JSON.stringify(meta));
  return contentDir;
}

describe('B. version-blind cache fix — getCached(workshopId, steamTimeUpdated)', () => {
  test('INVALIDATES a fresh entry when Steam time_updated is newer', () => {
    const contentDir = seedEntry(1000);
    // Newer remote version → must invalidate and return null (forces re-download).
    const result = modCache.getCached(WORKSHOP_ID, 2000);
    expect(result).toBeNull();
    // Entry was physically removed.
    expect(fs.existsSync(contentDir)).toBe(false);
  });

  test('HITS (returns content) when Steam time_updated is not newer', () => {
    const contentDir = seedEntry(2000);
    const result = modCache.getCached(WORKSHOP_ID, 2000); // same version
    expect(result).toBe(contentDir);
  });

  test('HITS when Steam time_updated is older than cached', () => {
    const contentDir = seedEntry(3000);
    expect(modCache.getCached(WORKSHOP_ID, 1500)).toBe(contentDir);
  });

  test('falls back to TTL-only (cache hit) when steamTimeUpdated is null (network fail)', () => {
    const contentDir = seedEntry(1000);
    // null == couldn't determine remote version → don't invalidate, serve cache.
    expect(modCache.getCached(WORKSHOP_ID, null)).toBe(contentDir);
    // And the legacy no-arg form (the OLD buggy call) still serves stale — proving
    // it was version-blind, which is exactly why the route now passes the arg.
    expect(modCache.getCached(WORKSHOP_ID)).toBe(contentDir);
  });
});
