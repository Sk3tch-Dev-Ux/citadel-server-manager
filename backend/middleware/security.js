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
 * Sets httpOnly, sameSite=strict, and secure (when HTTPS).
 */
function secureCookies(useHttps) {
  return (req, res, next) => {
    res.cookie = function(name, value, options = {}) {
      options.httpOnly = true;
      options.sameSite = 'strict';
      if (useHttps) options.secure = true;
      return require('cookie').serialize(name, value, options);
    };
    next();
  };
}

module.exports = { createCors, secureCookies };
