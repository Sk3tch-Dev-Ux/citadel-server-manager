/**
 * Rate limiter configurations for different endpoint groups.
 */
const rateLimit = require('express-rate-limit');

/** General API limiter: 120 requests per minute per IP */
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/** Auth endpoints: 15 attempts per 15 minutes (brute-force protection) */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

/** Discord bot endpoint: 60 requests per minute */
const discordLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' },
});

module.exports = { apiLimiter, authLimiter, discordLimiter };
