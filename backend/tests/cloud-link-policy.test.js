/**
 * WS3 — per-server cloud operator policy (privacy + safety).
 *
 * Locks in the two operator-controlled switches on a cloud link:
 *   forwardPlayerPII (default true)  — IP + GUID forwarding to the cloud
 *   allowRemoteWipe  (default false) — cloud-issued world wipes on this server
 * and that they survive a re-pair (a privacy opt-out must not silently revert).
 */
// setLink encrypts the api key at rest; give credential-encryption a
// deterministic key so this file passes whether run alone or in the full suite
// (must be set before the storage module — and its crypto dep — load).
process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || 'a'.repeat(64);
const storage = require('../lib/cloud-bridge/storage');

const CLOUD_A = '11111111-1111-1111-1111-111111111111';
const CLOUD_B = '22222222-2222-2222-2222-222222222222';
const API_KEY = 'k'.repeat(40);

describe('cloud link operator policy', () => {
  const SID = 'policy-test-server';
  afterEach(() => storage.removeLink(SID));

  test('unlinked server resolves to safe defaults (PII on, wipe off)', () => {
    expect(storage.getPolicy('no-link-' + SID)).toEqual({ forwardPlayerPII: true, allowRemoteWipe: false });
  });

  test('setPolicy on an unlinked server is a no-op returning false', () => {
    expect(storage.setPolicy('no-link-' + SID, { allowRemoteWipe: true })).toBe(false);
  });

  test('a fresh link starts at defaults', () => {
    storage.setLink(SID, { cloudServerId: CLOUD_A, apiKey: API_KEY, name: 'T' });
    expect(storage.getPolicy(SID)).toEqual({ forwardPlayerPII: true, allowRemoteWipe: false });
  });

  test('partial PATCH only touches the field it sets', () => {
    storage.setLink(SID, { cloudServerId: CLOUD_A, apiKey: API_KEY });
    expect(storage.setPolicy(SID, { allowRemoteWipe: true })).toBe(true);
    expect(storage.getPolicy(SID)).toEqual({ forwardPlayerPII: true, allowRemoteWipe: true });
    storage.setPolicy(SID, { forwardPlayerPII: false });
    expect(storage.getPolicy(SID)).toEqual({ forwardPlayerPII: false, allowRemoteWipe: true });
  });

  test('getPublic exposes policy for the UI but never the api key', () => {
    storage.setLink(SID, { cloudServerId: CLOUD_A, apiKey: API_KEY });
    storage.setPolicy(SID, { forwardPlayerPII: false });
    const pub = storage.getPublic(SID);
    expect(pub.policy).toEqual({ forwardPlayerPII: false, allowRemoteWipe: false });
    expect(pub).not.toHaveProperty('apiKey');
  });

  test('policy survives a re-pair (even to a different cloud id)', () => {
    storage.setLink(SID, { cloudServerId: CLOUD_A, apiKey: API_KEY });
    storage.setPolicy(SID, { forwardPlayerPII: false, allowRemoteWipe: true });
    storage.setLink(SID, { cloudServerId: CLOUD_B, apiKey: API_KEY }); // operator re-pairs
    expect(storage.getPolicy(SID)).toEqual({ forwardPlayerPII: false, allowRemoteWipe: true });
  });
});
