'use strict';

// G1 Phase 1 — durable telemetry replay. Two units:
//   1. CitadelBridge.readEventsFrom — line-boundary-safe, rotation-safe byte
//      cursor read used by the cloud forwarder's durable tailer.
//   2. Forwarder durable tailer (_tailEvents / _resolveStartOffset) — advances
//      and persists the cloud offset only while authenticated.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock storage so we can assert offset persistence without touching disk.
jest.mock('../lib/cloud-bridge/storage', () => ({
  getAckedOffset: jest.fn(),
  setAckedOffset: jest.fn(),
  flushAckedOffsets: jest.fn(),
}));

const storage = require('../lib/cloud-bridge/storage');
const { Forwarder } = require('../lib/cloud-bridge/forwarders');
const { CitadelBridge } = require('../lib/citadel-bridge');

const len = (s) => Buffer.byteLength(s, 'utf-8');

function bridgeWithEvents(content) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cit-evt-'));
  const b = new CitadelBridge({ id: 'srv', installDir: tmp, profileDir: 'profiles' });
  fs.mkdirSync(b.citadelDir, { recursive: true });
  fs.writeFileSync(b.files.events, content, 'utf-8');
  return b;
}

describe('CitadelBridge.readEventsFrom', () => {
  test('reads all complete lines from offset 0 and advances to EOF', () => {
    const content = '{"type":"a"}\n{"type":"b"}\n';
    const b = bridgeWithEvents(content);
    const { events, nextOffset } = b.readEventsFrom(0);
    expect(events.map((e) => e.type)).toEqual(['a', 'b']);
    expect(nextOffset).toBe(len(content));
  });

  test('excludes a partial trailing line (still being appended)', () => {
    const complete = '{"type":"a"}\n';
    const content = complete + '{"type":"parti'; // no trailing newline
    const b = bridgeWithEvents(content);
    const { events, nextOffset } = b.readEventsFrom(0);
    expect(events.map((e) => e.type)).toEqual(['a']);
    expect(nextOffset).toBe(len(complete)); // stops at the last newline
  });

  test('resumes from a mid-file offset (no re-read of earlier lines)', () => {
    const first = '{"type":"a"}\n';
    const content = first + '{"type":"b"}\n';
    const b = bridgeWithEvents(content);
    const { events, nextOffset } = b.readEventsFrom(len(first));
    expect(events.map((e) => e.type)).toEqual(['b']);
    expect(nextOffset).toBe(len(content));
  });

  test('rotation: offset past EOF re-tails from the start', () => {
    const content = '{"type":"a"}\n';
    const b = bridgeWithEvents(content);
    const { events, nextOffset } = b.readEventsFrom(999999);
    expect(events.map((e) => e.type)).toEqual(['a']);
    expect(nextOffset).toBe(len(content));
  });

  test('nothing new: offset at EOF returns empty without advancing', () => {
    const content = '{"type":"a"}\n';
    const b = bridgeWithEvents(content);
    const { events, nextOffset } = b.readEventsFrom(len(content));
    expect(events).toEqual([]);
    expect(nextOffset).toBe(len(content));
  });

  test('missing file returns empty, offset unchanged', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cit-evt-'));
    const b = new CitadelBridge({ id: 'srv', installDir: tmp, profileDir: 'profiles' });
    const { events, nextOffset } = b.readEventsFrom(123);
    expect(events).toEqual([]);
    expect(nextOffset).toBe(123);
  });
});

function authedClient() {
  const sent = [];
  return { sent, isAuthenticated: () => true, send: (m) => { sent.push(m); return true; } };
}

describe('Forwarder durable tailer', () => {
  beforeEach(() => jest.clearAllMocks());

  test('_tailEvents forwards new lines, advances + persists the offset', () => {
    const f = new Forwarder('srv');
    f._bridge = {
      readEventsFrom: jest.fn(() => ({
        events: [{ type: 'chat', steamId: '1', name: 'a', message: 'hi', channel: 'global' }],
        nextOffset: 42,
      })),
    };
    const c = authedClient();
    f._client = c;
    f._cloudOffset = 0;

    f._tailEvents();

    expect(f._bridge.readEventsFrom).toHaveBeenCalledWith(0);
    expect(c.sent.map((m) => m.type)).toContain('chat');
    expect(f._cloudOffset).toBe(42);
    expect(storage.setAckedOffset).toHaveBeenCalledWith('srv', 42);
  });

  test('_tailEvents does nothing while not authenticated (no advance, no send)', () => {
    const f = new Forwarder('srv');
    f._bridge = { readEventsFrom: jest.fn() };
    f._client = { isAuthenticated: () => false, send: jest.fn() };
    f._cloudOffset = 7;

    f._tailEvents();

    expect(f._bridge.readEventsFrom).not.toHaveBeenCalled();
    expect(f._client.send).not.toHaveBeenCalled();
    expect(f._cloudOffset).toBe(7);
    expect(storage.setAckedOffset).not.toHaveBeenCalled();
  });

  test('_tailEvents is a no-op when there is nothing new', () => {
    const f = new Forwarder('srv');
    f._bridge = { readEventsFrom: jest.fn(() => ({ events: [], nextOffset: 100 })) };
    const c = authedClient();
    f._client = c;
    f._cloudOffset = 100;

    f._tailEvents();

    expect(c.sent).toHaveLength(0);
    expect(storage.setAckedOffset).not.toHaveBeenCalled();
  });

  test('_resolveStartOffset: brand-new link starts at the current tail', () => {
    const f = new Forwarder('srv');
    f._bridge = { getEventsSize: () => 1000 };
    storage.getAckedOffset.mockReturnValue(null);
    expect(f._resolveStartOffset()).toBe(1000);
  });

  test('_resolveStartOffset: existing link resumes from persisted offset', () => {
    const f = new Forwarder('srv');
    f._bridge = { getEventsSize: () => 1000 };
    storage.getAckedOffset.mockReturnValue(500);
    expect(f._resolveStartOffset()).toBe(500);
  });

  test('_resolveStartOffset: persisted offset past EOF re-tails from 0', () => {
    const f = new Forwarder('srv');
    f._bridge = { getEventsSize: () => 1000 };
    storage.getAckedOffset.mockReturnValue(2000);
    expect(f._resolveStartOffset()).toBe(0);
  });

  test('_resolveStartOffset: caps replay to MAX_REPLAY_BYTES on a huge backlog', () => {
    const f = new Forwarder('srv');
    const size = 20 * 1024 * 1024;
    f._bridge = { getEventsSize: () => size };
    storage.getAckedOffset.mockReturnValue(0);
    expect(f._resolveStartOffset()).toBe(size - 8 * 1024 * 1024);
  });
});
