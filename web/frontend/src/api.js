/* global CustomEvent */

/**
 * Audit M11 — JWT lives in an HttpOnly cookie set by /api/auth/login,
 * not in localStorage. The browser auto-attaches the cookie on every
 * same-origin request when we pass `credentials: 'include'`. This fixes
 * the "DOM-XSS can steal the token" finding in the audit.
 *
 * The CSRF double-submit pattern still uses the readable 'csrf-nonce'
 * cookie + X-CSRF-Token header — that doesn't change. SameSite=strict
 * on the auth cookie is what makes CSRF necessary in the first place
 * being a non-issue for the auth cookie itself; the CSRF token defends
 * against same-origin XSS-driven abuse of in-flight session cookies.
 *
 * The `API.token` static is kept as a legacy escape hatch for places
 * that still call `API.token = ''` on logout. The Bearer header is
 * still sent if `API.token` is non-empty — useful for the Electron
 * desktop app, which has its own session story, and for any tooling
 * that explicitly sets a token.
 */
const REQUEST_TIMEOUT_MS = 30000;
// Ring buffer of recent API events for support diagnostics. Audit N7.
// Captures last N requests so a stuck user can hit "Download diagnostics"
// and send the file. Bounded so we don't grow memory unbounded over a
// long session.
const EVENT_RING_SIZE = 50;

class API {
  // Audit M11: no longer reads from localStorage at module load. Empty
  // by default; the cookie is the source of truth. AuthContext.logout()
  // sets this to '' on logout for completeness.
  static token = '';

  // Audit N7: in-memory ring buffer of recent API calls. Format per entry:
  // { ts, method, url, status, ok, durationMs, error? }. We deliberately
  // do NOT log request/response bodies — those may contain passwords or
  // tokens. URL is run through a basic key-stripper for the same reason.
  static _events = [];

  static _recordEvent(entry) {
    this._events.push(entry);
    if (this._events.length > EVENT_RING_SIZE) {
      this._events.splice(0, this._events.length - EVENT_RING_SIZE);
    }
  }

  // Scrub sensitive query params (mirrors backend lib/logger.js sanitizeUrl)
  // so diagnostics files can be safely emailed / posted to a forum.
  static _sanitizeUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return rawUrl;
    const qIdx = rawUrl.indexOf('?');
    if (qIdx === -1) return rawUrl;
    const path = rawUrl.slice(0, qIdx);
    const REDACT = new Set(['api_key', 'apiKey', 'token', 'jwt', 'password', 'secret']);
    const parts = rawUrl.slice(qIdx + 1).split('&').map(pair => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const k = pair.slice(0, eq);
      return REDACT.has(k) ? `${k}=[REDACTED]` : pair;
    });
    return path + '?' + parts.join('&');
  }

  static getRecentEvents() {
    return this._events.slice();
  }

  static downloadDiagnostics(extraContext) {
    const lines = [];
    lines.push(`Citadel API diagnostics`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`User-Agent: ${navigator.userAgent}`);
    if (extraContext && typeof extraContext === 'string') {
      lines.push(`Context: ${extraContext}`);
    }
    lines.push('');
    lines.push(`Recent API events (oldest → newest, capped at ${EVENT_RING_SIZE}):`);
    lines.push('');
    for (const e of this._events) {
      const head = `${e.ts}  ${e.method.padEnd(5)}  ${String(e.status || '---').padStart(3)}  ${e.durationMs}ms  ${e.url}`;
      lines.push(head);
      if (e.error) lines.push(`    error: ${e.error}`);
    }
    if (this._events.length === 0) lines.push('  (no API calls recorded yet)');
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `citadel-diagnostics-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  static headers() {
    const h = { 'Content-Type': 'application/json' };
    // Bearer header is now optional. Only attach if the caller has
    // explicitly populated API.token (desktop app, scripted client).
    // Browser sessions get auth via the HttpOnly cookie automatically.
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    // Read CSRF nonce from cookie for double-submit pattern
    const csrf = document.cookie.split('; ').find(c => c.startsWith('csrf-nonce='));
    if (csrf) h['X-CSRF-Token'] = csrf.split('=')[1];
    return h;
  }

  static _handle401(r) {
    if (r.status === 401) {
      this.token = '';
      // Audit M11: localStorage no longer holds 'token'. Clear 'user'
      // (display state, not sensitive) so AuthContext sees a fresh slate.
      localStorage.removeItem('user');
      // Dispatch a custom event instead of hard-reloading (preserves UX)
      window.dispatchEvent(new CustomEvent('citadel:session-expired'));
      throw new Error('Session expired');
    }
  }

  static async _parseResponse(r) {
    this._handle401(r);
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: `Server error (${r.status}): ${text.substring(0, 200)}` };
    }
  }

  /**
   * Fetch with timeout via AbortController.
   * `credentials: 'include'` is the M11 lever that lets the auth-token
   * cookie attach to every same-origin request automatically.
   *
   * @param {string} url
   * @param {object} options - fetch options plus optional `timeout` in ms
   */
  static async _fetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeout || REQUEST_TIMEOUT_MS;
    delete options.timeout;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();
    const method = (options.method || 'GET').toUpperCase();
    const sanitized = this._sanitizeUrl(url);
    try {
      const r = await fetch(url, {
        credentials: 'include',
        ...options,
        signal: controller.signal,
      });
      this._recordEvent({
        ts: new Date().toISOString(),
        method, url: sanitized, status: r.status, ok: r.ok,
        durationMs: Math.round(Date.now() - t0),
      });
      return r;
    } catch (err) {
      this._recordEvent({
        ts: new Date().toISOString(),
        method, url: sanitized, status: 0, ok: false,
        durationMs: Math.round(Date.now() - t0),
        error: err.name === 'AbortError' ? 'timeout' : (err.message || String(err)),
      });
      if (err.name === 'AbortError') throw new Error('Request timed out', { cause: err });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  static async get(url) {
    const r = await this._fetch(url, { headers: this.headers() });
    return this._parseResponse(r);
  }

  static async post(url, data, { timeout, skipAuth } = {}) {
    const r = await this._fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(data), ...(timeout && { timeout }) });
    // skipAuth: parse response without triggering the 401 session-expiry handler
    // (used by login endpoint where 401 means "wrong credentials", not "expired session")
    if (skipAuth) {
      const text = await r.text();
      try { return JSON.parse(text); } catch { return { error: `Server error (${r.status}): ${text.substring(0, 200)}` }; }
    }
    return this._parseResponse(r);
  }

  static async patch(url, data) {
    const r = await this._fetch(url, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(data) });
    return this._parseResponse(r);
  }

  static async put(url, data) {
    const r = await this._fetch(url, { method: 'PUT', headers: this.headers(), body: JSON.stringify(data) });
    return this._parseResponse(r);
  }

  static async del(url) {
    const r = await this._fetch(url, { method: 'DELETE', headers: this.headers() });
    return this._parseResponse(r);
  }

  /**
   * Authenticated file download. Fetches the URL with the usual auth (cookie +
   * optional Bearer), reads the response as a blob, and triggers a browser
   * "Save As" with the given filename (or the server's Content-Disposition).
   * Used for CSV/diagnostic exports where a plain <a href> wouldn't carry the
   * Bearer header used by the desktop app.
   *
   * @param {string} url
   * @param {string} [filename] - fallback download name
   */
  static async download(url, filename = 'download') {
    const r = await this._fetch(url, { headers: this.headers() });
    this._handle401(r);
    if (!r.ok) throw new Error(`Download failed (${r.status})`);
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  }
}

export default API;
