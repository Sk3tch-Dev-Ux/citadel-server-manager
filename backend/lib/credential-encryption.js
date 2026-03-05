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

/**
 * Cached derived key (lazy-initialized on first call).
 * @type {Buffer|null}
 */
let _derivedKey = null;

/**
 * Derive (or return cached) the encryption key from JWT_SECRET.
 * @returns {Buffer} 32-byte key
 */
function _getKey() {
  if (_derivedKey) return _derivedKey;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set — cannot derive encryption key');
  }

  _derivedKey = crypto.pbkdf2Sync(
    jwtSecret,
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
};
