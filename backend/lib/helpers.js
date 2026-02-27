/**
 * Pure utility functions with no state dependencies.
 */
const fs = require('fs');
const path = require('path');

/**
 * Sanitize string to prevent XSS when rendered in HTML contexts.
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Validate an object against a schema of field rules.
 * Returns error string or null if valid.
 */
function validateFields(obj, schema) {
  for (const key in schema) {
    const rule = schema[key];
    const value = obj[key];
    if (rule.required && (value === undefined || value === null || value === '')) return `${key} is required`;
    if (value !== undefined && value !== null && value !== '') {
      if (rule.type && typeof value !== rule.type) return `${key} must be a ${rule.type}`;
      if (rule.minLength && typeof value === 'string' && value.length < rule.minLength) return `${key} must be at least ${rule.minLength} characters`;
      if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) return `${key} must be at most ${rule.maxLength} characters`;
      if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) return `${key} is invalid`;
    }
  }
  return null;
}

/**
 * Safely resolve a user-provided path within a base directory.
 * Returns null if the resolved path escapes the base (path traversal).
 */
function safePath(basePath, userPath) {
  const realBase = fs.realpathSync(basePath);
  const resolved = path.resolve(realBase, userPath || '');
  let realResolved;
  try { realResolved = fs.realpathSync(resolved); } catch { realResolved = resolved; }
  if (!realResolved.startsWith(realBase + path.sep) && realResolved !== realBase) {
    return null;
  }
  return realResolved;
}

/**
 * Recursively copy a directory.
 */
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
  }
}

/**
 * Recursively calculate the total size (bytes) of a directory.
 */
function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        try { size += fs.statSync(fullPath).size; } catch { /* skip */ }
      }
    }
  } catch { /* directory might not exist */ }
  return size;
}

/**
 * Format byte count to human-readable string.
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/**
 * Password policy configuration and check.
 */
const PASSWORD_POLICY = {
  minLength: 8,
  requireUpper: true,
  requireLower: true,
  requireNumber: true,
  requireSpecial: true,
};

function checkPasswordPolicy(password) {
  if (typeof password !== 'string') return false;
  if (password.length < PASSWORD_POLICY.minLength) return false;
  if (PASSWORD_POLICY.requireUpper && !/[A-Z]/.test(password)) return false;
  if (PASSWORD_POLICY.requireLower && !/[a-z]/.test(password)) return false;
  if (PASSWORD_POLICY.requireNumber && !/[0-9]/.test(password)) return false;
  if (PASSWORD_POLICY.requireSpecial && !/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

module.exports = {
  sanitizeString,
  validateFields,
  safePath,
  copyDirSync,
  getDirSize,
  formatBytes,
  PASSWORD_POLICY,
  checkPasswordPolicy,
};
