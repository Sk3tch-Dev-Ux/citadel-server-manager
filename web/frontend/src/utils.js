export function formatUptime(s) {
  if (!s || s <= 0) return '\u2014';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatBytes(b) {
  b = Number(b);
  if (!b || isNaN(b)) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(1) + ' ' + u[i];
}

export function timeAgo(d) {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * React hook that returns a debounced view of `value`. The debounced value
 * only updates after `delayMs` of no changes. Intended for filter/search
 * inputs where you want the DOM to re-render only when the user pauses typing,
 * but the input itself must stay responsive (bound to the undebounced state).
 *
 *   const [query, setQuery] = useState('');
 *   const debouncedQuery = useDebouncedValue(query, 200);
 *   const filtered = useMemo(() => items.filter(...debouncedQuery...), [items, debouncedQuery]);
 */
import { useState as _useState, useEffect as _useEffect } from 'react';
export function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = _useState(value);
  _useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Throttle calls to `fn` so it runs at most once every `waitMs`. Leading call
 * fires immediately, trailing call fires after the window to guarantee the
 * latest value is observed. Intended for socket update bursts (e.g. the mod
 * emits 15 metrics/sec; we only need 2-3/sec of UI churn).
 *
 * Returns a function with a `.cancel()` method to clean up any pending trail.
 */
export function throttle(fn, waitMs) {
  let lastCall = 0;
  let trailingTimer = null;
  let lastArgs = null;
  const throttled = function (...args) {
    const now = Date.now();
    const elapsed = now - lastCall;
    lastArgs = args;
    if (elapsed >= waitMs) {
      lastCall = now;
      fn.apply(this, args);
    } else if (!trailingTimer) {
      trailingTimer = setTimeout(() => {
        lastCall = Date.now();
        trailingTimer = null;
        fn.apply(this, lastArgs);
      }, waitMs - elapsed);
    }
  };
  throttled.cancel = () => {
    if (trailingTimer) { clearTimeout(trailingTimer); trailingTimer = null; }
  };
  return throttled;
}
