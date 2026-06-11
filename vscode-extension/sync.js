const crypto = require('crypto');
const os = require('os');
const vscode = require('vscode');

const ACCESS_TOKEN_KEY = 'rtk.accessToken';
const USER_NOT_REGISTERED_MESSAGE = 'Your account is not registered in the RTK Token Savings system. Please contact your manager or administrator to have your account added before using this extension.';
const USER_DISABLED_MESSAGE = 'Your account is currently disabled. Please contact your administrator.';
const INSTALL_KEY_STATE = 'rtk.installKey';
const INSTALL_ID_STATE = 'rtk.extensionInstallId';
const IMPORT_DONE_PREFIX = 'rtk.importDone.';

function config() {
  return vscode.workspace.getConfiguration('rtk');
}

function apiBaseUrl() {
  return String(config().get('apiBaseUrl', '') || '').replace(/\/+$/, '');
}

function syncEnabled() {
  return Boolean(config().get('syncEnabled', false));
}

function authRequired() {
  return Boolean(config().get('authRequired', false));
}

function parseResponseJson(text, url, response) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    const contentType = response.headers?.get?.('content-type') || 'unknown content type';
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    const detail = `Backend returned a non-JSON response from ${url}: HTTP ${response.status} ${response.statusText || ''} (${contentType}). ${snippet}`;
    const parseError = new Error(detail.trim());
    parseError.status = response.status;
    parseError.contentType = contentType;
    throw parseError;
  }
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stableEventId(run) {
  return hashValue([
    run.sessionId,
    run.timestamp,
    run.command,
    run.exitCode,
    run.durationMs,
    run.originalTokens,
    run.compressedTokens,
    run.savedTokens,
    run.truncated
  ].join('|'));
}

function snapshotHash(snapshot) {
  const session = snapshot?.session || {};
  return hashValue(JSON.stringify({
    id: session.id,
    runs: session.runs || 0,
    originalTokens: session.originalTokens || 0,
    compressedTokens: session.compressedTokens || 0,
    savedTokens: session.savedTokens || 0,
    updatedAt: session.updatedAt || null
  }));
}

function workspaceHash(workspacePath) {
  return hashValue(`${os.hostname()}:${workspacePath || ''}`);
}

async function request(context, path, options = {}) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error('rtk.apiBaseUrl is not configured.');
  const token = await context.secrets.get(ACCESS_TOKEN_KEY);
  if (!token) throw new Error('RTK is not logged in.');

  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = parseResponseJson(text, url, response);
  if (!response.ok) {
    const code = body.detail || body.error || `HTTP ${response.status}`;
    const error = new Error(code);
    error.code = code;
    error.status = response.status;
    throw error;
  }
  return body;
}

function loginErrorMessage(code) {
  if (code === 'USER_NOT_REGISTERED') return USER_NOT_REGISTERED_MESSAGE;
  if (code === 'USER_DISABLED') return USER_DISABLED_MESSAGE;
  if (code === 'ORG_NOT_CONFIGURED') return 'RTK Token Savings is not configured for your organization. Please contact your administrator.';
  if (code === 'AZURE_TOKEN_INVALID' || code === 'invalid_microsoft_token') return 'Microsoft login could not be verified. Please sign in again.';
  return `RTK Microsoft login failed: ${code}`;
}

async function hasAccessToken(context) {
  return Boolean(await context.secrets.get(ACCESS_TOKEN_KEY));
}

async function currentUser(context) {
  return request(context, '/api/me');
}

async function loginWithMicrosoft(context) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    vscode.window.showErrorMessage('Set rtk.apiBaseUrl before logging in.');
    return;
  }

  const session = await vscode.authentication.getSession('microsoft', ['openid', 'profile', 'email', 'User.Read'], {
    createIfNone: true
  });
  const url = `${baseUrl}/api/auth/microsoft/verify`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access_token: session.accessToken })
  });
  const text = await response.text();
  const body = parseResponseJson(text, url, response);
  if (!response.ok) {
    await context.secrets.delete(ACCESS_TOKEN_KEY);
    await context.globalState.update(INSTALL_ID_STATE, undefined);
    vscode.window.showErrorMessage(loginErrorMessage(body.detail || body.error || response.status));
    return;
  }
  await context.secrets.store(ACCESS_TOKEN_KEY, body.access_token);
  vscode.window.showInformationMessage('RTK Microsoft login completed.');
  return body;
}

