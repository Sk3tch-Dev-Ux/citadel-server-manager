/**
 * License client — talks to the citadels.cc account API.
 *
 * This is a STUB for Phase 1 — Phase 2 will flesh it out with the real
 * activation flow, token caching, machine-ID binding, and offline grace.
 *
 * The shape here is deliberately locked in now so Phase 1 preload/IPC can
 * expose the `window.citadel.license` surface and the React frontend can
 * start building the sign-in screen against this contract.
 *
 * Planned endpoints on citadels.cc:
 *   POST /api/license/activate   { email, password, machineId }
 *       → 200 { token, expiresAt, subscription: { tier, status, renewsAt } }
 *       → 401 invalid credentials
 *       → 402 no active subscription
 *       → 409 device-limit exceeded (2 devices per account)
 *
 *   GET /api/license/verify       (Bearer token)
 *       → 200 { valid: true, subscription: {...} }
 *       → 401 token invalid/expired → prompt re-sign-in
 *       → 402 subscription lapsed → enter grace mode
 *
 *   DELETE /api/license/deactivate (Bearer token, to free a device slot)
 *       → 204
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');

// Defer real networking until Phase 2. For now, expose the contract as stubs.

const TOKEN_FILE = path.join(app?.getPath?.('userData') || os.tmpdir(), 'license.json');

function getMachineId() {
  // Use the Windows MachineGuid where possible. This is stable across reboots
  // and tied to the Windows installation (regenerates on reinstall, which is
  // the correct behavior for device-slot counting).
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
        timeout: 5000,
        windowsHide: true,
      }).toString();
      const match = out.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
      if (match) return match[1];
    }
  } catch {
    // Fall through to hostname-hash fallback below
  }
  // Fallback: hash of hostname + platform. Not ideal, but stable per machine.
  return crypto.createHash('sha256').update(`${os.hostname()}:${process.platform}`).digest('hex').slice(0, 32);
}

function readCachedToken() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const raw = fs.readFileSync(TOKEN_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCachedToken(data) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function clearCachedToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
    return true;
  } catch {
    return false;
  }
}

// ─── Stub implementations — Phase 2 fills these in ─────────────

async function activate(/* { email, password } */) {
  throw new Error('license.activate not implemented — Phase 2');
}

async function verify() {
  const cached = readCachedToken();
  if (!cached) return { valid: false, reason: 'no-token' };
  // Phase 2: call GET /api/license/verify with Bearer cached.token
  return { valid: false, reason: 'not-implemented' };
}

async function deactivate() {
  clearCachedToken();
  return { ok: true };
}

function getStatus() {
  const cached = readCachedToken();
  return {
    signedIn: Boolean(cached?.token),
    machineId: getMachineId(),
    tokenFile: TOKEN_FILE,
  };
}

module.exports = {
  activate,
  verify,
  deactivate,
  getStatus,
  getMachineId,
  _internal: { readCachedToken, writeCachedToken, clearCachedToken, TOKEN_FILE },
};
