'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ctx = require('../lib/context');
const updater = require('../lib/auto-updater');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-journal-'));
  // The journal dir derives from ctx.CONFIG.dataDir; point it at a temp dir so
  // tests never touch the real data directory.
  ctx.CONFIG = ctx.CONFIG || {};
  ctx.CONFIG.dataDir = dir;
});
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('auto-updater state journal (write-ahead log)', () => {
  test('journalStateTransition writes a recoverable entry', () => {
    const res = updater.journalStateTransition('srv-1', 'updating', 'game', { build: '123' });
    expect(res.success).toBe(true);
    expect(fs.existsSync(updater.getStateJournalPath('srv-1'))).toBe(true);

    const entry = updater.readStateJournal('srv-1');
    expect(entry).toMatchObject({
      serverId: 'srv-1',
      newState: 'updating',
      updateType: 'game',
      updateInfo: { build: '123' },
    });
    expect(typeof entry.timestamp).toBe('string');
  });

  test('a later transition overwrites the previous entry (latest state wins)', () => {
    updater.journalStateTransition('srv-2', 'detected', 'mod', { modId: '42' });
    updater.journalStateTransition('srv-2', 'starting', 'mod', { modId: '42' });
    expect(updater.readStateJournal('srv-2').newState).toBe('starting');
  });

  test('readStateJournal returns null when no journal exists', () => {
    expect(updater.readStateJournal('no-such-server')).toBeNull();
  });

  test('clearStateJournal removes the entry', () => {
    updater.journalStateTransition('srv-3', 'updating', 'game', {});
    expect(updater.readStateJournal('srv-3')).not.toBeNull();
    updater.clearStateJournal('srv-3');
    expect(updater.readStateJournal('srv-3')).toBeNull();
    expect(fs.existsSync(updater.getStateJournalPath('srv-3'))).toBe(false);
  });

  test('clearStateJournal is a no-op (no throw) when nothing is journaled', () => {
    expect(() => updater.clearStateJournal('ghost')).not.toThrow();
  });

  test('readStateJournal tolerates a corrupt journal file (returns null, no throw)', () => {
    // Write a valid entry first so the journal directory exists, then corrupt it.
    updater.journalStateTransition('srv-4', 'updating', 'game', {});
    fs.writeFileSync(updater.getStateJournalPath('srv-4'), '{ corrupt');
    expect(updater.readStateJournal('srv-4')).toBeNull();
  });

  test('no leftover .tmp file remains after a successful write', () => {
    updater.journalStateTransition('srv-5', 'verifying', 'game', {});
    const journalDir = path.join(dir, 'state-journals');
    expect(fs.readdirSync(journalDir).some((f) => f.endsWith('.tmp'))).toBe(false);
  });
});

describe('formatCountdownMessage', () => {
  test('formats minutes with correct pluralization', () => {
    expect(updater.formatCountdownMessage('in {{countdown}}', 120)).toBe('in 2 minutes');
    expect(updater.formatCountdownMessage('in {{countdown}}', 60)).toBe('in 1 minute');
  });

  test('formats seconds with correct pluralization', () => {
    expect(updater.formatCountdownMessage('in {{countdown}}', 30)).toBe('in 30 seconds');
    expect(updater.formatCountdownMessage('in {{countdown}}', 1)).toBe('in 1 second');
  });

  test('substitutes the mod name', () => {
    expect(updater.formatCountdownMessage('{{mod}} updating', 10, 'BuilderItems')).toBe('BuilderItems updating');
  });
});

describe('getNotificationConfig', () => {
  test('falls back to defaults when the server has no notifications block', () => {
    const cfg = updater.getNotificationConfig({}, 'game');
    expect(cfg).toMatchObject(updater.DEFAULT_NOTIFICATIONS.gameUpdate);
  });

  test('merges per-type overrides over the defaults', () => {
    const cfg = updater.getNotificationConfig({ notifications: { gameUpdate: { duration: 300 } } }, 'game');
    expect(cfg.duration).toBe(300);
    expect(cfg.message).toBe(updater.DEFAULT_NOTIFICATIONS.gameUpdate.message); // untouched default
  });

  test('derives duration from the legacy flat field when no block exists', () => {
    const cfg = updater.getNotificationConfig({ updateCountdownSeconds: 90 }, 'game');
    expect(cfg.duration).toBe(90);
  });
});
