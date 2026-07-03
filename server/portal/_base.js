// Shared JS for all portal pages — included inline in each page

const Sesshush = {
  token: null,

  async api(method, path, body) {
    if (!this.token) this.token = sessionStorage.getItem('sesshush_access_token');

    let res = await fetch('/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      // Try refresh
      const refresh = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (refresh.ok) {
        const data = await refresh.json();
        this.token = data.accessToken;
        sessionStorage.setItem('sesshush_access_token', data.accessToken);
        // Retry original request
        res = await fetch('/api' + path, {
          method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
          credentials: 'include',
          body: body ? JSON.stringify(body) : undefined,
        });
      } else {
        window.location.href = '/admin/login';
        return null;
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
  },

  get: (path) => Sesshush.api('GET', path),
  post: (path, body) => Sesshush.api('POST', path, body),
  put: (path, body) => Sesshush.api('PUT', path, body),
  delete: (path) => Sesshush.api('DELETE', path),

  fmt: {
    tokens: (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n||0),
    usd: (n) => '$' + (n||0).toFixed(2),
    date: (s) => s ? new Date(s).toLocaleDateString() : '—',
    datetime: (s) => s ? new Date(s).toLocaleString() : '—',
    pct: (n) => (n||0).toFixed(1) + '%',
  },

  badge: {
    role: { super_admin:'bg-purple-100 text-purple-700', admin:'bg-indigo-100 text-indigo-700', manager:'bg-blue-100 text-blue-700', user:'bg-gray-100 text-gray-700', read_only:'bg-gray-50 text-gray-500' },
    status: { active:'bg-green-100 text-green-700', disabled:'bg-red-100 text-red-700', invited:'bg-yellow-100 text-yellow-700', pending:'bg-orange-100 text-orange-700', removed:'bg-gray-100 text-gray-500' },
  },
};
