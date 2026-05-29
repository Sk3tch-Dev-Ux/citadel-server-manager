/**
 * AES-256-GCM encryption for credentials at rest.
 *
 * Derives a 256-bit encryption key from JWT_SECRET using PBKDF2 with a fixed,
 * application-specific salt. Each encrypt() call generates a random IV so
 * identical plaintexts produce different ciphertexts.
 *
 * Wire format (single base64 string):
 *   <12-byte IV> <16-byte auth tag> <ciphertext>
 *
 * Usage:
 *   const { encrypt, decrypt } = require('./credential-encryption');
 *   const encrypted = encrypt('my-secret');      // base64 string
 *   const plain     = decrypt(encrypted);         // 'my-secret'
 *
 * Backwards compatibility:
 *   Values stored in .env are prefixed with "ENC:" when encrypted.
 *   If the prefix is absent, the value is treated as legacy plaintext.
 */
const crypto = require('crypto');

// Fixed, application-specific salt (not secret — just ensures domain separation)
const FIXED_SALT = Buffer.from('CitadelDayzController-v1-credential-salt', 'utf-8');
const KEY_LENGTH = 32;        // 256 bits for AES-256
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha512';
const IV_LENGTH = 12;         // 96 bits — recommended for GCM
const AUTH_TAG_LENGTH = 16;   // 128 bits
const ALGORITHM = 'aes-256-gcm';

// A properly generated key (`openssl rand -hex 32`) is 64 hex chars. Anything
// shorter than this in production almost certainly means a typo or a truncated
// value, which silently weakens the derived AES key.
const MIN_KEY_LENGTH = 32;
const RECOMMENDED_KEY_RE = /^[0-9a-fA-F]{64}$/;

/**
 * Validate the configured CREDENTIAL_ENCRYPTION_KEY at startup.
 *
 * Throws in production if the key is missing or dangerously short, and warns
 * (non-fatally) if it does not match the recommended 64-hex-char format. Call
 * this once during boot so misconfiguration fails loudly and immediately rather
 * than lazily on the first credential operation.
 *
 * @returns {{ ok: boolean, warning?: string }}
 */
function validateKeyConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!key) {
    if (isProd) {
      throw new Error(
        'CREDENTIAL_ENCRYPTION_KEY is required in production. ' +
        'Generate one with: openssl rand -hex 32 — then add to .env.'
      );
    }
    return { ok: true, warning: 'CREDENTIAL_ENCRYPTION_KEY not set (dev fallback to JWT_SECRET)' };
  }

  if (key.length < MIN_KEY_LENGTH) {
    const msg =
      `CREDENTIAL_ENCRYPTION_KEY is only ${key.length} characters — too short to be ` +
      `secure. Generate a proper key with: openssl rand -hex 32 (yields 64 chars).`;
    if (isProd) throw new Error(msg);
    return { ok: false, warning: msg };
  }

  if (!RECOMMENDED_KEY_RE.test(key)) {
    return {
      ok: true,
      warning:
        'CREDENTIAL_ENCRYPTION_KEY does not match the recommended 64-hex-char format ' +
        '(openssl rand -hex 32). It will still be used as a passphrase, but a full ' +
        '256-bit hex key is strongly preferred.',
    };
  }

  return { ok: true };
}

/**
 * Cached derived key (lazy-initialized on first call).
 * @type {Buffer|null}
 */
let _derivedKey = null;

/**
 * Derive (or return cached) the encryption key.
 *
 * In PRODUCTION: requires CREDENTIAL_ENCRYPTION_KEY to be set. Refuses to
 * derive from JWT_SECRET because that would mean a single leaked secret
 * (the JWT) also decrypts every stored credential (RCON passwords, Steam
 * logins, etc.). Defense in depth = two independent secrets.
 *
 * In DEVELOPMENT: falls back to JWT_SECRET with a loud warning so a fresh
 * dev clone just works.
 *
 * @returns {Buffer} 32-byte key
 */
function _getKey() {
  if (_derivedKey) return _derivedKey;

  const isProd = process.env.NODE_ENV === 'production';
  let keySource = process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!keySource) {
    if (isProd) {
      throw new Error(
        'CREDENTIAL_ENCRYPTION_KEY is required in production. ' +
        'Generate one with: openssl rand -hex 32 — then add to .env. ' +
        'Refusing to fall back to JWT_SECRET (would collapse two secrets into one).'
      );
    }
    // Dev-only fallback. Warn loudly so nobody ships a prod build like this.
    // eslint-disable-next-line no-console
    console.warn(
      '[credential-encryption] CREDENTIAL_ENCRYPTION_KEY not set — ' +
      'falling back to JWT_SECRET for dev convenience. DO NOT DEPLOY THIS WAY.'
    );
    keySource = process.env.JWT_SECRET;
  }

  if (!keySource) {
    throw new Error('Neither CREDENTIAL_ENCRYPTION_KEY nor JWT_SECRET is set — cannot derive encryption key');
  }

  _derivedKey = crypto.pbkdf2Sync(
    keySource,
    FIXED_SALT,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  );

  return _derivedKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param {string} plaintext - The value to encrypt
 * @returns {string} Base64-encoded string containing IV + auth tag + ciphertext
 */
function encrypt(plaintext) {
  if (!plaintext) return '';

  const key = _getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: IV (12) + authTag (16) + ciphertext (variable)
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 *
 * @param {string} encoded - Base64 string produced by encrypt()
 * @returns {string} The original plaintext
 */
function decrypt(encoded) {
  if (!encoded) return '';

  const key = _getKey();
  const packed = Buffer.from(encoded, 'base64');

  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Encrypted credential data is too short — possibly corrupt');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}

/**
 * Resolve a credential value that may or may not be encrypted.
 * If the value starts with "ENC:", strip the prefix and decrypt.
 * Otherwise, return as-is (legacy plaintext).
 *
 * @param {string} value - Raw value from .env (may have ENC: prefix)
 * @returns {string} Plaintext credential
 */
function resolveCredential(value) {
  if (!value) return '';
  if (value.startsWith('ENC:')) {
    return decrypt(value.slice(4));
  }
  return value;
}

/**
 * Format an encrypted value for storage in .env with the ENC: prefix.
 *
 * @param {string} plaintext - The plaintext credential to encrypt
 * @returns {string} "ENC:<base64>" string ready for .env
 */
function encryptForEnv(plaintext) {
  if (!plaintext) return '';
  return `ENC:${encrypt(plaintext)}`;
}

/**
 * Clear the cached derived key (useful if JWT_SECRET changes at runtime).
 */
function clearKeyCache() {
  _derivedKey = null;
}

module.exports = {
  encrypt,
  decrypt,
  resolveCredential,
  encryptForEnv,
  clearKeyCache,
  validateKeyConfig,
};
