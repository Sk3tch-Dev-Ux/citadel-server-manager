'use strict';

const { isAllowedDownloadUrl, installerFilename } = require('../lib/agent-updater');

describe('isAllowedDownloadUrl', () => {
  test('allows official release hosts over https', () => {
    expect(isAllowedDownloadUrl('https://citadels.cc/downloads/CitadelSetup-2.12.0.exe')).toBe(true);
    expect(isAllowedDownloadUrl('https://cdn.citadels.cc/x.exe')).toBe(true);
    expect(isAllowedDownloadUrl('https://github.com/Sk3tch-Dev/DayzServerController/releases/x.exe')).toBe(true);
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/x.exe')).toBe(true);
  });

  test('rejects non-https and untrusted hosts (SSRF guard)', () => {
    expect(isAllowedDownloadUrl('http://citadels.cc/x.exe')).toBe(false);   // not https
    expect(isAllowedDownloadUrl('https://evil.com/x.exe')).toBe(false);
    expect(isAllowedDownloadUrl('https://citadels.cc.evil.com/x.exe')).toBe(false);
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
