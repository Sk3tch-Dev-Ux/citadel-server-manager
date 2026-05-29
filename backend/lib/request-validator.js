'use strict';

/**
 * Tiny, dependency-free request validation middleware.
 *
 * Replaces the ad-hoc per-route `if (!req.body.x) return res.status(400)...`
 * checks scattered across the route files with a single declarative schema and
 * a consistent error envelope:
 *
 *   { error: 'Validation failed', details: ['field is required', ...] }
 *
 * Usage:
 *   const { validate } = require('../lib/request-validator');
 *   app.post('/api/x', auth, validate({
 *     name:  { type: 'string', required: true, maxLength: 64 },
 *     count: { type: 'integer', min: 1, max: 100, default: 10 },
 *     mode:  { type: 'string', enum: ['a', 'b'] },
 *   }), handler);
 *
 * On success, the coerced/defaulted values are attached to
 * `req.validated[source]` (source defaults to 'body'); the original req[source]
 * is left untouched so existing handlers keep working unchanged.
 *
 * Supported rule keys:
 *   type       'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
 *   required   boolean
 *   default    value or () => value   (applied when the field is absent/empty)
 *   min / max          numeric bounds (for number/integer)
 *   minLength/maxLength length bounds (for string/array)
 *   enum       array of allowed values
 *   pattern    RegExp the (string) value must match
 *   custom     (value) => string|null   — return an error message or null
 */

const EMPTY = (v) => v === undefined || v === null || v === '';

/**
 * Coerce a query/string value to the declared primitive type. Body values that
 * are already the right type pass through unchanged. Returns { value } or
 * { error } describing a type mismatch.
 */
function coerce(field, value, type) {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') return { error: `${field} must be a string` };
      return { value };
    case 'number':
    case 'integer': {
      let n = value;
      if (typeof n === 'string' && n.trim() !== '') n = Number(n);
      if (typeof n !== 'number' || Number.isNaN(n)) return { error: `${field} must be a number` };
      if (type === 'integer' && !Number.isInteger(n)) return { error: `${field} must be an integer` };
      return { value: n };
    }
    case 'boolean':
      if (typeof value === 'boolean') return { value };
      if (value === 'true') return { value: true };
      if (value === 'false') return { value: false };
      return { error: `${field} must be a boolean` };
    case 'array':
      if (!Array.isArray(value)) return { error: `${field} must be an array` };
      return { value };
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value) || value === null) {
        return { error: `${field} must be an object` };
      }
      return { value };
    default:
      return { value };
  }
}

/**
 * Validate a single value against its rule. Returns { value } or { error }.
 */
function validateValue(field, rawValue, rule) {
  let value = rawValue;

  if (EMPTY(value)) {
    if (rule.default !== undefined) {
      value = typeof rule.default === 'function' ? rule.default() : rule.default;
    } else if (rule.required) {
      return { error: `${field} is required` };
    } else {
      return { skip: true }; // optional + absent → omit
    }
  }

  if (rule.type) {
    const c = coerce(field, value, rule.type);
    if (c.error) return { error: c.error };
    value = c.value;
  }

  // Numeric bounds
  if (typeof value === 'number') {
    if (rule.min !== undefined && value < rule.min) return { error: `${field} must be >= ${rule.min}` };
    if (rule.max !== undefined && value > rule.max) return { error: `${field} must be <= ${rule.max}` };
  }

  // Length bounds (strings and arrays)
  if (typeof value === 'string' || Array.isArray(value)) {
    if (rule.minLength !== undefined && value.length < rule.minLength) {
      return { error: `${field} must be at least ${rule.minLength} characters` };
    }
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      return { error: `${field} must be at most ${rule.maxLength} characters` };
    }
  }

  if (rule.enum && !rule.enum.includes(value)) {
    return { error: `${field} must be one of: ${rule.enum.join(', ')}` };
  }

  if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
    return { error: `${field} has an invalid format` };
  }

  if (typeof rule.custom === 'function') {
    const customError = rule.custom(value);
    if (customError) return { error: customError };
  }

  return { value };
}

/**
 * Validate an entire data object against a schema. Returns
 * { ok: true, cleaned } or { ok: false, errors: [...] }. Exposed for unit
 * testing and non-Express callers.
 */
function validateObject(schema, data) {
  const errors = [];
  const cleaned = {};
  for (const [field, rule] of Object.entries(schema)) {
    const result = validateValue(field, (data || {})[field], rule);
    if (result.error) errors.push(result.error);
    else if (!result.skip) cleaned[field] = result.value;
  }
  return errors.length ? { ok: false, errors } : { ok: true, cleaned };
}

/**
 * Express middleware factory.
 *
 * @param {object} schema - field → rule map
 * @param {'body'|'query'|'params'} [source='body']
 * @returns {function} Express middleware
 */
function validate(schema, source = 'body') {
  return function (req, res, next) {
    const result = validateObject(schema, req[source]);
    if (!result.ok) {
      return res.status(400).json({ error: 'Validation failed', details: result.errors });
    }
    req.validated = req.validated || {};
    req.validated[source] = result.cleaned;
    next();
  };
}

module.exports = { validate, validateObject, validateValue };
