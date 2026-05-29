'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadJSON, saveJSON, flushAll, forceFlush, cleanupStaleTempFiles } = require('../lib/data-store');
const { DATA_STORE_DEBOUNCE_MS } = require('../lib/constants');

let dir;
let n = 0;
// Unique filename per test — the module keys its queues by filename, so reusing
// a name across tests would cross-contaminate the shared in-memory maps.
const fname = () => `t${process.pid}-${n++}.json`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-test-'));
});
afterEach(() => {
  flushAll(); // clear any pending module-level state before tearing down
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('loadJSON', () => {
  test('reads and parses an existing file', () => {
    const f = fname();
    fs.writeFileSync(path.join(dir, f), JSON.stringify({ hello: 'world' }));
    expect(loadJSON(dir, f, null)).toEqual({ hello: 'world' });
  });

  test('returns a literal default when the file is missing', () => {
    expect(loadJSON(dir, fname(), { d: 1 })).toEqual({ d: 1 });
  });

  test('returns a computed default (function) when the file is missing', () => {
    expect(loadJSON(dir, fname(), () => ({ made: true }))).toEqual({ made: true });
  });

  test('falls back to default on corrupt JSON instead of throwing', () => {
    const f = fname();
    fs.writeFileSync(path.join(dir, f), '{ not valid json ');
    expect(loadJSON(dir, f, { safe: true })).toEqual({ safe: true });
  });
});

describe('forceFlush (synchronous)', () => {
  test('writes queued data immediately and round-trips', () => {
    const f = fname();
    saveJSON(dir, f, { a: 1 });
    forceFlush(dir, f);
    expect(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).toEqual({ a: 1 });
  });

  test('coalesces multiple saves to the latest value (latest-wins)', () => {
    const f = fname();
    saveJSON(dir, f, { v: 1 });
    saveJSON(dir, f, { v: 2 });
    saveJSON(dir, f, { v: 3 });
    forceFlush(dir, f);
    expect(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).toEqual({ v: 3 });
  });
});

describe('flushAll (synchronous)', () => {
  test('flushes every pending file', () => {
    const f1 = fname();
    const f2 = fname();
    saveJSON(dir, f1, { one: true });
    saveJSON(dir, f2, { two: true });
    flushAll();
    expect(JSON.parse(fs.readFileSync(path.join(dir, f1), 'utf8'))).toEqual({ one: true });
    expect(JSON.parse(fs.readFileSync(path.join(dir, f2), 'utf8'))).toEqual({ two: true });
  });
});

describe('cleanupStaleTempFiles', () => {
  test('removes .tmp.* files but leaves real data files', () => {
    fs.writeFileSync(path.join(dir, 'keep.json'), '{}');
    fs.writeFileSync(path.join(dir, 'data.json.tmp.abcd1234'), 'partial');
    fs.writeFileSync(path.join(dir, 'other.json.tmp.deadbeef'), 'partial');
    cleanupStaleTempFiles(dir);
    const left = fs.readdirSync(dir).sort();
    expect(left).toEqual(['keep.json']);
  });

  test('does not throw on a missing directory', () => {
    expect(() => cleanupStaleTempFiles(path.join(dir, 'nope'))).not.toThrow();
  });
});

describe('saveJSON debounced atomic write', () => {
  test('writes after the debounce window and leaves no temp file', async () => {
    const f = fname();
    saveJSON(dir, f, { async: 'value' });
    // Not yet written (debounced).
    expect(fs.existsSync(path.join(dir, f))).toBe(false);
    await wait(DATA_STORE_DEBOUNCE_MS + 300);
    expect(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).toEqual({ async: 'value' });
    // The atomic temp file must have been renamed away, not left behind.
    expect(fs.readdirSync(dir).some((x) => x.includes('.tmp.'))).toBe(false);
  });

  test('refuses to write through a symlink (M16 guard)', async () => {
    const f = fname();
    const target = path.join(dir, 'secret-target.txt');
    fs.writeFileSync(target, 'ORIGINAL');
    // Replace the destination with a symlink pointing at the protected target.
    const link = path.join(dir, f);
    try {
      fs.symlinkSync(target, link);
    } catch {
      return; // symlink not permitted on this platform/CI — skip
    }
    saveJSON(dir, f, { evil: true });
    await wait(DATA_STORE_DEBOUNCE_MS + 300);
    // The protected target must be untouched (still ORIGINAL, not JSON).
    expect(fs.readFileSync(target, 'utf8')).toBe('ORIGINAL');
  });
});
