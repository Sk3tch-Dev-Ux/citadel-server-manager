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
  // Operational errors (those thrown with `expose: true`) carry their own
  // intended HTTP status + safe client message. Honour them at this central
  // chokepoint so the dozens of provider-backed routes that pass a generic
  // `{ status: 500 }` still surface a typed upstream failure (e.g. a sidecar
  // timeout → 504 'Sidecar unreachable') without each call site special-casing
  // it. An explicit opts.status/clientMessage from the caller still wins.
  if (err && err.expose === true) {
    // A deliberately-chosen non-500 status from the caller (e.g. 504 on the
    // citadel bridge route) still wins; the generic 500 fallback does not.
    const callerChoseStatus = opts.status !== undefined && opts.status !== 500;
    if (!callerChoseStatus && typeof err.statusCode === 'number') {
      opts = { ...opts, status: err.statusCode };
    }
    if (opts.clientMessage === undefined && typeof err.clientMessage === 'string') {
      opts = { ...opts, clientMessage: err.clientMessage };
    }
  }

  const { status = 500, clientMessage, code, suggestion } = opts;

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
    errorCode: code,
  }, 'Request failed');

  const message = clientMessage || DEFAULT_MESSAGES[status] || 'Request failed';
  return res.status(status).json(buildErrorPayload(message, code, suggestion));
}

/**
 * Standardized 4xx response for user-correctable problems. Audit N6.
 *
 * Use when the error IS the user's fault and the message can safely be
 * shown verbatim — bad input, missing field, wrong state, etc. For
 * exceptions caught from internal code, use safeError instead so the
 * details get logged server-side and a generic message goes to the
 * client.
 *
 * Shape: { error, code?, suggestion? }
 *   - error:      human-readable message (always present, primary toast line)
 *   - code:       optional machine-readable category (CONFIG_WRITE_FAILED,
 *                 INVALID_INPUT, etc.) for support/debugging and future i18n
 *   - suggestion: optional next-step hint shown as a secondary toast line
 *
 * Examples:
 *   return clientError(res, 400, 'Server name is required',
 *     { code: 'MISSING_FIELD', suggestion: 'Use 3–32 characters.' });
 *   return clientError(res, 409, 'Server is currently running',
 *     { code: 'WRONG_STATE', suggestion: 'Stop it before applying this change.' });
 */
function clientError(res, status, message, opts = {}) {
  const { code, suggestion } = opts;
  return res.status(status).json(buildErrorPayload(message, code, suggestion));
}

function buildErrorPayload(message, code, suggestion) {
  const payload = { error: message };
  if (code) payload.code = code;
  if (suggestion) payload.suggestion = suggestion;
  return payload;
}

module.exports = { safeError, clientError };
