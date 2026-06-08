import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CheckCircle2,
  DownloadCloud,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  UserPlus,
  Users
} from 'lucide-react';
import './styles.css';

const defaultRules = {
  CEO: 'EXECUTIVE',
  Chief: 'EXECUTIVE',
  Director: 'EXECUTIVE',
  VP: 'EXECUTIVE',
  'Vice President': 'EXECUTIVE',
  Head: 'EXECUTIVE',
  Manager: 'DEPARTMENT_MANAGER',
  Lead: 'DEPARTMENT_MANAGER',
  Engineer: 'EMPLOYEE',
  Developer: 'EMPLOYEE'
};

const storageKeys = {
  apiBaseUrl: 'rtk.admin.apiBaseUrl',
  token: 'rtk.admin.token'
};

const runtimeConfig = window.RTK_ADMIN_CONFIG || {};

function readJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(
    localStorage.getItem(storageKeys.apiBaseUrl) || runtimeConfig.apiBaseUrl || 'http://127.0.0.1:8000'
  );
  const [token, setToken] = useState(localStorage.getItem(storageKeys.token) || '');
  const [loginEmail, setLoginEmail] = useState('rtk@hazentech.com');
  const [loginPassword, setLoginPassword] = useState('Admin@123456');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState(null);
  const [settings, setSettings] = useState(null);
  const [summary, setSummary] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [users, setUsers] = useState([]);
  const [usageUsers, setUsageUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [userForm, setUserForm] = useState({
    username: '',
    email: '',
    display_name: '',
    department_id: '',
    role: 'EMPLOYEE'
  });
  const [form, setForm] = useState({
    tenant_id: '',
    client_id: '',
    client_secret_ref: 'AZURE_AD_CLIENT_SECRET',
    encrypted_client_secret: '',
    enabled: true,
    role_mapping_rules: JSON.stringify(defaultRules, null, 2)
  });

  const isConfigured = Boolean(apiBaseUrl && token);
  const numberFormat = useMemo(() => new Intl.NumberFormat(), []);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const client = useMemo(() => {
    const base = apiBaseUrl.replace(/\/+$/, '');
    async function request(path, options = {}) {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          ...(options.headers || {})
        }
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(body.detail || body.error || `HTTP ${response.status}`);
      }
      return body;
    }
    return { request };
  }, [apiBaseUrl, token]);

  function persistConnection() {
    localStorage.setItem(storageKeys.apiBaseUrl, apiBaseUrl);
    localStorage.setItem(storageKeys.token, token);
    setMessage('Connection settings saved in this browser.');
  }

  async function passwordLogin() {
    setLoading(true);
    try {
      const base = apiBaseUrl.replace(/\/+$/, '');
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
      setToken(body.access_token);
      localStorage.setItem(storageKeys.apiBaseUrl, apiBaseUrl);
      localStorage.setItem(storageKeys.token, body.access_token);
      setMessage('Login succeeded.');
      setTimeout(() => loadAll(), 0);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function updateFormFromSettings(nextSettings) {
    if (!nextSettings) {
      setForm({
        tenant_id: '',
        client_id: '',
        client_secret_ref: 'AZURE_AD_CLIENT_SECRET',
        encrypted_client_secret: '',
        enabled: true,
        role_mapping_rules: JSON.stringify(defaultRules, null, 2)
      });
      return;
    }
    setForm({
      tenant_id: nextSettings.tenant_id || '',
      client_id: nextSettings.client_id || '',
      client_secret_ref: nextSettings.client_secret_ref || 'AZURE_AD_CLIENT_SECRET',
      encrypted_client_secret: '',
      enabled: nextSettings.enabled !== false,
      role_mapping_rules: JSON.stringify(nextSettings.role_mapping_rules || defaultRules, null, 2)
    });
  }

  async function loadAll() {
    if (!isConfigured) return;
    setLoading(true);
    setMessage('');
    try {
      const [meData, summaryData, usageData, usersData, rolesData, departmentsData, syncData, auditData] = await Promise.all([
        client.request('/api/me'),
        client.request('/api/dashboard/summary'),
        client.request('/api/dashboard/users'),
        client.request('/api/admin/users'),
        client.request('/api/admin/roles').catch(() => ({ rows: [] })),
        client.request('/api/admin/departments').catch(() => ({ rows: [] })),
        client.request('/api/admin/azure-ad/sync-status').catch(() => ({ last_run: null })),
        client.request('/api/admin/audit-logs').catch(() => ({ rows: [] }))
      ]);
      const settingsData = await client
        .request('/api/admin/azure-ad/settings')
        .catch((error) => {
          if (error.message === 'AZURE_AD_SETTINGS_NOT_FOUND') return null;
          throw error;
        });
      setMe(meData);
      setSummary(summaryData);
      setUsageUsers(usageData.rows || []);
      setUsers(usersData.rows || []);
      setRoles(rolesData.rows || []);
      setDepartments((departmentsData.rows || []).filter((department) => !department.disabled_at));
      setSyncStatus(syncData.last_run);
      setAuditLogs(auditData.rows || []);
      setSettings(settingsData);
      updateFormFromSettings(settingsData);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveSettings() {
    setLoading(true);
    try {
      const body = {
        tenant_id: form.tenant_id.trim(),
        client_id: form.client_id.trim() || null,
        client_secret_ref: form.client_secret_ref.trim() || null,
        encrypted_client_secret: form.encrypted_client_secret.trim() || null,
        enabled: form.enabled,
        role_mapping_rules: readJson(form.role_mapping_rules, null)
      };
      if (body.encrypted_client_secret) body.client_secret_ref = null;
      if (!body.role_mapping_rules) throw new Error('Role mapping rules must be valid JSON.');
      await client.request('/api/admin/azure-ad/settings', {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      setMessage('Azure AD settings saved.');
      await loadAll();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSettings() {
    if (!window.confirm('Delete Azure AD settings for this organization?')) return;
    setLoading(true);
    try {
      await client.request('/api/admin/azure-ad/settings', { method: 'DELETE' });
      setMessage('Azure AD settings deleted.');
      await loadAll();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function testConnection() {
    setLoading(true);
    try {
      await client.request('/api/admin/azure-ad/test', { method: 'POST', body: '{}' });
      setMessage('Azure AD connection succeeded.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function syncUsers() {
    setLoading(true);
    try {
      const result = await client.request('/api/admin/azure-ad/sync-users', {
        method: 'POST',
        body: '{}'
      });
      setMessage(
        `Sync ${result.status}: ${result.imported_users || 0} imported, ${result.updated_users || 0} updated.`
      );
      await loadAll();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function createUser() {
    setLoading(true);
    try {
      const body = {
        username: userForm.username.trim(),
        email: userForm.email.trim(),
        display_name: userForm.display_name.trim() || userForm.username.trim(),
        department_id: userForm.department_id || null,
        role: userForm.role
      };
      if (!body.username || !body.email || !body.department_id || !body.role) {
        throw new Error('Username, email, department, and role are required.');
      }
      await client.request('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setUserForm({
        username: '',
        email: '',
        display_name: '',
        department_id: '',
        role: roles.find((role) => role.key !== 'SUPER_ADMIN')?.key || 'EMPLOYEE'
      });
      setMessage('User created.');
      await loadAll();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand">
          <Shield size={22} />
          <span>RTK Admin</span>
        </div>
        <nav>
          <a href="#connection">Connection</a>
          <a href="#azure">Azure AD</a>
          <a href="#usage">Usage</a>
          <a href="#users">Users</a>
          <a href="#audit">Audit</a>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>Super Admin Console</h1>
            <p>{me ? `${me.email} - ${me.roles?.join(', ') || 'No role'}` : 'Login with the seeded Super Admin account.'}</p>
          </div>
          <button onClick={loadAll} disabled={loading || !isConfigured}>
            <RefreshCw size={16} /> Refresh
          </button>
        </header>

        {message ? <div className="notice">{message}</div> : null}

        <section id="connection" className="panel">
          <div className="section-head">
            <h2>Backend Connection</h2>
            <p>Use the seeded Super Admin credentials, or paste an existing backend app session token.</p>
          </div>
          <div className="grid two">
            <label>
              API Base URL
              <input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
            </label>
            <label>
              Super Admin Email
              <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
            </label>
            <label>
              Super Admin Password
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
            </label>
            <label className="wide">
              App Session Token
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Bearer token value only"
              />
            </label>
          </div>
          <div className="actions">
            <button onClick={passwordLogin} disabled={loading || !apiBaseUrl || !loginEmail || !loginPassword}>
              <Shield size={16} /> Login
            </button>
            <button onClick={persistConnection}>
              <Save size={16} /> Save Locally
            </button>
            <button onClick={loadAll} disabled={!isConfigured || loading}>
              <CheckCircle2 size={16} /> Connect
            </button>
          </div>
        </section>

        <section className="stats">
          <div>
            <span>Users</span>
            <strong>{numberFormat.format(summary?.active_users ?? 0)}</strong>
          </div>
          <div>
            <span>Sessions</span>
            <strong>{numberFormat.format(summary?.sessions ?? 0)}</strong>
          </div>
          <div>
            <span>Runs</span>
            <strong>{numberFormat.format(summary?.runs ?? 0)}</strong>
          </div>
          <div>
            <span>Saved Tokens</span>
            <strong>{numberFormat.format(summary?.saved_tokens ?? 0)}</strong>
          </div>
        </section>

        <section id="azure" className="panel">
          <div className="section-head">
            <h2>Azure AD Settings</h2>
            <p>Use either a backend environment variable name or paste a secret value directly.</p>
          </div>
          <div className="grid two">
            <label>
              Tenant ID
              <input
                value={form.tenant_id}
                onChange={(event) => setForm({ ...form, tenant_id: event.target.value })}
              />
            </label>
            <label>
              Client ID
              <input
                value={form.client_id}
                onChange={(event) => setForm({ ...form, client_id: event.target.value })}
              />
            </label>
            <label>
              Client Secret Env Var
              <input
                value={form.client_secret_ref}
                onChange={(event) => setForm({ ...form, client_secret_ref: event.target.value })}
                placeholder="AZURE_AD_CLIENT_SECRET"
                disabled={Boolean(form.encrypted_client_secret)}
              />
            </label>
            <label>
              Client Secret Value
              <input
                type="password"
                value={form.encrypted_client_secret}
                onChange={(event) => setForm({ ...form, encrypted_client_secret: event.target.value })}
                placeholder={settings ? 'Leave blank to keep using the saved env var' : 'Paste client secret value'}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              Enabled
            </label>
            <label className="wide">
              Role Mapping Rules JSON
              <textarea
                value={form.role_mapping_rules}
                onChange={(event) => setForm({ ...form, role_mapping_rules: event.target.value })}
              />
            </label>
          </div>
          <div className="actions">
            <button onClick={saveSettings} disabled={loading || !isConfigured}>
              <Save size={16} /> Save Settings
            </button>
            <button onClick={testConnection} disabled={loading || !settings}>
              <CheckCircle2 size={16} /> Test Connection
            </button>
            <button onClick={syncUsers} disabled={loading || !settings}>
              <DownloadCloud size={16} /> Fetch Users
            </button>
            <button className="danger" onClick={deleteSettings} disabled={loading || !settings}>
              <Trash2 size={16} /> Delete Settings
            </button>
          </div>
          <p className="muted">Last sync: {syncStatus ? `${syncStatus.status} - ${syncStatus.id}` : 'none'}</p>
        </section>

        <section id="usage" className="panel">
          <div className="section-head">
            <h2>User Usage History</h2>
            <p>RTK sessions and token savings for every user visible to this account.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Department</th>
                  <th>Sessions</th>
                  <th>Runs</th>
                  <th>Original Tokens</th>
                  <th>Compressed Tokens</th>
                  <th>Saved Tokens</th>
                </tr>
              </thead>
              <tbody>
                {usageUsers.length ? (
                  usageUsers.map((usage) => {
                    const user = usersById.get(usage.user_id);
                    return (
                      <tr key={usage.user_id}>
                        <td>
                          <strong>{user?.display_name || user?.username || usage.email}</strong>
                          <span className="subtext">{usage.email}</span>
                        </td>
                        <td>{user?.departments?.map((department) => department.name).join(', ') || ''}</td>
                        <td>{numberFormat.format(usage.sessions ?? 0)}</td>
                        <td>{numberFormat.format(usage.runs ?? 0)}</td>
                        <td>{numberFormat.format(usage.original_tokens ?? 0)}</td>
                        <td>{numberFormat.format(usage.compressed_tokens ?? 0)}</td>
                        <td>{numberFormat.format(usage.saved_tokens ?? 0)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="7">No usage history loaded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="users" className="panel">
          <div className="section-head">
            <h2>Users</h2>
            <p>Users imported from Azure AD or created by admins.</p>
          </div>
          <div className="grid two user-create">
            <label>
              Username
              <input
                value={userForm.username}
                onChange={(event) => setUserForm({ ...userForm, username: event.target.value })}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={userForm.email}
                onChange={(event) => setUserForm({ ...userForm, email: event.target.value })}
              />
            </label>
            <label>
              Display Name
              <input
                value={userForm.display_name}
                onChange={(event) => setUserForm({ ...userForm, display_name: event.target.value })}
              />
            </label>
            <label>
              Department
              <select
                value={userForm.department_id}
                onChange={(event) => setUserForm({ ...userForm, department_id: event.target.value })}
              >
                <option value="">Select department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Role
              <select
                value={userForm.role}
                onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}
              >
                {roles
                  .filter((role) => role.key !== 'SUPER_ADMIN')
                  .map((role) => (
                    <option key={role.id} value={role.key}>
                      {role.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button
              onClick={createUser}
              disabled={loading || !isConfigured || !userForm.username || !userForm.email || !userForm.department_id}
            >
              <UserPlus size={16} /> Add User
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Roles</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.length ? (
                  users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username || ''}</td>
                      <td>{user.email}</td>
                      <td>{user.display_name || ''}</td>
                      <td>{user.departments?.map((department) => department.name).join(', ') || ''}</td>
                      <td>{user.roles?.join(', ') || ''}</td>
                      <td>{user.disabled_at ? 'disabled' : user.status}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6">No users loaded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="audit" className="panel">
          <div className="section-head">
            <h2>Audit Logs</h2>
            <p>Recent Super Admin and admin actions.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length ? (
                  auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{log.action}</td>
                      <td>{log.target_type || ''}</td>
                      <td>{log.created_at}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3">No audit logs loaded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
