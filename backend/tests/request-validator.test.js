'use strict';

const { validate, validateObject } = require('../lib/request-validator');

describe('validateObject', () => {
  test('passes a valid object and returns cleaned values', () => {
    const r = validateObject(
      { name: { type: 'string', required: true }, count: { type: 'integer', min: 1 } },
      { name: 'srv', count: 5 }
    );
    expect(r).toEqual({ ok: true, cleaned: { name: 'srv', count: 5 } });
  });

  test('reports missing required fields', () => {
    const r = validateObject({ name: { type: 'string', required: true } }, {});
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('name is required');
  });

  test('applies defaults (value and function) when absent', () => {
    const r = validateObject(
      { a: { type: 'integer', default: 10 }, b: { type: 'string', default: () => 'x' } },
      {}
    );
    expect(r.cleaned).toEqual({ a: 10, b: 'x' });
  });

  test('omits optional absent fields from cleaned output', () => {
    const r = validateObject({ note: { type: 'string' } }, {});
    expect(r).toEqual({ ok: true, cleaned: {} });
  });

  test('coerces numeric strings (query-style) to numbers', () => {
    const r = validateObject({ n: { type: 'integer' } }, { n: '42' });
    expect(r.cleaned.n).toBe(42);
  });

  test('rejects non-numeric strings for number types', () => {
    const r = validateObject({ n: { type: 'number' } }, { n: 'abc' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/must be a number/);
  });

  test('rejects non-integers for integer type', () => {
    const r = validateObject({ n: { type: 'integer' } }, { n: 1.5 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/must be an integer/);
  });

  test('coerces boolean strings', () => {
    expect(validateObject({ b: { type: 'boolean' } }, { b: 'true' }).cleaned.b).toBe(true);
    expect(validateObject({ b: { type: 'boolean' } }, { b: 'false' }).cleaned.b).toBe(false);
  });

  test('enforces numeric min/max', () => {
    expect(validateObject({ n: { type: 'integer', min: 1, max: 100 } }, { n: 0 }).errors[0]).toMatch(/>= 1/);
    expect(validateObject({ n: { type: 'integer', min: 1, max: 100 } }, { n: 101 }).errors[0]).toMatch(/<= 100/);
    expect(validateObject({ n: { type: 'integer', min: 1, max: 100 } }, { n: 50 }).ok).toBe(true);
  });

  test('enforces string length bounds', () => {
    expect(validateObject({ s: { type: 'string', minLength: 3 } }, { s: 'ab' }).ok).toBe(false);
    expect(validateObject({ s: { type: 'string', maxLength: 3 } }, { s: 'abcd' }).ok).toBe(false);
    expect(validateObject({ s: { type: 'string', minLength: 1, maxLength: 3 } }, { s: 'ab' }).ok).toBe(true);
  });

  test('enforces enum membership', () => {
    expect(validateObject({ m: { enum: ['a', 'b'] } }, { m: 'c' }).errors[0]).toMatch(/one of: a, b/);
    expect(validateObject({ m: { enum: ['a', 'b'] } }, { m: 'a' }).ok).toBe(true);
  });

  test('enforces regex pattern', () => {
    const schema = { id: { type: 'string', pattern: /^\d+$/ } };
    expect(validateObject(schema, { id: '123' }).ok).toBe(true);
    expect(validateObject(schema, { id: 'x12' }).errors[0]).toMatch(/invalid format/);
  });

  test('runs a custom validator', () => {
    const schema = { even: { type: 'integer', custom: (v) => (v % 2 === 0 ? null : 'must be even') } };
    expect(validateObject(schema, { even: 4 }).ok).toBe(true);
    expect(validateObject(schema, { even: 3 }).errors[0]).toBe('must be even');
  });

  test('accumulates multiple errors', () => {
    const r = validateObject(
      { a: { required: true }, b: { type: 'integer' } },
      { b: 'nope' }
    );
    expect(r.errors).toHaveLength(2);
  });
});

describe('validate middleware', () => {
  function run(schema, body) {
    const req = { body };
    let status = 200;
    let payload;
    const res = { status(s) { status = s; return this; }, json(p) { payload = p; return this; } };
    let nextCalled = false;
    validate(schema)(req, res, () => { nextCalled = true; });
    return { status, payload, nextCalled, req };
  }

  test('calls next() and attaches req.validated.body on success', () => {
    const { nextCalled, req, status } = run({ name: { type: 'string', required: true } }, { name: 'ok' });
    expect(nextCalled).toBe(true);
    expect(status).toBe(200);
    expect(req.validated.body).toEqual({ name: 'ok' });
  });

  test('responds 400 with the standard envelope on failure', () => {
    const { nextCalled, status, payload } = run({ name: { type: 'string', required: true } }, {});
    expect(nextCalled).toBe(false);
    expect(status).toBe(400);
    expect(payload.error).toBe('name is required');           // human-readable message
    expect(payload.details).toContain('name is required');    // structured list
  });

  test('joins multiple errors into the error message', () => {
    const { payload } = run({ a: { required: true }, b: { required: true } }, {});
    expect(payload.error).toBe('a is required; b is required');
    expect(payload.details).toHaveLength(2);
  });

  test('does not mutate the original req.body', () => {
    const { req } = run({ n: { type: 'integer', default: 7 } }, {});
    expect(req.body).toEqual({});        // untouched
    expect(req.validated.body).toEqual({ n: 7 }); // coerced/defaulted copy
  });
});
