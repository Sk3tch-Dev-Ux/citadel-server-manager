/**
 * Async route error handling.
 *
 * Express does NOT catch errors thrown from `async` route handlers/middleware:
 * a rejected promise becomes an unhandledRejection and the request hangs with
 * no response. Most handlers here try/catch defensively, but not all (e.g. a
 * bare `async (req, res) => { res.json(listBans()); }`). Rather than wrap ~120
 * handlers by hand, we patch the app's routing methods ONCE — before any route
 * or middleware registers — so any handler that returns a promise gets
 * `.catch(next)` attached, routing the error to the global error-handling
 * middleware. Covers current and future routes automatically.
 *
 * - Sync handlers are unaffected (they don't return a thenable); a sync throw
 *   is still forwarded to next() for a consistent path.
 * - 4-argument Express error handlers are passed through untouched so error
 *   middleware keeps working (Express detects it by arity).
 */

/** Wrap a single handler so a thrown/rejected error is forwarded to next(). */
function wrapAsync(fn) {
  if (typeof fn !== 'function') return fn;
  if (fn.length === 4) return fn; // (err, req, res, next) — error middleware
  return function wrapped(req, res, next) {
    try {
      const out = fn.call(this, req, res, next);
      if (out && typeof out.then === 'function') {
        Promise.resolve(out).catch(next);
      }
      return out;
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Patch app[get|post|put|patch|delete|all|use] so every function argument is
 * wrapped via wrapAsync. Call once, immediately after express() and before
 * routes/middleware register.
 * @param {import('express').Express} app
 * @returns {import('express').Express} the same app, patched
 */
function installAsyncErrorHandling(app) {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];
  for (const m of methods) {
    if (typeof app[m] !== 'function') continue;
    const original = app[m].bind(app);
    app[m] = function patched(...args) {
      return original(...args.map((a) => (typeof a === 'function' ? wrapAsync(a) : a)));
    };
  }
  return app;
}

module.exports = { wrapAsync, installAsyncErrorHandling };
