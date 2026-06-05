const vscode = require('vscode');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getAdminDashboardData,
  importExistingHistory,
  loginWithMicrosoft,
  logout,
  syncSnapshot
} = require('./sync');

let statusItem;
let refreshTimer;
let sessionId;
let sessionLabel;
let dashboardPanel;
let adminPanel;
let lastSnapshot;
let lastError;
let lastSyncAt = 0;
let syncInFlight = false;
let followWorkspaceSession = true;

function workspaceCwd() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
}

function config() {
  return vscode.workspace.getConfiguration('rtk');
}

function makeSessionId() {
  return `rtk-vscode-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function workspaceSessionId() {
  return `${os.userInfo().username}:${workspaceCwd()}`;
}

function workspaceSessionLabel() {
  return `Workspace ${path.basename(workspaceCwd())}`;
}

function useWorkspaceSession() {
  sessionId = workspaceSessionId();
  sessionLabel = workspaceSessionLabel();
}

function nodeCommand() {
  const exe = path.basename(process.execPath).toLowerCase();
  return exe === 'node' || exe === 'node.exe' ? process.execPath : 'node';
}

function formatTokens(tokens) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function rtkEnv() {
  const npmGlobal = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const pathValue = process.env[pathKey] || '';
  const nextPath = process.platform === 'win32' && !pathValue.includes(npmGlobal)
    ? `${npmGlobal};${pathValue}`
    : pathValue;

  return {
    ...process.env,
    [pathKey]: nextPath,
    RTK_SESSION_ID: sessionId,
    RTK_SESSION_LABEL: sessionLabel
  };
}

function commandCandidates() {
  const configuredCommand = config().get('command', '');
  const candidates = [];
  const push = (command, argsPrefix = []) => {
    if (!candidates.some((candidate) => candidate.command === command && candidate.argsPrefix.join('\0') === argsPrefix.join('\0'))) {
      candidates.push({ command, argsPrefix });
    }
  };

  if (configuredCommand) push(configuredCommand);

  const bundledCli = path.join(__dirname, 'bin', 'rtk-node.js');
  if (fs.existsSync(bundledCli)) push(nodeCommand(), [bundledCli]);

  if (process.platform === 'win32') {
    push('rtk-node.cmd');
    push(path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'rtk-node.cmd'));
  } else {
    push('rtk-node');
  }

  const localCli = path.join(workspaceCwd(), 'bin', 'rtk-node.js');
  if (fs.existsSync(localCli)) push(nodeCommand(), [localCli]);

  return candidates;
}

function bundledCliCommand() {
  const bundledCli = path.join(__dirname, 'bin', 'rtk-node.js');
  if (fs.existsSync(bundledCli)) {
    return commandLine([nodeCommand(), bundledCli]);
  }
  return commandLine([process.platform === 'win32' ? 'rtk-node.cmd' : 'rtk-node']);
}

function needsShellQuoting(value) {
  return /[\s"'`&|<>()@^]/.test(value);
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function posixQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandLine(parts) {
  if (process.platform === 'win32') {
    const [command, ...args] = parts;
    const formattedCommand = needsShellQuoting(command) ? `& ${powershellQuote(command)}` : command;
    const formattedArgs = args.map((arg) => needsShellQuoting(arg) ? powershellQuote(arg) : arg);
    return [formattedCommand, ...formattedArgs].join(' ');
  }

  return parts.map((part) => needsShellQuoting(part) ? posixQuote(part) : part).join(' ');
}

