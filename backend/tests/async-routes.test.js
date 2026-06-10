/**
 * Unit tests for the async route error-handling wrapper.
 */
const { wrapAsync, installAsyncErrorHandling } = require('../lib/async-routes');

describe('wrapAsync', () => {
  test('forwards a rejected async handler to next()', async () => {
    const boom = new Error('async boom');
    const wrapped = wrapAsync(async () => { throw boom; });
    const next = jest.fn();
    wrapped({}, {}, next);
    await new Promise((r) => { setImmediate(r); });
    expect(next).toHaveBeenCalledWith(boom);
  });

  test('forwards a synchronous throw to next()', () => {
    const boom = new Error('sync boom');
    const wrapped = wrapAsync(() => { throw boom; });
    const next = jest.fn();
    wrapped({}, {}, next);
    expect(next).toHaveBeenCalledWith(boom);
  });

  test('does not call next() when the handler resolves', async () => {
    const wrapped = wrapAsync(async (req, res) => { res.ok = true; });
    const next = jest.fn();
    const res = {};
    wrapped({}, res, next);
    await new Promise((r) => { setImmediate(r); });
    expect(next).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  test('passes 4-arg error middleware through untouched', () => {
    const errMw = (err, req, res, next) => next(err);
    expect(wrapAsync(errMw)).toBe(errMw);
  });

  test('returns non-functions unchanged (e.g. a path string)', () => {
    expect(wrapAsync('/api/x')).toBe('/api/x');
  });
});

describe('installAsyncErrorHandling', () => {
  test('wraps handlers registered via patched app methods', async () => {
    const registered = [];
    const fakeApp = {
      get(_path, handler) { registered.push(handler); },
      post() {}, put() {}, patch() {}, delete() {}, all() {}, use() {},
    };
    installAsyncErrorHandling(fakeApp);

    const boom = new Error('route boom');
    fakeApp.get('/x', async () => { throw boom; });
    expect(registered).toHaveLength(1);

    const next = jest.fn();
    registered[0]({}, {}, next);
    await new Promise((r) => { setImmediate(r); });
    expect(next).toHaveBeenCalledWith(boom);
  });
});