async function logout(context) {
  try {
    await request(context, '/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    // Local logout should still clear credentials if the backend is unavailable.
  }
  await context.secrets.delete(ACCESS_TOKEN_KEY);
  await context.globalState.update(INSTALL_ID_STATE, undefined);
  vscode.window.showInformationMessage('RTK logged out.');
}

async function ensureAuthenticated(context, interactive = false) {
  if (!apiBaseUrl()) {
    if (authRequired()) vscode.window.showErrorMessage('Set rtk.apiBaseUrl before using RTK Token Savings authentication.');
    return false;
  }

  if (await hasAccessToken(context)) {
    try {
      await currentUser(context);
      return true;
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) {
        return !authRequired();
      }
      await context.secrets.delete(ACCESS_TOKEN_KEY);
      await context.globalState.update(INSTALL_ID_STATE, undefined);
      if (error.code === 'USER_DISABLED') {
        vscode.window.showErrorMessage(USER_DISABLED_MESSAGE);
        return false;
      }
    }
  }

  if (!authRequired() && !interactive) return false;
  const choice = interactive
    ? 'Sign in'
    : await vscode.window.showInformationMessage('Sign in with Microsoft to use RTK Token Savings for your organization.', 'Sign in', 'Not now');
  if (choice !== 'Sign in') return false;
  return Boolean(await loginWithMicrosoft(context));
}

async function ensureInstall(context) {
  let installKey = context.globalState.get(INSTALL_KEY_STATE);
  if (!installKey) {
    installKey = crypto.randomUUID();
    await context.globalState.update(INSTALL_KEY_STATE, installKey);
  }

  let installId = context.globalState.get(INSTALL_ID_STATE);
  if (installId) return installId;

  const extension = vscode.extensions.getExtension('rtk.savytox');
  const body = await request(context, '/api/extension/installs', {
    method: 'POST',
    body: JSON.stringify({
      install_key: installKey,
      vscode_version: vscode.version,
      extension_version: extension?.packageJSON?.version || '0.1.0',
      machine_hash: hashValue(os.hostname())
    })
  });
  installId = body.id;
  await context.globalState.update(INSTALL_ID_STATE, installId);
  return installId;
}

async function ensureSession(context, snapshot, workspacePath) {
  const installId = await ensureInstall(context);
  const session = snapshot?.session || {};
  const body = await request(context, '/api/extension/rtk/sessions', {
    method: 'POST',
    body: JSON.stringify({
      extension_install_id: installId,
      client_session_id: session.id,
      workspace_hash: workspaceHash(workspacePath),
      label: session.label || null,
      started_at: session.startedAt || null,
      ended_at: null
    })
  });
  return body.id;
}

async function ensureRunSession(context, run, fallbackSnapshot, workspacePath) {
  const installId = await ensureInstall(context);
  const fallbackSession = fallbackSnapshot?.session || {};
  const clientSessionId = run.sessionId || fallbackSession.id;
  if (!clientSessionId) return null;

  const body = await request(context, '/api/extension/rtk/sessions', {
    method: 'POST',
    body: JSON.stringify({
      extension_install_id: installId,
      client_session_id: clientSessionId,
      workspace_hash: workspaceHash(clientSessionId || workspacePath),
      label: run.sessionLabel || fallbackSession.label || null,
      started_at: clientSessionId === fallbackSession.id ? fallbackSession.startedAt || null : null,
      ended_at: null
    })
  });
  return body.id;
}

function eventFromRun(run, rtkSessionId) {
  return {
    rtk_session_id: rtkSessionId,
    client_event_id: stableEventId(run),
    command: run.command || null,
    occurred_at: run.timestamp || new Date().toISOString(),
    exit_code: typeof run.exitCode === 'number' ? run.exitCode : null,
    duration_ms: typeof run.durationMs === 'number' ? run.durationMs : null,
    original_tokens: Math.max(0, run.originalTokens || 0),
    compressed_tokens: Math.max(0, run.compressedTokens || 0),
    saved_tokens: Math.max(0, (run.originalTokens || 0) - (run.compressedTokens || 0)),
    truncated: Boolean(run.truncated)
  };
}

async function syncRuns(context, runs, snapshot, workspacePath) {
  const events = [];
  const sessionIds = new Map();
  for (const run of runs) {
    const clientSessionId = run.sessionId || snapshot?.session?.id;
    if (!clientSessionId) continue;
    let rtkSessionId = sessionIds.get(clientSessionId);
    if (!rtkSessionId) {
      rtkSessionId = await ensureRunSession(context, run, snapshot, workspacePath);
      if (!rtkSessionId) continue;
      sessionIds.set(clientSessionId, rtkSessionId);
    }
    events.push(eventFromRun(run, rtkSessionId));
  }

  if (events.length) {
    await request(context, '/api/extension/usage/event', {
      method: 'POST',
      body: JSON.stringify({ events })
    });
  }
}

