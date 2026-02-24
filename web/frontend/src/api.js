class API {
  static token = localStorage.getItem('token') || '';

  static headers() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
  }

  static _handle401(r) {
    if (r.status === 401) { this.token = ''; localStorage.removeItem('token'); window.location.reload(); }
  }

  static async get(url) {
    const r = await fetch(url, { headers: this.headers() });
    this._handle401(r);
    return r.json();
  }

  static async post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(data) });
    this._handle401(r);
    return r.json();
  }

  static async patch(url, data) {
    const r = await fetch(url, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(data) });
    this._handle401(r);
    return r.json();
  }

  static async put(url, data) {
    const r = await fetch(url, { method: 'PUT', headers: this.headers(), body: JSON.stringify(data) });
    this._handle401(r);
    return r.json();
  }

  static async del(url) {
    const r = await fetch(url, { method: 'DELETE', headers: this.headers() });
    this._handle401(r);
    return r.json();
  }
}

export default API;