function execRtkCandidate(candidate) {
  return new Promise((resolve, reject) => {
    execFile(candidate.command, [...candidate.argsPrefix, 'status', '--json'], {
      cwd: workspaceCwd(),
      env: rtkEnv(),
      windowsHide: true,
      timeout: 5000
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function runRtkStatus() {
  const errors = [];
  for (const candidate of commandCandidates()) {
    try {
      return await execRtkCandidate(candidate);
    } catch (error) {
      errors.push(`${candidate.command}: ${error.message}`);
    }
  }
  throw new Error(errors.join('\n'));
}

async function refreshStatus() {
  if (!statusItem) return;
  if (followWorkspaceSession && config().get('followWorkspacePath', true) && sessionId !== workspaceSessionId()) {
    useWorkspaceSession();
    await contextStateSet();
  }

  try {
    const snapshot = await runRtkStatus();
    lastSnapshot = snapshot;
    lastError = null;
    maybeSyncSnapshot(snapshot);
    const showTotal = config().get('showTotalWhenNoSession', true);
    const source = snapshot.session.runs || !showTotal ? snapshot.session : snapshot.total;
    const label = snapshot.session.runs || !showTotal ? 'session' : 'total';

    statusItem.text = `RTK $(zap) ${formatTokens(source.savedTokens)} saved`;
    statusItem.tooltip = [
      `RTK token savings (${label})`,
      `Saved: ${source.savedTokens} tokens (${source.savedPercent.toFixed(1)}%)`,
      `Original: ${source.originalTokens} tokens`,
      `Compressed: ${source.compressedTokens} tokens`,
      `Runs: ${source.runs}`,
      `Session: ${sessionLabel}`
    ].join('\n');
    statusItem.command = 'rtk.openDashboard';
    statusItem.show();
    updateDashboard();
  } catch (error) {
    lastError = error;
    statusItem.text = 'RTK unavailable';
    statusItem.tooltip = `Unable to run RTK status: ${error.message}`;
    statusItem.command = 'rtk.openDashboard';
    statusItem.show();
    updateDashboard();
  }
}

async function maybeSyncSnapshot(snapshot, force = false) {
  if (syncInFlight) return;
  const interval = config().get('syncIntervalMs', 30000);
  const now = Date.now();
  if (!force && now - lastSyncAt < interval) return;
  syncInFlight = true;
  try {
    await syncSnapshot(extensionContext, snapshot, workspaceCwd());
    lastSyncAt = now;
  } catch (error) {
    lastError = error;
  } finally {
    syncInFlight = false;
  }
}

function startTimer(context) {
  if (refreshTimer) clearInterval(refreshTimer);
  const interval = config().get('refreshIntervalMs', 3000);
  refreshTimer = setInterval(refreshStatus, interval);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
}

async function newSession() {
  followWorkspaceSession = false;
  sessionId = makeSessionId();
  sessionLabel = `VS Code ${new Date().toLocaleTimeString()}`;
  await contextStateSet();
  await refreshStatus();
  vscode.window.showInformationMessage(`RTK session started: ${sessionLabel}`);
}

async function resetToWorkspaceSession() {
  followWorkspaceSession = true;
  useWorkspaceSession();
  await contextStateSet();
  await refreshStatus();
}

async function contextStateSet() {
  await vscode.commands.executeCommand('setContext', 'rtk.sessionId', sessionId);
}

function bundledCliPath() {
  return path.join(__dirname, 'bin', 'rtk-node.js');
}

function installShellHook() {
  return new Promise((resolve, reject) => {
    const bundledCli = bundledCliPath();
    if (!fs.existsSync(bundledCli)) {
      reject(new Error('Bundled RTK CLI was not found in the extension.'));
      return;
    }

    const rtkCommand = bundledCliCommand();
    execFile(nodeCommand(), [bundledCli, 'init', '-g', '--hook-only', '--command', rtkCommand], {
      cwd: workspaceCwd(),
      env: rtkEnv(),
      windowsHide: true,
      timeout: 5000
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function enableAutoWrap() {
  try {
    const output = await installShellHook();
    await refreshStatus();
    vscode.window.showInformationMessage(`RTK automatic terminal wrapping enabled. Restart terminals to use it. ${output}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Unable to enable RTK automatic terminal wrapping: ${error.message}`);
  }
}

async function maybePromptAutoWrap(context) {
  if (!config().get('autoWrapTerminals', true)) return;
  if (context.globalState.get('autoWrapPrompted')) return;
  await context.globalState.update('autoWrapPrompted', true);

  const choice = await vscode.window.showInformationMessage(
    'Enable RTK automatic wrapping for noisy terminal commands like git, rg, npm, pytest, ls, find, and cat?',
    'Enable',
    'Not now'
  );
  if (choice === 'Enable') await enableAutoWrap();
}

async function startAgentTerminal() {
  const defaultCommand = config().get('defaultAgentCommand', 'codex');
  const command = await vscode.window.showInputBox({
    title: 'RTK: Start Agent Terminal',
    prompt: 'Agent command to run with RTK session tracking',
    value: defaultCommand
  });
  if (!command) return;

  if (!sessionId) {
    sessionId = makeSessionId();
    sessionLabel = `VS Code ${new Date().toLocaleTimeString()}`;
    await contextStateSet();
  }

  const terminal = vscode.window.createTerminal({
    name: `RTK Agent: ${command}`,
    cwd: workspaceCwd(),
    env: {
      RTK_SESSION_ID: sessionId,
      RTK_SESSION_LABEL: sessionLabel
    }
  });
  terminal.show();
  terminal.sendText(`${bundledCliCommand()} agent ${command}`);
  await refreshStatus();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPercent(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '0.0%';
}

function formatDuration(value) {
  if (typeof value !== 'number') return '';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value.toFixed(1)}ms`;
}

function commandRows(commands = {}) {
  const rows = Object.entries(commands)
    .sort(([, a], [, b]) => (b.savedTokens || 0) - (a.savedTokens || 0))
    .slice(0, 8);

  if (!rows.length) {
    return '<tr><td colspan="4" class="empty">No command data yet.</td></tr>';
  }

  return rows.map(([command, stat]) => `
    <tr>
      <td>${escapeHtml(command)}</td>
      <td>${escapeHtml(stat.runs || 0)}</td>
      <td>${escapeHtml(formatTokens(stat.savedTokens || 0))}</td>
      <td>${escapeHtml(formatPercent(stat.originalTokens ? ((stat.savedTokens || 0) / stat.originalTokens) * 100 : 0))}</td>
    </tr>
  `).join('');
}

function recentRunRows(runs = []) {
  if (!runs.length) {
    return '<tr><td colspan="6" class="empty">No recent runs in this session.</td></tr>';
  }

  return runs.slice(0, 12).map((run) => `
    <tr>
      <td>${escapeHtml(run.command)}</td>
      <td>${escapeHtml(run.exitCode ?? '')}</td>
      <td>${escapeHtml(formatDuration(run.durationMs))}</td>
      <td>${escapeHtml(formatTokens(run.savedTokens || 0))}</td>
      <td>${escapeHtml(run.truncated ? 'yes' : 'no')}</td>
      <td>${escapeHtml(run.timestamp ? new Date(run.timestamp).toLocaleTimeString() : '')}</td>
    </tr>
  `).join('');
}

function metric(label, value, detail = '') {
  return `
    <section class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${detail ? `<div class="metric-detail">${escapeHtml(detail)}</div>` : ''}
    </section>
  `;
}

function dashboardHtml(snapshot, error) {
  const session = snapshot?.session || {};
  const total = snapshot?.total || {};
  const showTotal = config().get('showTotalWhenNoSession', true);
  const tableSource = session.runs || !showTotal ? session : total;
  const tableLabel = session.runs || !showTotal ? 'Session' : 'Total';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RTK Dashboard</title>
  <style>
    body {
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      margin: 0;
      padding: 20px;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1, h2 {
      font-weight: 600;
      margin: 0;
    }
    h1 {
      font-size: 20px;
    }
    h2 {
      font-size: 14px;
      margin-bottom: 10px;
    }
    .subtitle {
      color: var(--vscode-descriptionForeground);
      margin-top: 6px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }
    .metric {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      min-width: 0;
    }
    .metric-label, .metric-detail, .empty {
      color: var(--vscode-descriptionForeground);
    }
    .metric-value {
      font-size: 20px;
      font-weight: 600;
      margin-top: 4px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) minmax(360px, 1.5fr);
      gap: 16px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 7px 6px;
      text-align: left;
      white-space: nowrap;
    }
    th {
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
    }
    .notice {
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      background: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
      border-radius: 6px;
      margin-bottom: 16px;
      padding: 10px 12px;
    }
    @media (max-width: 780px) {
      header, .grid {
        display: block;
      }
      section {
        margin-bottom: 16px;
      }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>RTK Token Savings</h1>
      <div class="subtitle">Session: ${escapeHtml(session.label || sessionLabel)}</div>
    </div>
  </header>
  ${error ? `<div class="notice">Unable to read RTK status: ${escapeHtml(error.message)}</div>` : ''}
  <div class="metrics">
    ${metric('Session Saved', `${formatTokens(session.savedTokens || 0)} tokens`, formatPercent(session.savedPercent || 0))}
    ${metric('Session Runs', session.runs || 0)}
    ${metric('Total Saved', `${formatTokens(total.savedTokens || 0)} tokens`, formatPercent(total.savedPercent || 0))}
    ${metric('Total Runs', total.runs || 0)}
  </div>
  <div class="grid">
    <section>
      <h2>${escapeHtml(tableLabel)} Top Commands</h2>
      <table>
        <thead><tr><th>Command</th><th>Runs</th><th>Saved</th><th>Rate</th></tr></thead>
        <tbody>${commandRows(tableSource.commands)}</tbody>
      </table>
    </section>
    <section>
      <h2>${escapeHtml(tableLabel)} Recent Runs</h2>
      <table>
        <thead><tr><th>Command</th><th>Exit</th><th>Time</th><th>Saved</th><th>Truncated</th><th>At</th></tr></thead>
        <tbody>${recentRunRows(tableSource.recentRuns)}</tbody>
      </table>
    </section>
  </div>
</body>
</html>`;
}

function adminDashboardHtml(data, error) {
  const summary = data?.summary || {};
  const users = data?.users || [];
  const percent = summary.original_tokens
    ? ((summary.saved_tokens || 0) / summary.original_tokens) * 100
    : 0;
  const rows = users.length
    ? users.map((user) => `
      <tr>
        <td>${escapeHtml(user.email)}</td>
        <td>${escapeHtml(user.runs || 0)}</td>
        <td>${escapeHtml(formatTokens(user.saved_tokens || 0))}</td>
        <td>${escapeHtml(user.original_tokens ? (((user.saved_tokens || 0) / user.original_tokens) * 100).toFixed(1) + '%' : '0.0%')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4" class="empty">No synced user usage yet.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RTK Admin</title>
  <style>
    body {
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      margin: 0;
      padding: 20px;
    }
    h1, h2 { font-weight: 600; margin: 0; }
    h1 { font-size: 20px; }
    h2 { font-size: 14px; margin: 18px 0 10px; }
    .subtitle, .empty { color: var(--vscode-descriptionForeground); }
    .notice {
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      background: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
      border-radius: 6px;
      margin: 16px 0;
      padding: 10px 12px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-top: 18px;
    }
    .metric {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
    }
    .metric-label { color: var(--vscode-descriptionForeground); }
    .metric-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
    table { border-collapse: collapse; width: 100%; }
    th, td {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 8px 6px;
      text-align: left;
      white-space: nowrap;
    }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; }
  </style>
</head>
<body>
  <h1>RTK Admin Dashboard</h1>
  <div class="subtitle">Organization: ${escapeHtml(data?.organizationId || '')}</div>
  ${error ? `<div class="notice">${escapeHtml(error.message)}</div>` : ''}
  <div class="metrics">
    ${metric('Active Users', summary.active_users || 0)}
    ${metric('Sessions', summary.sessions || 0)}
    ${metric('Runs', summary.runs || 0)}
    ${metric('Saved', `${formatTokens(summary.saved_tokens || 0)} tokens`, `${percent.toFixed(1)}%`)}
  </div>
  <h2>User Usage</h2>
  <table>
    <thead><tr><th>User</th><th>Runs</th><th>Saved</th><th>Rate</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function updateDashboard() {
  if (!dashboardPanel) return;
  dashboardPanel.webview.html = dashboardHtml(lastSnapshot, lastError);
}

async function openDashboard() {
  if (!dashboardPanel) {
    dashboardPanel = vscode.window.createWebviewPanel(
      'rtkDashboard',
      'RTK Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: false }
    );
    dashboardPanel.onDidDispose(() => {
      dashboardPanel = undefined;
    });
  } else {
    dashboardPanel.reveal();
  }

  updateDashboard();
  await refreshStatus();
}

async function openAdminDashboard() {
  if (!adminPanel) {
    adminPanel = vscode.window.createWebviewPanel(
      'rtkAdminDashboard',
      'RTK Admin',
      vscode.ViewColumn.One,
      { enableScripts: false }
    );
    adminPanel.onDidDispose(() => {
      adminPanel = undefined;
    });
  } else {
    adminPanel.reveal();
  }

  try {
    const data = await getAdminDashboardData(extensionContext);
    adminPanel.webview.html = adminDashboardHtml(data, null);
  } catch (error) {
    adminPanel.webview.html = adminDashboardHtml(null, error);
    vscode.window.showErrorMessage(`Unable to open RTK admin dashboard: ${error.message}`);
  }
}

let extensionContext;

async function syncUsageNow() {
  if (!lastSnapshot) {
    await refreshStatus();
  }
  if (lastSnapshot) {
    await maybeSyncSnapshot(lastSnapshot, true);
    vscode.window.showInformationMessage('RTK usage sync completed.');
  }
}

async function importUsageNow() {
  if (!lastSnapshot) {
    await refreshStatus();
  }
  await importExistingHistory(extensionContext, lastSnapshot, workspaceCwd());
}

async function activate(context) {
  extensionContext = context;
  useWorkspaceSession();

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = 'RTK starting';
  statusItem.show();
  context.subscriptions.push(statusItem);

  context.subscriptions.push(vscode.commands.registerCommand('rtk.refresh', refreshStatus));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.login', () => loginWithMicrosoft(context)));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.logout', () => logout(context)));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.syncUsage', syncUsageNow));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.importUsage', importUsageNow));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.openDashboard', openDashboard));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.openAdminDashboard', openAdminDashboard));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.newSession', newSession));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.useWorkspaceSession', resetToWorkspaceSession));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.enableAutoWrap', enableAutoWrap));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.startAgentTerminal', startAgentTerminal));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(resetToWorkspaceSession));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('rtk.refreshIntervalMs')) startTimer(context);
    if (event.affectsConfiguration('rtk')) refreshStatus();
  }));

  context.subscriptions.push({
    dispose: () => {
      context.globalState.update('lastWorkspaceSessionId', workspaceSessionId());
      context.globalState.update('lastWorkspaceSessionLabel', workspaceSessionLabel());
    }
  });

  await contextStateSet();
  startTimer(context);
  await refreshStatus();
  await maybePromptAutoWrap(context);
}

function deactivate() {
  if (refreshTimer) clearInterval(refreshTimer);
}

module.exports = {
  activate,
  deactivate
};
