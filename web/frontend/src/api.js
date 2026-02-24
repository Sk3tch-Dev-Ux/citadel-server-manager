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
      window.location.reload();
      throw new Error('Session expired');
    }
  }

  static async _parseResponse(r) {
    this._handle401(r);
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      // Response wasn't JSON (e.g. HTML error page)
      return { error: `Server error (${r.status}): ${text.substring(0, 200)}` };
    }
  }

  static async get(url) {
    const r = await fetch(url, { headers: this.headers() });
    return this._parseResponse(r);
  }

  static async post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(data) });
    return this._parseResponse(r);
  }

  static async patch(url, data) {
    const r = await fetch(url, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(data) });
    return this._parseResponse(r);
  }

  static async put(url, data) {
    const r = await fetch(url, { method: 'PUT', headers: this.headers(), body: JSON.stringify(data) });
    return this._parseResponse(r);
  }

  static async del(url) {
    const r = await fetch(url, { method: 'DELETE', headers: this.headers() });
    return this._parseResponse(r);
  }
}

export default API;
