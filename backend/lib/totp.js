/**
 * Minimal TOTP authenticator using Node's built-in crypto.
 * Drop-in replacement for otplib's authenticator — no external dependencies.
 * Implements RFC 4226 (HOTP) and RFC 6238 (TOTP).
 */
const crypto = require('crypto');

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let result = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_CHARS[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

function base32Decode(str) {
  str = str.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of str) {
    const idx = BASE32_CHARS.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1000000).padStart(6, '0');
}

const authenticator = {
  /** Generate a random base32-encoded secret. */
  generateSecret(length = 20) {
    return base32Encode(crypto.randomBytes(length));
  },

  /** Verify a TOTP code against a secret (allows ±1 time step per RFC 6238 §5.2). */
  check(token, secret) {
    const now = Math.floor(Date.now() / 1000 / 30);
    // ±1 window = standard tolerance for clock drift (prev, current, next 30s period)
    for (let i = -1; i <= 1; i++) {
      if (hotp(secret, now + i) === String(token).padStart(6, '0')) {
        return true;
      }
    }
    return false;
  },

  /** Generate an otpauth:// URI for QR code scanning. */
  keyuri(user, issuer, secret) {
    const label = encodeURIComponent(issuer) + ':' + encodeURIComponent(user);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  },
};

module.exports = { authenticator };
