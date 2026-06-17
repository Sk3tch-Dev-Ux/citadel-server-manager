'use strict';

const { isAllowedDownloadUrl, installerFilename } = require('../lib/agent-updater');

describe('isAllowedDownloadUrl', () => {
  test('allows this repo’s release assets / cloud downloads over https', () => {
    expect(isAllowedDownloadUrl('https://github.com/Sk3tch-Dev-Ux/citadel-server-manager/releases/download/v2.21.6/CitadelSetup-2.21.6.exe')).toBe(true);
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset/CitadelSetup.exe')).toBe(true);
    expect(isAllowedDownloadUrl('https://citadels.cc/downloads/CitadelSetup-2.21.6.exe')).toBe(true);
  });

  test('rejects other github repos and non-release paths (tightened allowlist)', () => {
    // Right host, wrong repo — the previous "any github.com" rule allowed this.
    expect(isAllowedDownloadUrl('https://github.com/attacker/evil/releases/download/v1/CitadelSetup.exe')).toBe(false);
    // Our repo but not a release-download asset.
    expect(isAllowedDownloadUrl('https://github.com/Sk3tch-Dev-Ux/citadel-server-manager/blob/main/x.exe')).toBe(false);
    // Cloud host but not the downloads path.
    expect(isAllowedDownloadUrl('https://citadels.cc/x.exe')).toBe(false);
    // Non-.exe asset.
    expect(isAllowedDownloadUrl('https://github.com/Sk3tch-Dev-Ux/citadel-server-manager/releases/download/v1/notes.txt')).toBe(false);
  });

  test('accepts the cloud’s extension-less installer path (the real /downloads/latest shape)', () => {
    // GET /downloads/latest returns downloadUrl '/downloads/installer'; after
    // update-checker resolves it against api.citadels.cc this is what reaches
    // isAllowedDownloadUrl. It must be allowed (host-scoped to /downloads/),
    // even though it has no .exe extension — the MZ-header/size checks in
    // downloadInstaller still validate the bytes. Regression for
    // updater-relative-url-and-zip-mismatch.
    expect(isAllowedDownloadUrl('https://api.citadels.cc/downloads/installer')).toBe(true);
    // Still scoped to /downloads/ — an arbitrary extension-less cloud path is rejected.
    expect(isAllowedDownloadUrl('https://api.citadels.cc/secret')).toBe(false);
  });

  test('rejects non-https and untrusted hosts (SSRF guard)', () => {
    expect(isAllowedDownloadUrl('http://citadels.cc/downloads/x.exe')).toBe(false); // not https
    expect(isAllowedDownloadUrl('https://evil.com/x.exe')).toBe(false);
    expect(isAllowedDownloadUrl('https://citadels.cc.evil.com/downloads/x.exe')).toBe(false);
    expect(isAllowedDownloadUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedDownloadUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedDownloadUrl('not a url')).toBe(false);
    expect(isAllowedDownloadUrl(null)).toBe(false);
  });
});

describe('installerFilename', () => {
  test('builds a safe filename from a version', () => {
    expect(installerFilename('2.12.0')).toBe('CitadelSetup-2.12.0.exe');
  });
  test('strips path/special characters (no traversal)', () => {
    expect(installerFilename('../../evil')).toBe('CitadelSetup-....evil.exe');
    expect(installerFilename('2.0/../x')).toBe('CitadelSetup-2.0..x.exe');
    expect(installerFilename('')).toBe('CitadelSetup-latest.exe');
    expect(installerFilename(null)).toBe('CitadelSetup-latest.exe');
  });
});
