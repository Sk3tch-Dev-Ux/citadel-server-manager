/**
 * Structured logger using pino.
 * - JSON output in production / service mode for log aggregation
 * - Pretty-printed output in development (when pino-pretty is available)
 */
const pino = require('pino');

// Determine if we should use pretty printing:
// - Not in production mode
// - Not running as a Windows service (NSSM)
// - pino-pretty must actually be resolvable
const wantPretty = process.env.NODE_ENV !== 'production'
  && process.env.CITADEL_SERVICE_MODE !== '1';

let transport;
if (wantPretty) {
  try {
    require.resolve('pino-pretty');
    transport = { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } };
  } catch {
    // pino-pretty not installed (e.g. production build) — fall back to JSON
  }
}

// Redact sensitive fields wherever they appear in the log payload tree.
// pino's redact paths support globs ('*.password' = any single-level field
// named password) but not deep recursion — so we list the common shapes
// callers tend to log: req, ctx, body, headers, plus catch-alls for any
// top-level or one-level-deep nesting. If a new sensitive field name appears
// in code, add it here.
//
// Audit L24. Previously no redaction; an accidental
//   logger.info({ req }, 'request')
// could land Authorization headers and login bodies in pino's output.
const SENSITIVE_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'apiKey',
  'api_key',           // snake_case — the DayZ mod's CommandRelay sends this in URL query
  'token',
  'jwt',
  'jwtSecret',
  'secret',
  'guardCode',
  'mfaSecret',
  'rconPassword',
  'authorization',
];
const REDACT_PATHS = [];
for (const f of SENSITIVE_FIELDS) {
  REDACT_PATHS.push(f);
  REDACT_PATHS.push(`*.${f}`);
  REDACT_PATHS.push(`req.body.${f}`);
  REDACT_PATHS.push(`req.headers.${f}`);
  REDACT_PATHS.push(`req.query.${f}`);
}
// Authorization headers are commonly capitalized on the wire; pino paths
// are case-sensitive.
REDACT_PATHS.push('req.headers.Authorization');
REDACT_PATHS.push('headers.authorization');
REDACT_PATHS.push('headers.Authorization');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport,
});

// Sanitize a URL string before logging. pino's redact works on object paths,
// not string contents — so a logger call like `logger.warn({ url: req.url })`
// with a URL like `/api/foo?api_key=SECRET&server_id=1` would still leak the
// secret. Callers that log raw URLs (request handlers, error middleware) must
// pass them through this helper.
//
// Audit N3 stop-gap (2026-05-19): the legacy CommandRelay DayZ mod still sends
// `?api_key=...&server_id=...` on every GET poll (CommandRelay.c — removed from
// this repo after v2.23.0, see git history for Scripts/) pending the
// header-based auth migration. This helper closes the backend-log half of that
// leak for installs still running that mod.
const URL_REDACT_KEYS = new Set([
  'api_key', 'apiKey', 'token', 'jwt', 'password', 'secret',
]);
function sanitizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl === '') return rawUrl;
  const qIdx = rawUrl.indexOf('?');
  if (qIdx === -1) return rawUrl;
  const path = rawUrl.slice(0, qIdx);
  const query = rawUrl.slice(qIdx + 1);
  const parts = query.split('&').map(pair => {
    const eq = pair.indexOf('=');
    if (eq === -1) return pair;
    const key = pair.slice(0, eq);
    if (URL_REDACT_KEYS.has(key)) return `${key}=[REDACTED]`;
    return pair;
  });
  return path + '?' + parts.join('&');
}

module.exports = logger;
module.exports.sanitizeUrl = sanitizeUrl;