async function syncSnapshot(context, snapshot, workspacePath) {
  if (!syncEnabled()) return;
  if (!(await hasAccessToken(context))) return;
  if (!snapshot?.session?.id) return;

  const rtkSessionId = await ensureSession(context, snapshot, workspacePath);
  const session = snapshot.session;
  await request(context, '/api/extension/usage/snapshot', {
    method: 'POST',
    body: JSON.stringify({
      rtk_session_id: rtkSessionId,
      snapshot_hash: snapshotHash(snapshot),
      observed_at: new Date().toISOString(),
      runs: session.runs || 0,
      original_tokens: session.originalTokens || 0,
      compressed_tokens: session.compressedTokens || 0,
      saved_tokens: Math.max(0, (session.originalTokens || 0) - (session.compressedTokens || 0)),
      raw_summary: {
        session: {
          id: session.id,
          label: session.label,
          runs: session.runs || 0,
          originalTokens: session.originalTokens || 0,
          compressedTokens: session.compressedTokens || 0,
          savedTokens: session.savedTokens || 0,
          startedAt: session.startedAt || null,
          updatedAt: session.updatedAt || null
        }
      }
    })
  });

  const runs = snapshot.total?.recentRuns?.length ? snapshot.total.recentRuns : session.recentRuns || [];
  await syncRuns(context, runs, snapshot, workspacePath);
}

async function importExistingHistory(context, snapshot, workspacePath) {
  if (!syncEnabled()) {
    vscode.window.showInformationMessage('Enable rtk.syncEnabled before importing RTK usage.');
    return;
  }
  const token = await context.secrets.get(ACCESS_TOKEN_KEY);
  if (!token) {
    vscode.window.showInformationMessage('Run RTK: Login with Microsoft before importing usage.');
    return;
  }
  if (!snapshot?.session?.id) {
    vscode.window.showInformationMessage('No RTK session data is available to import.');
    return;
  }
  const importKey = `${IMPORT_DONE_PREFIX}${snapshot.session.id}`;
  if (context.globalState.get(importKey)) {
    vscode.window.showInformationMessage('This RTK session history was already imported.');
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    'Import existing local RTK usage history for this session? Command names will be anonymized by the backend.',
    'Import',
    'Cancel'
  );
  if (choice !== 'Import') return;

  const runs = snapshot.total?.recentRuns?.length ? snapshot.total.recentRuns : snapshot.session.recentRuns || [];
  if (!runs.length) {
    vscode.window.showInformationMessage('No recent RTK runs found to import.');
    return;
  }
  await syncRuns(context, runs, snapshot, workspacePath);
  await context.globalState.update(importKey, true);
  vscode.window.showInformationMessage(`Imported RTK usage history from ${runs.length} recent runs.`);
}

async function getAdminDashboardData(context) {
  const me = await request(context, '/api/me');
  const organizationId = me.organization_id;
  const [summary, usageUsers, adminUsers, syncStatus] = await Promise.all([
    request(context, '/api/dashboard/summary'),
    request(context, '/api/dashboard/users'),
    request(context, '/api/admin/users').catch(() => ({ rows: [] })),
    request(context, '/api/admin/azure-ad/sync-status').catch(() => ({ last_run: null }))
  ]);
  const azureSettings = await request(context, '/api/admin/azure-ad/settings').catch((error) => {
    if (error.code === 'AZURE_AD_SETTINGS_NOT_FOUND') return null;
    throw error;
  });
  return {
    me,
    organizationId,
    summary,
    users: usageUsers.rows || [],
    adminUsers: adminUsers.rows || [],
    azureSettings,
    syncStatus
  };
}

async function saveAzureAdSettings(context, settings) {
  return request(context, '/api/admin/azure-ad/settings', {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
}

async function deleteAzureAdSettings(context) {
  return request(context, '/api/admin/azure-ad/settings', {
    method: 'DELETE'
  });
}

async function testAzureAdConnection(context) {
  return request(context, '/api/admin/azure-ad/test', {
    method: 'POST',
    body: '{}'
  });
}

async function syncAzureAdUsers(context) {
  return request(context, '/api/admin/azure-ad/sync-users', {
    method: 'POST',
    body: '{}'
  });
}

async function getAzureAdSyncStatus(context) {
  return request(context, '/api/admin/azure-ad/sync-status');
}

async function getAdminUsers(context) {
  const users = await request(context, '/api/admin/users');
  return users.rows || [];
}

module.exports = {
  deleteAzureAdSettings,
  getAdminDashboardData,
  getAdminUsers,
  getAzureAdSyncStatus,
  ensureAuthenticated,
  hasAccessToken,
  importExistingHistory,
  loginWithMicrosoft,
  logout,
  saveAzureAdSettings,
  syncAzureAdUsers,
  testAzureAdConnection,
  syncSnapshot
};
