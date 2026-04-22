/**
 * Stable device identifier tied to this Windows installation.
 *
 * Uses HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid, which:
 *  - Survives reboots and user logins
 *  - Regenerates on Windows reinstall (correct behavior — counts as new device)
 *  - Is not accessible to non-admin users (we run as a service, so fine)
 *
 * Falls back to a hostname-derived hash on non-Windows platforms or if the
 * registry read fails for any reason.
 */
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

let _cached = null;

function getMachineId() {
  if (_cached) return _cached;

  if (process.platform === 'win32') {
    try {
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { timeout: 5000, windowsHide: true, encoding: 'utf-8' }
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
      if (match) {
        _cached = match[1];
        return _cached;
      }
    } catch {
      // fall through to hostname fallback
    }
  }

  _cached = crypto
    .createHash('sha256')
    .update(`${os.hostname()}:${process.platform}`)
    .digest('hex')
    .slice(0, 32);
  return _cached;
}

module.exports = { getMachineId };
