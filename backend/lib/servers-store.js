/**
 * Persistence wrapper for servers.json that encrypts the two true secrets it
 * holds — `rconPassword` and `inHouseApiKey` — at rest, using the same
 * AES-256-GCM `credential-encryption` scheme (ENC: prefix) already used for the
 * Steam password and the cloud-bridge API key (see lib/cloud-bridge/storage.js).
 *
 * Invariant: the in-memory `ctx.servers` ALWAYS holds plaintext. loadServers()
 * decrypts on read; saveServers() encrypts a CLONE on write and never mutates
 * the live objects. Every existing read site (RCONClient, player-data, the
 * sidecar provider) and runtime-generation site (rcon-config, sidecar-manager)
 * therefore keeps working unchanged — they only ever see plaintext.
 *
 * Migration is automatic and lazy-then-eager: a legacy plaintext value (no
 * ENC: prefix) is passed through on load by resolveCredential(); loadServers()
 * reports `migrated: true` so the boot path can persist once to encrypt it at
 * rest. Encryption is idempotent (an already-ENC: value is left as-is), so
 * re-saving never double-encrypts.
 */
const { loadJSON, saveJSON } = require('./data-store');
const { encryptForEnv, resolveCredential } = require('./credential-encryption');
const logger = require('./logger');

const FILE = 'servers.json';
// The fields in a server record that are true secrets and must not sit in
// plaintext on disk. inHouseApiUrl / cftools* IDs are identifiers, not secrets,
// and are intentionally NOT encrypted (they're only redacted from API output).
const SECRET_FIELDS = ['rconPassword', 'inHouseApiKey'];

/** Encrypt one field value for storage. Idempotent + empty/undefined-safe. */
function _encField(value) {
  if (typeof value !== 'string' || value === '') return value;
  if (value.startsWith('ENC:')) return value; // already encrypted — don't double-wrap
  return encryptForEnv(value);
}

/** Decrypt one stored field value. Legacy plaintext passes through unchanged. */
function _decField(value, field) {
  if (typeof value !== 'string' || value === '' || !value.startsWith('ENC:')) {
    return value; // empty, non-string, or legacy plaintext
  }
  try {
    return resolveCredential(value);
  } catch (err) {
    logger.error(
      { err: err.message, field },
      'servers-store: failed to decrypt a stored credential — CREDENTIAL_ENCRYPTION_KEY ' +
      'likely changed. Clearing the field; re-enter it in Settings → Servers.'
    );
    return '';
  }
}

/**
 * Decrypt the secret fields of every server in-place and return the array.
 * Accepts on-disk-shaped records (encrypted or legacy plaintext) and leaves
 * them plaintext in memory. Used by loadServers() and by the backup-restore
 * path (which receives on-disk-shaped data straight from a backup file).
 */
function decryptInPlace(servers) {
  if (!Array.isArray(servers)) return servers;
  for (const s of servers) {
    if (!s || typeof s !== 'object') continue;
    for (const f of SECRET_FIELDS) s[f] = _decField(s[f], f);
  }
  return servers;
}

/**
 * Load servers.json with the secret fields decrypted in place.
 *
 * @param {string} dataDir
 * @returns {{ servers: object[], migrated: boolean }} `migrated` is true when
 *   any value was found as legacy plaintext, so the caller can persist once to
 *   encrypt it at rest.
 */
function loadServers(dataDir) {
  const raw = loadJSON(dataDir, FILE, []);
  if (!Array.isArray(raw)) return { servers: raw, migrated: false };
  const migrated = raw.some(
    (s) =>
      s && typeof s === 'object' &&
      SECRET_FIELDS.some(
        (f) => typeof s[f] === 'string' && s[f] !== '' && !s[f].startsWith('ENC:')
      )
  );
  decryptInPlace(raw);
  return { servers: raw, migrated };
}

/**
 * Persist servers.json with the secret fields encrypted at rest. Encrypts a
 * shallow clone of each record so the live in-memory objects stay plaintext.
 * Mirrors saveJSON's signature + return (a Promise) so it is a drop-in swap.
 *
 * @param {string} dataDir
 * @param {object[]} servers - the in-memory (plaintext) server array
 */
function saveServers(dataDir, servers) {
  const out = Array.isArray(servers)
    ? servers.map((s) => {
        if (!s || typeof s !== 'object') return s;
        const clone = { ...s };
        for (const f of SECRET_FIELDS) clone[f] = _encField(clone[f]);
        return clone;
      })
    : servers;
  return saveJSON(dataDir, FILE, out);
}

module.exports = { loadServers, saveServers, decryptInPlace, SECRET_FIELDS };
