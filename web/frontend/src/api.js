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

class API {
  // Audit M11: no longer reads from localStorage at module load. Empty
  // by default; the cookie is the source of truth. AuthContext.logout()
  // sets this to '' on logout for completeness.
  static token = '';

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
    try {
      const r = await fetch(url, {
        credentials: 'include',
        ...options,
        signal: controller.signal,
      });
      return r;
    } catch (err) {
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
}

export default API;
