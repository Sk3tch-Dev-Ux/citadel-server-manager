'use strict';

const {
  extractRoutes, expressPathToOpenApi, tagFor, generateOpenApi,
  ruleToJsonSchema, validationToOpenApi,
} = require('../lib/openapi');

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
      { method: 'get', path: '/api/a', validation: null },
      { method: 'post', path: '/api/b', validation: null },
      { method: 'put', path: '/api/b', validation: null },
    ]);
  });

  test('surfaces a validate() middleware schema from the route stack', () => {
    const schema = { name: { type: 'string', required: true } };
    const fakeApp = {
      _router: {
        stack: [
          {
            route: {
              path: '/api/c',
              methods: { post: true },
              stack: [
                { handle: () => {} }, // an unrelated middleware
                { handle: Object.assign(() => {}, { _validationSchema: { schema, source: 'body' } }) },
              ],
            },
          },
        ],
      },
    };
    expect(extractRoutes(fakeApp)[0].validation).toEqual({ schema, source: 'body' });
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

describe('ruleToJsonSchema', () => {
  test('maps validator rule keys to JSON Schema keywords', () => {
    expect(ruleToJsonSchema({ type: 'integer', min: 1, max: 100, default: 10 })).toEqual({
      type: 'integer', minimum: 1, maximum: 100, default: 10,
    });
    expect(ruleToJsonSchema({ type: 'string', minLength: 1, maxLength: 64, enum: ['a', 'b'] })).toEqual({
      type: 'string', minLength: 1, maxLength: 64, enum: ['a', 'b'],
    });
  });

  test('serializes a RegExp pattern to its source string', () => {
    expect(ruleToJsonSchema({ type: 'string', pattern: /^\d+$/ }).pattern).toBe('^\\d+$');
  });

  test('omits a function default', () => {
    expect(ruleToJsonSchema({ type: 'string', default: () => 'x' })).toEqual({ type: 'string' });
  });
});

describe('validationToOpenApi', () => {
  test('body schema becomes a requestBody with required fields', () => {
    const out = validationToOpenApi({
      source: 'body',
      schema: { name: { type: 'string', required: true }, count: { type: 'integer' } },
    });
    const js = out.requestBody.content['application/json'].schema;
    expect(out.requestBody.required).toBe(true);
    expect(js.type).toBe('object');
    expect(js.required).toEqual(['name']);
    expect(js.properties.count).toEqual({ type: 'integer' });
  });

  test('query schema becomes query parameters', () => {
    const out = validationToOpenApi({
      source: 'query',
      schema: { page: { type: 'integer', required: true }, q: { type: 'string' } },
    });
    expect(out.parameters).toEqual([
      { name: 'page', in: 'query', required: true, schema: { type: 'integer' } },
      { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
    ]);
  });

  test('empty/absent validation yields nothing', () => {
    expect(validationToOpenApi(null)).toEqual({});
    expect(validationToOpenApi({})).toEqual({});
  });
});

describe('generateOpenApi — with validation schemas', () => {
  test('attaches a requestBody from body validation', () => {
    const doc = generateOpenApi([
      {
        method: 'post', path: '/api/servers/:id/update',
        validation: { source: 'body', schema: { updateType: { type: 'string', enum: ['game', 'mod'] } } },
      },
    ]);
    const op = doc.paths['/api/servers/{id}/update'].post;
    // Path param still present...
    expect(op.parameters.find((p) => p.name === 'id')).toBeTruthy();
    // ...and the body schema came through.
    expect(op.requestBody.content['application/json'].schema.properties.updateType.enum).toEqual(['game', 'mod']);
  });

  test('merges query parameters alongside path parameters', () => {
    const doc = generateOpenApi([
      {
        method: 'get', path: '/api/servers/:id/logs',
        validation: { source: 'query', schema: { level: { type: 'string', required: true } } },
      },
    ]);
    const op = doc.paths['/api/servers/{id}/logs'].get;
    const names = op.parameters.map((p) => `${p.in}:${p.name}`);
    expect(names).toEqual(expect.arrayContaining(['path:id', 'query:level']));
  });
});
