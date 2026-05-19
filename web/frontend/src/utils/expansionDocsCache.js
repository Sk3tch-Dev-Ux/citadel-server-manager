import API from '../api';

/**
 * Shared cache for /api/expansion-docs/templates.
 *
 * The template index is wiki-synced static data; it only changes when an
 * operator runs scripts/sync-expansion-docs/sync.js. Two pages (FilesPage
 * and LoadoutsPage) open the template picker and previously each refetched
 * the full list on every modal open. With this cache:
 *   - Concurrent callers share the same in-flight promise.
 *   - Repeat opens within TTL_MS hit memory.
 *   - A failure clears the cache so the next caller retries.
 *
 * Audit N16 (2026-05-19).
 */
const TTL_MS = 5 * 60 * 1000;

let _promise = null;
let _timestamp = 0;

export function getTemplates() {
  const now = Date.now();
  if (_promise && (now - _timestamp) < TTL_MS) {
    return _promise;
  }
  _timestamp = now;
  _promise = API.get('/api/expansion-docs/templates').catch(err => {
    _promise = null;
    throw err;
  });
  return _promise;
}

export function invalidateTemplatesCache() {
  _promise = null;
  _timestamp = 0;
}
