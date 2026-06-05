const crypto = require('crypto');
const os = require('os');
const vscode = require('vscode');

const ACCESS_TOKEN_KEY = 'rtk.accessToken';
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

  const response = await fetch(`${baseUrl}${path}`, {
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

async function loginWithMicrosoft(context) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    vscode.window.showErrorMessage('Set rtk.apiBaseUrl before logging in.');
    return;
  }

  const session = await vscode.authentication.getSession('microsoft', ['openid', 'profile', 'email', 'User.Read'], {
    createIfNone: true
  });
  const response = await fetch(`${baseUrl}/auth/microsoft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access_token: session.accessToken })
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    vscode.window.showErrorMessage(`RTK Microsoft login failed: ${body.detail || response.status}`);
    return;
  }
  await context.secrets.store(ACCESS_TOKEN_KEY, body.access_token);
  vscode.window.showInformationMessage('RTK Microsoft login completed.');
}

async function logout(context) {
  try {
    await request(context, '/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    // Local logout should still clear credentials if the backend is unavailable.
  }
  await context.secrets.delete(ACCESS_TOKEN_KEY);
  await context.globalState.update(INSTALL_ID_STATE, undefined);
  vscode.window.showInformationMessage('RTK logged out.');
}

async function ensureInstall(context) {
  let installKey = context.globalState.get(INSTALL_KEY_STATE);
  if (!installKey) {
    installKey = crypto.randomUUID();
    await context.globalState.update(INSTALL_KEY_STATE, installKey);
  }

  let installId = context.globalState.get(INSTALL_ID_STATE);
  if (installId) return installId;

  const extension = vscode.extensions.getExtension('rtk.rtk-token-savings');
  const body = await request(context, '/extension/installs', {
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
  const body = await request(context, '/rtk/sessions', {
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

async function syncSnapshot(context, snapshot, workspacePath) {
  if (!syncEnabled()) return;
  const token = await context.secrets.get(ACCESS_TOKEN_KEY);
  if (!token) return;
  if (!snapshot?.session?.id) return;

  const rtkSessionId = await ensureSession(context, snapshot, workspacePath);
  const session = snapshot.session;
  await request(context, '/rtk/usage/snapshots', {
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

  const events = (session.recentRuns || []).map((run) => eventFromRun(run, rtkSessionId));
  if (events.length) {
    await request(context, '/rtk/usage/events', {
      method: 'POST',
      body: JSON.stringify({ events })
    });
  }
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

  const rtkSessionId = await ensureSession(context, snapshot, workspacePath);
  const runs = snapshot.session.recentRuns || [];
  if (!runs.length) {
    vscode.window.showInformationMessage('No recent RTK runs found to import.');
    return;
  }
  const events = runs.map((run) => eventFromRun(run, rtkSessionId));
  const result = await request(context, '/rtk/usage/import', {
    method: 'POST',
    body: JSON.stringify({ events })
  });
  await context.globalState.update(importKey, true);
  vscode.window.showInformationMessage(`Imported RTK usage: ${result.inserted} new, ${result.duplicates} duplicates.`);
}

async function getAdminDashboardData(context) {
  const me = await request(context, '/auth/me');
  const organizationId = me.organization_id;
  const [summary, users] = await Promise.all([
    request(context, `/admin/orgs/${organizationId}/summary`),
    request(context, `/admin/orgs/${organizationId}/users`)
  ]);
  return {
    me,
    organizationId,
    summary,
    users: users.rows || []
  };
}

module.exports = {
  getAdminDashboardData,
  importExistingHistory,
  loginWithMicrosoft,
  logout,
  syncSnapshot
};
