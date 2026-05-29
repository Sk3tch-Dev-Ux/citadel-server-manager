'use strict';

/**
 * OpenAPI 3.0 spec generation, derived from the live Express route table.
 *
 * Rather than hand-maintaining a spec for 200+ endpoints (which drifts out of
 * sync immediately), we introspect `app._router.stack` at request time so the
 * document always reflects the routes that are actually mounted. Per-endpoint
 * descriptions/params are currently stubs (method + path, path params typed as
 * strings); request-body schemas can be layered in later from the
 * request-validator definitions.
 *
 * All functions except extractRoutes are pure and unit-tested.
 */

/**
 * Pull { method, path } pairs from a built Express app's router stack.
 * @param {object} app - an Express application
 * @returns {Array<{method: string, path: string}>}
 */
function extractRoutes(app) {
  const out = [];
  const stack = (app && app._router && app._router.stack) || [];
  for (const layer of stack) {
    if (!layer.route || !layer.route.path) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    const methods = Object.keys(layer.route.methods || {}).filter((m) => m !== '_all');
    for (const path of paths) {
      if (typeof path !== 'string') continue; // skip regex routes
      for (const method of methods) out.push({ method: method.toLowerCase(), path });
    }
  }
  return out;
}

/**
 * Convert an Express path to an OpenAPI path template and collect its params.
 * `/api/servers/:id/mods/:modId` → { path: '/api/servers/{id}/mods/{modId}', params: ['id','modId'] }
 */
function expressPathToOpenApi(p) {
  const params = [];
  const path = p.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path, params };
}

/** Derive a grouping tag from the first path segment after /api. */
function tagFor(path) {
  const m = path.match(/^\/api\/([^/{]+)/);
  return m ? m[1] : 'misc';
}

/**
 * Build an OpenAPI 3.0 document from a list of { method, path } routes.
 * @param {Array<{method: string, path: string}>} routes
 * @param {object} [info] - { title, version, description, servers }
 * @returns {object} OpenAPI 3.0.3 document
 */
function generateOpenApi(routes, info = {}) {
  const paths = {};
  const tags = new Set();

  for (const { method, path } of routes) {
    if (path.includes('*')) continue; // skip catch-all / wildcard mounts
    const { path: oaPath, params } = expressPathToOpenApi(path);
    const tag = tagFor(path);
    tags.add(tag);

    if (!paths[oaPath]) paths[oaPath] = {};
    const operation = {
      tags: [tag],
      summary: `${method.toUpperCase()} ${oaPath}`,
      responses: {
        200: { description: 'Success' },
        400: { description: 'Validation error' },
        401: { description: 'Unauthorized' },
      },
    };
    if (params.length) {
      operation.parameters = params.map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
    }
    paths[oaPath][method] = operation;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: info.title || 'Citadel Agent API',
      version: info.version || '0.0.0',
      description: info.description || 'Auto-generated from the live Express route table.',
    },
    servers: info.servers || [{ url: '/' }],
    tags: [...tags].sort().map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'auth-token' },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    paths,
  };
}

module.exports = { extractRoutes, expressPathToOpenApi, tagFor, generateOpenApi };
