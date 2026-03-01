/**
 * CORS and cookie security middleware.
 */
const cors = require('cors');

/**
 * Create CORS middleware configured with the allowed origins.
 */
function createCors(allowedOrigins) {
  return cors({ origin: allowedOrigins, credentials: true });
}

/**
 * Secure cookie defaults middleware.
 * Wraps the original Express res.cookie() to enforce httpOnly, sameSite, and secure flags.
 */
function secureCookies(useHttps) {
  return (req, res, next) => {
    const originalCookie = res.cookie.bind(res);
    res.cookie = function(name, value, options = {}) {
      options.httpOnly = options.httpOnly !== false;  // default true
      options.sameSite = options.sameSite || 'strict';
      if (useHttps) options.secure = true;
      return originalCookie(name, value, options);
    };
    next();
  };
}

module.exports = { createCors, secureCookies };
