'use strict';

// Regression for cfg-read-exposes-rcon-password: .cfg reads must mask the
// BattlEye RConPassword and serverDZ password/passwordAdmin, and a masked
// value saved back unchanged must NOT clobber the real on-disk secret.

const {
  REDACTION_MASK,
  redactConfigSecrets,
  restoreRedactedSecrets,
  isConfigFile,
} = require('../lib/config-secrets');

describe('redactConfigSecrets', () => {
  test('masks BattlEye RConPassword (space-separated)', () => {
    const out = redactConfigSecrets('RConPassword superSecret123\nRConPort 2306\n');
    expect(out).toContain(`RConPassword ${REDACTION_MASK}`);
    expect(out).not.toContain('superSecret123');
    expect(out).toContain('RConPort 2306'); // non-secret line untouched
  });

  test('masks serverDZ.cfg password and passwordAdmin (quoted)', () => {
    const cfg = 'hostname = "My Server";\npassword = "joinpw";\npasswordAdmin = "adminpw";\nmaxPlayers = 60;\n';
    const out = redactConfigSecrets(cfg);
    expect(out).toContain(`password = "${REDACTION_MASK}";`);
    expect(out).toContain(`passwordAdmin = "${REDACTION_MASK}";`);
    expect(out).not.toContain('joinpw');
    expect(out).not.toContain('adminpw');
    expect(out).toContain('hostname = "My Server";');
    expect(out).toContain('maxPlayers = 60;');
  });

  test('leaves an empty secret value alone (nothing to hide)', () => {
    expect(redactConfigSecrets('password = "";\n')).toContain('password = "";');
  });
});

describe('restoreRedactedSecrets (write round-trip)', () => {
  test('a masked value saved back is restored from disk (no clobber)', () => {
    const onDisk = 'RConPassword realPw\nRConPort 2306\n';
    const edited = `RConPassword ${REDACTION_MASK}\nRConPort 2399\n`; // changed port, kept mask
    const result = restoreRedactedSecrets(edited, onDisk);
    expect(result).toContain('RConPassword realPw'); // secret restored
    expect(result).toContain('RConPort 2399');        // legit edit kept
  });

  test('a genuinely new (non-mask) secret value is kept — passwords can change', () => {
    const onDisk = 'RConPassword oldPw\n';
    const edited = 'RConPassword brandNewPw\n';
    expect(restoreRedactedSecrets(edited, onDisk)).toContain('RConPassword brandNewPw');
  });

  test('serverDZ quoted password mask is restored from disk', () => {
    const onDisk = 'password = "realJoin";\npasswordAdmin = "realAdmin";\n';
    const edited = `password = "${REDACTION_MASK}";\npasswordAdmin = "newAdmin";\n`;
    const result = restoreRedactedSecrets(edited, onDisk);
    expect(result).toContain('password = "realJoin";'); // masked → restored
    expect(result).toContain('passwordAdmin = "newAdmin";'); // changed → kept
  });
});

describe('isConfigFile', () => {
  test('recognises .cfg / .config, rejects others', () => {
    expect(isConfigFile('BEServer_x64.cfg')).toBe(true);
    expect(isConfigFile('serverDZ.cfg')).toBe(true);
    expect(isConfigFile('app.config')).toBe(true);
    expect(isConfigFile('notes.txt')).toBe(false);
    expect(isConfigFile('types.xml')).toBe(false);
  });
});
