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
    // A validate() middleware on this route tags itself with _validationSchema;
    // surface it so the generator can emit requestBody/query parameter schemas.
    let validation = null;
    for (const sub of layer.route.stack || []) {
      if (sub.handle && sub.handle._validationSchema) { validation = sub.handle._validationSchema; break; }
    }
    for (const path of paths) {
      if (typeof path !== 'string') continue; // skip regex routes
      for (const method of methods) out.push({ method: method.toLowerCase(), path, validation });
    }
  }
  return out;
}

/**
 * Convert a single request-validator field rule to a JSON Schema fragment.
 */
function ruleToJsonSchema(rule) {
  const s = {};
  if (rule.type) s.type = rule.type;
  if (rule.enum) s.enum = rule.enum;
  if (rule.min !== undefined) s.minimum = rule.min;
  if (rule.max !== undefined) s.maximum = rule.max;
  if (rule.minLength !== undefined) s.minLength = rule.minLength;
  if (rule.maxLength !== undefined) s.maxLength = rule.maxLength;
  if (rule.pattern) s.pattern = rule.pattern.source;
  if (rule.default !== undefined && typeof rule.default !== 'function') s.default = rule.default;
  return s;
}

/**
 * Turn a { schema, source } validation descriptor into OpenAPI fragments:
 *   - body  → { requestBody }
 *   - query → { parameters: [...] }
 */
function validationToOpenApi(validation) {
  if (!validation || !validation.schema) return {};
  const { schema, source } = validation;
  const properties = {};
  const required = [];
  for (const [field, rule] of Object.entries(schema)) {
    properties[field] = ruleToJsonSchema(rule);
    if (rule.required) required.push(field);
  }

  if (source === 'query') {
    const parameters = Object.entries(schema).map(([field, rule]) => ({
      name: field,
      in: 'query',
      required: !!rule.required,
      schema: ruleToJsonSchema(rule),
    }));
    return { parameters };
  }

  // default: body
  const jsonSchema = { type: 'object', properties };
  if (required.length) jsonSchema.required = required;
  return {
    requestBody: {
      required: required.length > 0,
      content: { 'application/json': { schema: jsonSchema } },
    },
  };
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

  for (const { method, path, validation } of routes) {
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

    const parameters = params.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    // Fold in body/query schemas from the route's validate() middleware.
    const fromValidation = validationToOpenApi(validation);
    if (fromValidation.parameters) parameters.push(...fromValidation.parameters);
    if (fromValidation.requestBody) operation.requestBody = fromValidation.requestBody;

    if (parameters.length) operation.parameters = parameters;
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

module.exports = {
  extractRoutes,
  expressPathToOpenApi,
  tagFor,
  generateOpenApi,
  ruleToJsonSchema,
  validationToOpenApi,
};
