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
 * Handles cross-platform edge case: Windows absolute paths (C:\...)
 * used as basePath when the backend runs on macOS/Linux (dev mode).
 */
function safePath(basePath, userPath) {
  // Normalize Windows paths to forward slashes for cross-platform compat
  const normalizedBase = basePath.replace(/\\/g, '/');
  const normalizedUser = (userPath || '').replace(/\\/g, '/');

  // Detect Windows absolute path (e.g. "C:/Program Files/...") used on a non-Windows host
  const isWinAbsolute = /^[A-Za-z]:[\\/]/.test(normalizedBase);
  const hostIsWindows = process.platform === 'win32';

  // If basePath is a Windows absolute path but we're on macOS/Linux,
  // we can't validate it locally — just return the joined path without
  // filesystem checks (the path exists on the remote Windows server, not here)
  if (isWinAbsolute && !hostIsWindows) {
    // Still block path traversal via .. segments.
    //
    // Windows is case-insensitive on filesystem operations, so do the
    // containment check on lower-cased paths. Without this, a basePath of
    // "C:\DayZServer" and a userPath of "../dayzserver/foo" would resolve
    // to "C:/dayzserver/foo" and fail a case-sensitive startsWith.
    const joined = path.posix.join(normalizedBase, normalizedUser);
    const resolved = path.posix.normalize(joined);
    const baseLower = normalizedBase.toLowerCase();
    const resolvedLower = resolved.toLowerCase();

    // Critical: append '/' to baseLower so "C:/DayZServerEvil" does NOT
    // pass startsWith("C:/DayZServer"). Allow exact-equal as a special case
    // since a user can legitimately request the base directory itself.
    if (resolvedLower !== baseLower && !resolvedLower.startsWith(baseLower + '/')) {
      return null;
    }
    // Convert back to Windows separators for the remote
    return resolved.replace(/\//g, '\\');
  }

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
