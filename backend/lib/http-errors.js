/**
 * Safe HTTP error responses.
 *
 * Historically routes did: `res.status(500).json({ error: err.message })`.
 * That leaks file paths, stack context, library internals, and config hints
 * to any HTTP client. `safeError()` replaces that pattern — it logs the full
 * detail server-side (with request context) and returns a generic message
 * to the caller.
 *
 * Usage:
 *   try { ... }
 *   catch (err) { return safeError(err, req, res); }
 *
 *   // With an intentional user-facing hint (stripped of err.message):
 *   catch (err) { return safeError(err, req, res, { status: 502, clientMessage: 'RCON unreachable' }); }
 */
const logger = require('./logger');

const DEFAULT_MESSAGES = {
  400: 'Bad request',
  401: 'Authentication required',
  403: 'Access denied',
  404: 'Not found',
  409: 'Conflict',
  422: 'Invalid input',
  429: 'Too many requests',
  500: 'Internal server error',
  502: 'Upstream service unavailable',
  503: 'Service unavailable',
  504: 'Request timed out',
};

function safeError(err, req, res, opts = {}) {
  const { status = 500, clientMessage } = opts;

  logger.error({
    err: {
      message: err?.message,
      stack: err?.stack,
      code: err?.code,
    },
    url: req?.originalUrl,
    method: req?.method,
    userId: req?.userId,
    ip: req?.ip,
    status,
  }, 'Request failed');

  const message = clientMessage || DEFAULT_MESSAGES[status] || 'Request failed';
  return res.status(status).json({ error: message });
}

module.exports = { safeError };
