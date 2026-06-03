'use strict';

/**
 * Redaction helpers for plaintext DayZ / BattlEye config files served through
 * the generic file editor (routes/files.routes.js).
 *
 * DayZ stores secrets in plaintext .cfg files:
 *   - BattlEye:  BEServer*.cfg  → `RConPassword <pw>`
 *   - serverDZ.cfg               → `password = "<pw>"`, `passwordAdmin = "<pw>"`
 *
 * The servers API deliberately strips rconPassword from JSON responses, but a
 * non-admin operator who holds the (commonly-delegated) `files.edit` permission
 * could otherwise read those passwords straight out of the .cfg. We mask the
 * secret VALUES on read so the redaction can't be trivially bypassed.
 *
 * To keep the config editor able to WRITE these files without clobbering the
 * real password with the mask, the write path calls restoreRedactedSecrets():
 * any secret line whose value is still exactly the mask is rewritten with the
 * value currently on disk, so a read→edit-unrelated-line→save round-trip
 * preserves the original password.
 */

// Placeholder shown in place of a real secret value.
const REDACTION_MASK = '********';

// Secret keys recognised in DayZ/BattlEye config files. Matched case-insensitively.
// BattlEye uses `Key value` (space-separated); serverDZ.cfg uses `key = "value";`.
const SECRET_KEYS = ['RConPassword', 'password', 'passwordAdmin'];

/** Only these extensions are treated as secret-bearing config files. */
function isConfigFile(filePathOrName) {
  const lower = String(filePathOrName || '').toLowerCase();
  return lower.endsWith('.cfg') || lower.endsWith('.config');
}

// Build per-key matchers. Two shapes:
//   1. BattlEye:    ^<indent><Key><ws><value>$           (no '=')
//   2. serverDZ:    ^<indent><key><ws>=<ws>"value";       or  = value
// Capture group 1 = everything up to and including the assignment punctuation,
// group 2 = the value to be replaced (we preserve any trailing quote/; via g3).
function matchersFor(key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    // serverDZ.cfg style:  key = "value" ;   /   key = value ;
    {
      re: new RegExp(`^(\\s*${k}\\s*=\\s*")([^"]*)("\\s*;?\\s*)$`, 'i'),
      rebuild: (m, repl) => `${m[1]}${repl}${m[3]}`,
      read: (m) => m[2],
    },
    {
      re: new RegExp(`^(\\s*${k}\\s*=\\s*)([^";\\s][^;]*?)(\\s*;?\\s*)$`, 'i'),
      rebuild: (m, repl) => `${m[1]}${repl}${m[3]}`,
      read: (m) => m[2],
    },
    // BattlEye style:  RConPassword value   (space separated, no '=')
    {
      re: new RegExp(`^(\\s*${k}\\s+)(\\S.*?)(\\s*)$`, 'i'),
      rebuild: (m, repl) => `${m[1]}${repl}${m[3]}`,
      read: (m) => m[2],
    },
  ];
}

function processLine(line, transform) {
  for (const key of SECRET_KEYS) {
    for (const matcher of matchersFor(key)) {
      const m = line.match(matcher.re);
      if (m) {
        const current = matcher.read(m);
        const repl = transform(current);
        if (repl === null) return line; // leave untouched
        return matcher.rebuild(m, repl);
      }
    }
  }
  return line;
}

/**
 * Replace the value of any recognised secret key with REDACTION_MASK.
 * Empty values are left as-is (nothing to hide). Returns the masked content.
 */
function redactConfigSecrets(content) {
  if (typeof content !== 'string' || !content) return content;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  return content
    .split(/\r?\n/)
    .map((line) => processLine(line, (current) => (current && current.length ? REDACTION_MASK : null)))
    .join(eol);
}

/**
 * For a write payload: any secret line whose value is still exactly the
 * REDACTION_MASK is rewritten with the corresponding value from oldContent
 * (the on-disk file), so saving a file that was read in masked form does not
 * overwrite the real password. A secret line with a genuinely new (non-mask)
 * value is left as the operator typed it, so passwords can still be CHANGED.
 */
function restoreRedactedSecrets(newContent, oldContent) {
  if (typeof newContent !== 'string') return newContent;
  const oldSecrets = collectSecrets(typeof oldContent === 'string' ? oldContent : '');
  const eol = newContent.includes('\r\n') ? '\r\n' : '\n';
  return newContent
    .split(/\r?\n/)
    .map((line) => processLine(line, (current) => {
      if (current !== REDACTION_MASK) return null; // not masked → keep operator's value
      const key = secretKeyOfLine(line);
      const restored = key && oldSecrets[key.toLowerCase()];
      return restored !== undefined ? restored : null;
    }))
    .join(eol);
}

/** Which secret key (if any) a line declares — used to look up the old value. */
function secretKeyOfLine(line) {
  for (const key of SECRET_KEYS) {
    for (const matcher of matchersFor(key)) {
      if (matcher.re.test(line)) return key;
    }
  }
  return null;
}

/** Map of lowercased-secret-key → on-disk value, from a config file's content. */
function collectSecrets(content) {
  const out = {};
  for (const line of String(content).split(/\r?\n/)) {
    for (const key of SECRET_KEYS) {
      for (const matcher of matchersFor(key)) {
        const m = line.match(matcher.re);
        if (m) { out[key.toLowerCase()] = matcher.read(m); break; }
      }
    }
  }
  return out;
}

module.exports = {
  REDACTION_MASK,
  SECRET_KEYS,
  isConfigFile,
  redactConfigSecrets,
  restoreRedactedSecrets,
};
