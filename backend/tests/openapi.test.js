'use strict';

const { extractRoutes, expressPathToOpenApi, tagFor, generateOpenApi } = require('../lib/openapi');

describe('expressPathToOpenApi', () => {
  test('converts :params to {params} and collects names', () => {
    expect(expressPathToOpenApi('/api/servers/:id/mods/:modId')).toEqual({
      path: '/api/servers/{id}/mods/{modId}',
      params: ['id', 'modId'],
    });
  });

  test('leaves param-free paths unchanged', () => {
    expect(expressPathToOpenApi('/api/health')).toEqual({ path: '/api/health', params: [] });
  });
});

describe('tagFor', () => {
  test('uses the first path segment after /api', () => {
    expect(tagFor('/api/servers/:id/start')).toBe('servers');
    expect(tagFor('/api/priority-queue')).toBe('priority-queue');
  });
  test('falls back to misc for non-/api paths', () => {
    expect(tagFor('/healthz')).toBe('misc');
  });
});

describe('extractRoutes', () => {
  test('pulls method/path pairs from an Express-like router stack', () => {
    const fakeApp = {
      _router: {
        stack: [
          { route: { path: '/api/a', methods: { get: true } } },
          { route: { path: '/api/b', methods: { post: true, put: true } } },
          { name: 'middleware' }, // non-route layer ignored
          { route: { path: /regex/, methods: { get: true } } }, // regex path skipped
        ],
      },
    };
    expect(extractRoutes(fakeApp)).toEqual([
      { method: 'get', path: '/api/a' },
      { method: 'post', path: '/api/b' },
      { method: 'put', path: '/api/b' },
    ]);
  });

  test('returns empty for an app with no router', () => {
    expect(extractRoutes({})).toEqual([]);
    expect(extractRoutes(null)).toEqual([]);
  });
});

describe('generateOpenApi', () => {
  const routes = [
    { method: 'get', path: '/api/servers' },
    { method: 'post', path: '/api/servers/:id/update' },
    { method: 'get', path: '/api/priority-queue' },
    { method: 'get', path: '/api/*' }, // wildcard — must be skipped
  ];

  test('produces a valid 3.0.3 document with info and security schemes', () => {
    const doc = generateOpenApi(routes, { title: 'X', version: '1.2.3' });
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info).toMatchObject({ title: 'X', version: '1.2.3' });
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(doc.components.securitySchemes.cookieAuth.in).toBe('cookie');
  });

  test('maps paths and methods, templating params', () => {
    const doc = generateOpenApi(routes);
    expect(doc.paths['/api/servers'].get).toBeDefined();
    expect(doc.paths['/api/servers/{id}/update'].post).toBeDefined();
    expect(doc.paths['/api/servers/{id}/update'].post.parameters[0]).toMatchObject({
      name: 'id', in: 'path', required: true,
    });
  });

  test('skips wildcard/catch-all routes', () => {
    const doc = generateOpenApi(routes);
    expect(Object.keys(doc.paths).some((p) => p.includes('*'))).toBe(false);
  });

  test('derives a sorted, de-duplicated tag list', () => {
    const doc = generateOpenApi(routes);
    const names = doc.tags.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('servers');
    expect(names).toContain('priority-queue');
  });

  test('merges multiple methods under the same path object', () => {
    const doc = generateOpenApi([
      { method: 'get', path: '/api/x' },
      { method: 'delete', path: '/api/x' },
    ]);
    expect(Object.keys(doc.paths['/api/x']).sort()).toEqual(['delete', 'get']);
  });
});
