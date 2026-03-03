/**
 * Backend test suite — Phase 5: Quality & DevOps
 *
 * Tests cover:
 *   - Pure utility functions (safePath, checkPasswordPolicy, sanitizeString, validateFields)
 *   - API endpoint authentication (via supertest)
 *   - Rate limiting headers
 */

// ─── Set env vars BEFORE any requires ──────────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.PORT = '0'; // Let OS assign port (avoids conflicts)
process.env.NODE_ENV = 'production'; // Avoid pino-pretty transport worker

// ─── Mock ESM-only deps that Jest can't parse ─────────────────
jest.mock('uuid', () => ({ v4: () => 'test-uuid-' + Math.random().toString(36).slice(2) }));
// node-fetch replaced by built-in fetch (Node 18+) — mock global fetch for tests
global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ─── Unit tests for pure utility functions ─────────────────────
const {
  safePath,
  checkPasswordPolicy,
  sanitizeString,
  validateFields,
} = require('./lib/helpers');

describe('Utility: sanitizeString', () => {
  it('should escape HTML special characters', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('should escape ampersands', () => {
    expect(sanitizeString('foo & bar')).toBe('foo &amp; bar');
  });

  it('should escape single quotes', () => {
    expect(sanitizeString("it's")).toBe('it&#39;s');
  });

  it('should return non-string values unchanged', () => {
    expect(sanitizeString(42)).toBe(42);
    expect(sanitizeString(null)).toBe(null);
  });

  it('should handle empty string', () => {
    expect(sanitizeString('')).toBe('');
  });
});

describe('Utility: checkPasswordPolicy', () => {
  it('should reject passwords shorter than 8 characters', () => {
    expect(checkPasswordPolicy('Ab1!xyz')).toBe(false); // 7 chars
  });

  it('should reject passwords without uppercase', () => {
    expect(checkPasswordPolicy('abcd1234!')).toBe(false);
  });

  it('should reject passwords without lowercase', () => {
    expect(checkPasswordPolicy('ABCD1234!')).toBe(false);
  });

  it('should reject passwords without numbers', () => {
    expect(checkPasswordPolicy('Abcdefgh!')).toBe(false);
  });

  it('should reject passwords without special characters', () => {
    expect(checkPasswordPolicy('Abcdefg1')).toBe(false);
  });

  it('should accept passwords meeting all requirements', () => {
    expect(checkPasswordPolicy('MyP@ss1!')).toBe(true);
  });

  it('should reject non-string input', () => {
    expect(checkPasswordPolicy(12345678)).toBe(false);
    expect(checkPasswordPolicy(undefined)).toBe(false);
    expect(checkPasswordPolicy(null)).toBe(false);
  });
});

describe('Utility: validateFields', () => {
  it('should return error for missing required field', () => {
    const result = validateFields({}, { name: { required: true } });
    expect(result).toMatch(/name is required/);
  });

  it('should return error for wrong type', () => {
    const result = validateFields({ age: '25' }, { age: { type: 'number' } });
    expect(result).toMatch(/age must be a number/);
  });

  it('should return error for too-short string', () => {
    const result = validateFields({ name: 'ab' }, { name: { minLength: 3 } });
    expect(result).toMatch(/name must be at least 3 characters/);
  });

  it('should return error for too-long string', () => {
    const result = validateFields({ name: 'abcdef' }, { name: { maxLength: 5 } });
    expect(result).toMatch(/name must be at most 5 characters/);
  });

  it('should return error for pattern mismatch', () => {
    const result = validateFields({ email: 'notanemail' }, { email: { pattern: /^.+@.+$/ } });
    expect(result).toMatch(/email is invalid/);
  });

  it('should return null when all fields are valid', () => {
    const result = validateFields(
      { name: 'John', age: 30 },
      { name: { required: true, type: 'string', minLength: 2 }, age: { type: 'number' } }
    );
    expect(result).toBeNull();
  });
});

describe('Utility: safePath', () => {
  let tempDir;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safepath-test-'));
    fs.mkdirSync(path.join(tempDir, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'subdir', 'file.txt'), 'test');
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should resolve valid paths within base directory', () => {
    const result = safePath(tempDir, 'subdir');
    expect(result).not.toBeNull();
    expect(result.startsWith(tempDir) || result === tempDir).toBe(true);
  });

  it('should return the base directory itself for empty path', () => {
    const result = safePath(tempDir, '');
    expect(result).not.toBeNull();
  });

  it('should block path traversal with ../', () => {
    const result = safePath(tempDir, '../../../etc/passwd');
    expect(result).toBeNull();
  });

  it('should block path traversal with ..\\', () => {
    const result = safePath(tempDir, '..\\..\\..\\windows\\system32');
    expect(result).toBeNull();
  });

  it('should block absolute paths outside base', () => {
    const outsidePath = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
    const result = safePath(tempDir, outsidePath);
    expect(result).toBeNull();
  });

  it('should allow nested paths within base', () => {
    const result = safePath(tempDir, 'subdir/file.txt');
    expect(result).not.toBeNull();
    expect(result.endsWith('file.txt')).toBe(true);
  });
});

// ─── API integration tests ─────────────────────────────────────
// These require the full Express app. The server.js IIFE starts
// polling and listening, but we use --forceExit to clean up.
const { app } = require('./server');

describe('API: Authentication', () => {
  it('should reject login with invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/);
  });

  it('should reject requests without a token', async () => {
    const res = await request(app).get('/api/servers');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/No token/);
  });

  it('should reject requests with an invalid token', async () => {
    const res = await request(app)
      .get('/api/servers')
      .set('Authorization', 'Bearer invalid-token-here');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid token/);
  });

  it('should reject requests with an expired token', async () => {
    const expiredToken = jwt.sign(
      { id: 'test', username: 'test', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '0s' }
    );
    // Small delay to ensure expiry
    await new Promise(r => setTimeout(r, 100));
    const res = await request(app)
      .get('/api/servers')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });
});

describe('API: Rate Limiting', () => {
  it('should include rate limit headers on API responses', async () => {
    const res = await request(app).get('/api/servers');
    // express-rate-limit sets these headers
    expect(res.headers).toHaveProperty('ratelimit-limit');
  });
});

describe('API: Password Policy Enforcement', () => {
  const testAdminId = 'test-admin-for-jest';

  beforeAll(() => {
    // Inject a test admin user into the runtime context so auth middleware passes
    const ctx = require('./lib/context');
    ctx.users.push({
      id: testAdminId,
      username: 'jestadmin',
      passwordHash: '$2a$10$fakehash',
      role: 'admin',
    });
  });

  afterAll(() => {
    const ctx = require('./lib/context');
    ctx.users = ctx.users.filter(u => u.id !== testAdminId);
  });

  it('should reject user creation with weak password', async () => {
    const token = jwt.sign(
      { id: testAdminId, username: 'jestadmin', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'testuser', password: 'short', role: 'viewer' });
    expect(res.status).toBe(400);
    // validateFields checks minLength first, then checkPasswordPolicy runs
    expect(res.body.error).toMatch(/password/i);
  });
});

describe('API: Backup Endpoint Auth', () => {
  it('should require authentication for backup endpoint', async () => {
    const res = await request(app).get('/api/backup/users');
    expect(res.status).toBe(401);
  });
});
