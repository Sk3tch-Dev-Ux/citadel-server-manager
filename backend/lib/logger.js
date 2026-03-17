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

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
});

module.exports = logger;
