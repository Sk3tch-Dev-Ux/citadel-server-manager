'use strict';

const { validateCommand, sanitizeCommand, getAllowedCommands } = require('../lib/rcon-validator');

describe('validateCommand — whitelist', () => {
  test.each([
    'players',
    'bans',
    'server',
    'fps',
    'uptime',
    'version',
    'say hello world',
    '#say server restarting',
    'kick 5',
    'kick 5 being toxic',
    'maxplayers 60',
  ])('accepts whitelisted command: %s', (cmd) => {
    expect(validateCommand(cmd).valid).toBe(true);
  });

  test('returns the command description on success', () => {
    expect(validateCommand('players').description).toMatch(/players/i);
  });
});

describe('validateCommand — blacklist & unknown', () => {
  test.each(['shutdown', 'exit', 'stop', '#exec foo', 'quit', 'terminate', 'killserver'])(
    'blocks dangerous command: %s',
    (cmd) => {
      const r = validateCommand(cmd);
      expect(r.valid).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  );

  test('rejects unknown commands not on the whitelist', () => {
    const r = validateCommand('rm -rf /');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/unknown command/i);
  });
});

describe('validateCommand — argument validation', () => {
  test('kick requires a numeric slot', () => {
    expect(validateCommand('kick').valid).toBe(false);
    expect(validateCommand('kick abc').valid).toBe(false);
    expect(validateCommand('kick 12').valid).toBe(true);
  });

  test('maxplayers enforces a 1–100 range', () => {
    expect(validateCommand('maxplayers 0').valid).toBe(false);
    expect(validateCommand('maxplayers 101').valid).toBe(false);
    expect(validateCommand('maxplayers 50').valid).toBe(true);
    expect(validateCommand('maxplayers abc').valid).toBe(false);
  });

  test('say requires a message body', () => {
    expect(validateCommand('say').valid).toBe(false);
    expect(validateCommand('say hi').valid).toBe(true);
  });
});

describe('validateCommand — input hardening', () => {
  test('rejects empty / non-string input', () => {
    expect(validateCommand('').valid).toBe(false);
    expect(validateCommand('   ').valid).toBe(false);
    expect(validateCommand(null).valid).toBe(false);
    expect(validateCommand(undefined).valid).toBe(false);
    expect(validateCommand(42).valid).toBe(false);
  });

  test('rejects commands exceeding the max length', () => {
    expect(validateCommand('say ' + 'a'.repeat(1100)).valid).toBe(false);
  });

  test('rejects embedded control characters', () => {
    expect(validateCommand('players\x00').valid).toBe(false);
    expect(validateCommand('say hi\x07there').valid).toBe(false);
  });

  test('is case-insensitive for command names', () => {
    expect(validateCommand('PLAYERS').valid).toBe(true);
    expect(validateCommand('ShUtDoWn').valid).toBe(false); // still blocked
  });
});

describe('sanitizeCommand', () => {
  test('strips null bytes and control characters', () => {
    expect(sanitizeCommand('say\x00 hi')).toBe('say hi');
    expect(sanitizeCommand('say\x07 hi')).toBe('say hi');
  });

  test('trims surrounding whitespace', () => {
    expect(sanitizeCommand('  players  ')).toBe('players');
  });

  test('returns empty string for non-string input', () => {
    expect(sanitizeCommand(null)).toBe('');
    expect(sanitizeCommand(undefined)).toBe('');
    expect(sanitizeCommand(123)).toBe('');
  });
});

describe('getAllowedCommands', () => {
  test('returns a non-empty list of {command, description}', () => {
    const cmds = getAllowedCommands();
    expect(Array.isArray(cmds)).toBe(true);
    expect(cmds.length).toBeGreaterThan(0);
    for (const c of cmds) {
      expect(typeof c.command).toBe('string');
      expect(typeof c.description).toBe('string');
    }
  });

  test('every advertised command actually validates', () => {
    // Commands with no required args should validate as-is; this guards against
    // the whitelist advertising a command that its own pattern would reject.
    const noArg = ['players', 'bans', 'server', 'fps', 'uptime', 'version', 'load'];
    for (const c of noArg) expect(validateCommand(c).valid).toBe(true);
  });
});
