const REQUEST_TIMEOUT_MS = 30000;

class API {
  static token = localStorage.getItem('token') || '';

  static headers() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
  }

  static _handle401(r) {
    if (r.status === 401) {
      this.token = '';
      localStorage.removeItem('token');
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
   */
  static async _fetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      return r;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Request timed out');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  static async get(url) {
    const r = await this._fetch(url, { headers: this.headers() });
    return this._parseResponse(r);
  }

  static async post(url, data) {
    const r = await this._fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(data) });
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
