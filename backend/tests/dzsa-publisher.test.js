'use strict';

const http = require('http');
const ctx = require('../lib/context');
const dzsa = require('../lib/dzsa-publisher');

function setup(srv, modList) {
  ctx.servers = [srv];
  ctx.serverStates = { [srv.id]: { status: 'running', modList } };
  ctx.io = null;
}

afterEach(() => { ctx.servers.forEach((s) => dzsa.stop(s.id)); });

describe('dzsaPort', () => {
  test('is gamePort + 10', () => {
    expect(dzsa.dzsaPort({ gamePort: 2302 })).toBe(2312);
    expect(dzsa.dzsaPort({ gamePort: 2402 })).toBe(2412);
    expect(dzsa.dzsaPort({})).toBe(2312); // default 2302
  });
});

describe('buildModList / buildPayload', () => {
  beforeEach(() => setup({ id: 's1', name: 'Test', gamePort: 2302, maxPlayers: 60 }, [
    { name: '@CF', workshopId: '1559212036', enabled: true, type: 'client' },
    { name: '@Server', workshopId: '123', enabled: true, type: 'server' },
    { name: '@Off', workshopId: '999', enabled: false },
    { name: '@NoId', enabled: true },
  ]));

  test('includes only enabled mods with a workshop id', () => {
    const mods = dzsa.buildModList('s1');
    expect(mods.map((m) => m.name)).toEqual(['@CF', '@Server']);
  });

  test('reports workshop id, app_id and type per mod', () => {
    const mods = dzsa.buildModList('s1');
    expect(mods[0]).toEqual({ name: '@CF', id: 1559212036, app_id: 221100, type: 'client' });
    expect(mods[1]).toMatchObject({ id: 123, type: 'server' });
  });

  test('payload carries server identity + ports', () => {
    const payload = dzsa.buildPayload(ctx.servers[0]);
    expect(payload).toMatchObject({ name: 'Test', maxPlayers: 60, gamePort: 2302 });
    expect(payload.mods).toHaveLength(2);
  });
});

describe('endpoint lifecycle', () => {
  // Use a high game port so gamePort+10 is free in CI.
  const srv = { id: 'live', name: 'Live', gamePort: 41100, maxPlayers: 40, dzsaPublish: true };

  test('serves the mod list over HTTP and stops cleanly', async () => {
    setup(srv, [{ name: '@CF', workshopId: '1559212036', enabled: true, type: 'client' }]);
    dzsa.start(srv);
    expect(dzsa.isPublishing('live')).toBe(true);

    const body = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: 41110, path: '/' }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      }).on('error', reject);
    });
    const json = JSON.parse(body);
    expect(json.name).toBe('Live');
    expect(json.mods[0]).toMatchObject({ name: '@CF', id: 1559212036, app_id: 221100 });

    dzsa.stop('live');
    expect(dzsa.isPublishing('live')).toBe(false);
  });

  test('start is a no-op when dzsaPublish is not enabled', () => {
    setup({ id: 'off', name: 'Off', gamePort: 41200 }, []);
    dzsa.start(ctx.servers[0]); // dzsaPublish undefined
    expect(dzsa.isPublishing('off')).toBe(false);
  });
});
