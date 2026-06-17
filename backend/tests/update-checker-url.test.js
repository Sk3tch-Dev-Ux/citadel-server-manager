'use strict';

// Regression for updater-relative-url-and-zip-mismatch: the cloud's
// /downloads/latest returns a RELATIVE downloadUrl ('/downloads/installer').
// update-checker must resolve it to an absolute https URL against the API base
// so agent-updater's `new URL(url)` doesn't throw and the dashboard banner
// anchor doesn't resolve to the dashboard origin.

const { resolveDownloadUrl } = require('../lib/update-checker');

describe('update-checker resolveDownloadUrl', () => {
  test('resolves the cloud relative path against the API base', () => {
    expect(resolveDownloadUrl('/downloads/installer'))
      .toBe('https://api.citadels.cc/downloads/installer');
  });

  test('passes an absolute https URL through unchanged', () => {
    const abs = 'https://github.com/Sk3tch-Dev-Ux/citadel-server-manager/releases/download/v2.21.9/CitadelSetup-2.21.9.exe';
    expect(resolveDownloadUrl(abs)).toBe(abs);
  });

  test('falls back to the default installer path on empty input', () => {
    expect(resolveDownloadUrl(null)).toBe('https://api.citadels.cc/downloads/installer');
    expect(resolveDownloadUrl('')).toBe('https://api.citadels.cc/downloads/installer');
  });

  test('honors CITADEL_LICENSE_API override for the base', () => {
    const prev = process.env.CITADEL_LICENSE_API;
    process.env.CITADEL_LICENSE_API = 'https://dev.example.test';
    try {
      expect(resolveDownloadUrl('/downloads/installer'))
        .toBe('https://dev.example.test/downloads/installer');
    } finally {
      if (prev === undefined) delete process.env.CITADEL_LICENSE_API;
      else process.env.CITADEL_LICENSE_API = prev;
    }
  });
});
