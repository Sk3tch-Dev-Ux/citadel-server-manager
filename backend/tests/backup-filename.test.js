'use strict';

const { sanitizeBackupFilename } = require('../lib/backup-engine');

describe('sanitizeBackupFilename (path-traversal guard)', () => {
  test('accepts legitimate backup names', () => {
    expect(sanitizeBackupFilename('backup-2026-05-29T12-00-00.zip')).toBe('backup-2026-05-29T12-00-00.zip');
    expect(sanitizeBackupFilename('pre-restore-2026-05-29T12-00-00.zip')).toBe('pre-restore-2026-05-29T12-00-00.zip');
  });

  test('rejects path separators', () => {
    expect(sanitizeBackupFilename('../../etc/passwd')).toBeNull();
    expect(sanitizeBackupFilename('..\\..\\windows\\system32\\config.zip')).toBeNull();
    expect(sanitizeBackupFilename('sub/dir/backup.zip')).toBeNull();
  });

  test('rejects parent-directory segments even without a separator survivor', () => {
    expect(sanitizeBackupFilename('..zip')).toBeNull();
    expect(sanitizeBackupFilename('foo..bar.zip')).toBeNull();
  });

  test('rejects non-zip extensions', () => {
    expect(sanitizeBackupFilename('backup.txt')).toBeNull();
    expect(sanitizeBackupFilename('backup.zip.exe')).toBeNull();
    expect(sanitizeBackupFilename('backup')).toBeNull();
  });

  test('rejects empty / non-string input', () => {
    expect(sanitizeBackupFilename('')).toBeNull();
    expect(sanitizeBackupFilename(null)).toBeNull();
    expect(sanitizeBackupFilename(undefined)).toBeNull();
    expect(sanitizeBackupFilename(42)).toBeNull();
  });
});
