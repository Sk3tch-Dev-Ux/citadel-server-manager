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

module.exports = logger;
