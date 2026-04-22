/**
 * RSA public key used to verify Citadel license tokens issued by citadels.cc.
 *
 * This is SAFE TO COMMIT. The matching private key lives only on the
 * citadels.cc server (in LICENSE_PRIVATE_KEY_B64 env var) and never leaves it.
 *
 * Fingerprint (sha256 of DER-encoded public key):
 *   cce5e3c7c11886be48370f23449a7c83182880df5db7bfcc58fcf0ab7d382581
 *
 * If the signing key is ever rotated, this file must be updated AND all
 * previously-issued tokens become invalid.
 */
module.exports.CITADEL_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx6BWwP4/BOkeynKv7oE+
yk1K6ECY+RAIk7mPfVsS4fws5USj+IfyjcfE7+4atg7z+r9I6ZU7w9gGBu/JpbPk
LC6SEFGIVkQV+MAsxWxSo+drMqeJ4/EKiCVL7VRjR4UKkgm6EAc/nUq9mwAlw6UB
zTXvHd3UFP4zDulpKpdxvsRLqBlRwAH3bAfJ1dBL/xHd+tIfqK+QcpUXSVq+kE8E
sCjQ4Xtqd2rkMz3zHMTXeazErLzFZoxzobil22not4lo06Yo0DhNHQtdj7jBEYoj
Lok0k0wL/LZUdSCK60X+DdVtYYHvdEyye/xi+YOznZqBGKf7kts2WjNpT+TYftYT
swIDAQAB
-----END PUBLIC KEY-----
`;
