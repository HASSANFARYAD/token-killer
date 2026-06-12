const vscode = require('vscode');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  deleteAzureAdSettings,
  ensureAuthenticated,
  getAdminDashboardData,
  getAdminUsers,
  getAzureAdSyncStatus,
  importExistingHistory,
  loginWithMicrosoft,
  logout,
  saveAzureAdSettings,
  syncAzureAdUsers,
  testAzureAdConnection,
  syncSnapshot
} = require('./sync');
const { checkCommand } = require('./src/adapters/externalCliAdapter.cjs');
const { copyOptimizedContext } = require('./src/context/copyOptimizedContext.cjs');
const { snapshot: localMetricsSnapshot, setSessionId, workspaceSessionId: savytoxWorkspaceSessionId } = require('./src/dashboard/metrics.cjs');
const { openTokenSaverTerminal } = require('./src/terminal/tokenSaverTerminal.cjs');

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

function savytoxConfig() {
  return vscode.workspace.getConfiguration('savytox');
}

function engineMode() {
  return savytoxConfig().get('engine', 'extension');
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
  const push = (command, argsPrefix = [], label = command) => {
    if (!candidates.some((candidate) => candidate.command === command && candidate.argsPrefix.join('\0') === argsPrefix.join('\0'))) {
      candidates.push({ command, argsPrefix, label });
    }
  };

  const bundledCli = path.join(__dirname, 'bin', 'rtk-node.js');
  if (fs.existsSync(bundledCli)) push(nodeCommand(), [bundledCli], 'bundled RTK CLI');

  if (configuredCommand) push(configuredCommand, [], 'configured rtk.command');

  const localCli = path.join(workspaceCwd(), 'bin', 'rtk-node.js');
  if (fs.existsSync(localCli)) push(nodeCommand(), [localCli], 'workspace RTK CLI');

  if (process.platform === 'win32') {
    push('rtk-node.cmd', [], 'global rtk-node.cmd');
    push(path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'rtk-node.cmd'), [], 'global npm rtk-node.cmd');
  } else {
    push('rtk-node', [], 'global rtk-node');
  }

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

async function runLocalAgentStatus() {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch((process.env.RTK_AGENT_URL || 'http://127.0.0.1:17687') + '/status', {
      method: 'GET',
      signal: controller.signal
    });
    if (!response.ok) return null;
    const status = await response.json();
    if (status?.session && status?.total) return status;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function validateRtkCandidate(candidate) {
  return new Promise((resolve, reject) => {
    execFile(candidate.command, [...candidate.argsPrefix, '--version'], {
      cwd: workspaceCwd(),
      env: rtkEnv(),
      windowsHide: true,
      timeout: 5000
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve((stdout || '').trim());
    });
  });
}

async function runRtkStatus() {
  const agentStatus = await runLocalAgentStatus();
  if (agentStatus) return agentStatus;

  const errors = [];
  for (const candidate of commandCandidates()) {
    try {
      await validateRtkCandidate(candidate);
      return await execRtkCandidate(candidate);
    } catch (error) {
      errors.push(`${candidate.label}: ${error.message}`);
    }
  }
  throw new Error(errors.join('\n'));
}

async function runSavytoxStatus() {
  const mode = engineMode();
  if (mode === 'extension') {
    return localMetricsSnapshot(extensionContext, workspaceCwd());
  }

  if (mode === 'external-cli') {
    return runRtkStatus();
  }

  const externalCommand = savytoxConfig().get('externalCommand', '') || config().get('command', '');
  const external = await checkCommand(externalCommand, workspaceCwd());
  if (external.available) {
    try {
      return await runRtkStatus();
    } catch {
      return localMetricsSnapshot(extensionContext, workspaceCwd());
    }
  }

  return localMetricsSnapshot(extensionContext, workspaceCwd());
}

async function refreshStatus() {
  if (!statusItem) return;
  if (followWorkspaceSession && config().get('followWorkspacePath', true) && sessionId !== workspaceSessionId()) {
    useWorkspaceSession();
    await contextStateSet();
  }

  try {
    const snapshot = await runSavytoxStatus();
    lastSnapshot = snapshot;
    lastError = null;
    if (engineMode() !== 'extension') maybeSyncSnapshot(snapshot);
    const showTotal = config().get('showTotalWhenNoSession', true);
    const source = snapshot.session.runs || !showTotal ? snapshot.session : snapshot.total;
    const label = snapshot.session.runs || !showTotal ? 'session' : 'total';

    if (source.runs) {
      statusItem.text = `SavytoX $(zap) ${formatPercent(source.savedPercent || 0)} saved`;
    } else {
      statusItem.text = 'SavytoX: Ready';
    }
    statusItem.tooltip = [
      `SavytoX token savings (${label})`,
      `Saved: ${source.savedTokens} tokens (${source.savedPercent.toFixed(1)}%)`,
      `Original: ${source.originalTokens} tokens`,
      `Compressed: ${source.compressedTokens} tokens`,
      `Runs: ${source.runs}`,
      `Session: ${sessionLabel}`
    ].join('\n');
    statusItem.command = 'savytox.showDashboard';
    statusItem.show();
    updateDashboard();
  } catch (error) {
    lastError = error;
    lastSnapshot = localMetricsSnapshot(extensionContext, workspaceCwd());
    statusItem.text = 'SavytoX: Ready';
    statusItem.tooltip = `SavytoX extension engine is ready. Optional external CLI status failed: ${error.message}`;
    statusItem.command = 'savytox.showDashboard';
    statusItem.show();
    updateDashboard();
  }
}

async function maybeSyncSnapshot(snapshot, force = false) {
  if (syncInFlight) return false;
  const interval = config().get('syncIntervalMs', 30000);
  const now = Date.now();
  if (!force && now - lastSyncAt < interval) return true;
  syncInFlight = true;
  try {
    await syncSnapshot(extensionContext, snapshot, workspaceCwd());
    lastSyncAt = now;
    return true;
  } catch (error) {
    lastError = error;
    return false;
  } finally {
    syncInFlight = false;
  }
}

function syncErrorMessage(error) {
  const message = error?.message || String(error);
  if (message === 'fetch failed') {
    return `Backend request failed. Check rtk.apiBaseUrl (${config().get('apiBaseUrl', '')}) and your network connection.`;
  }
  return message;
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
  await setSessionId(extensionContext, sessionId);
  await contextStateSet();
  await refreshStatus();
  vscode.window.showInformationMessage(`SavytoX session started: ${sessionLabel}`);
}

async function resetToWorkspaceSession() {
  followWorkspaceSession = true;
  useWorkspaceSession();
  await setSessionId(extensionContext, savytoxWorkspaceSessionId(workspaceCwd()));
  await contextStateSet();
  await refreshStatus();
}

async function openSavytoxTokenSaverTerminal() {
  if (!savytoxConfig().get('enableTokenSaverTerminal', true)) {
    vscode.window.showInformationMessage('Enable savytox.enableTokenSaverTerminal to use the Token Saver Terminal.');
    return;
  }
  openTokenSaverTerminal(extensionContext, workspaceCwd(), refreshStatus);
}

async function copySavytoxOptimizedContext() {
  await copyOptimizedContext(extensionContext, workspaceCwd(), {
    optimizationMode: savytoxConfig().get('optimizationMode', 'balanced'),
    maxOutputChars: savytoxConfig().get('maxOutputChars', 18000),
    preview: true
  });
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
    execFile(nodeCommand(), [bundledCli, '--version'], {
      cwd: workspaceCwd(),
      env: rtkEnv(),
      windowsHide: true,
      timeout: 5000
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Bundled RTK CLI failed validation: ${stderr?.trim() || error.message}`));
        return;
      }
      execFile(nodeCommand(), [bundledCli, 'init', '-g', '--hook-only', '--command', rtkCommand], {
        cwd: workspaceCwd(),
        env: rtkEnv(),
        windowsHide: true,
        timeout: 5000
      }, (installError, installStdout, installStderr) => {
        if (installError) {
          reject(new Error(installStderr?.trim() || installError.message));
          return;
        }
        resolve(installStdout.trim() || stdout.trim());
      });
    });
  });
}

async function enableAutoWrap() {
  if (!config().get('autoWrapTerminals', false)) {
    const choice = await vscode.window.showWarningMessage(
      'RTK automatic terminal wrapping modifies your shell profile so commands such as git and npm run through rtk-node in new terminals. Enable this setting and install the hook?',
      'Enable and Install',
      'Cancel'
    );
    if (choice !== 'Enable and Install') return;
    await config().update('autoWrapTerminals', true, vscode.ConfigurationTarget.Global);
  }

  try {
    const output = await installShellHook();
    await refreshStatus();
    vscode.window.showInformationMessage(`RTK automatic terminal wrapping enabled. Restart terminals to use it. ${output}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Unable to enable RTK automatic terminal wrapping: ${error.message}`);
  }
}

function uninstallShellHook() {
  return new Promise((resolve, reject) => {
    const bundledCli = bundledCliPath();
    if (!fs.existsSync(bundledCli)) {
      reject(new Error('Bundled RTK CLI was not found in the extension.'));
      return;
    }

    execFile(nodeCommand(), [bundledCli, 'uninstall-hooks'], {
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

async function disableAutoWrap() {
  try {
    await config().update('autoWrapTerminals', false, vscode.ConfigurationTarget.Global);
    const output = await uninstallShellHook();
    vscode.window.showInformationMessage(`RTK automatic terminal wrapping disabled. Restart terminals to clear loaded shell functions. ${output}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Unable to disable RTK automatic terminal wrapping: ${error.message}`);
  }
}

async function ensureAutoWrapInstalled() {
  if (!config().get('autoWrapTerminals', false)) return;

  try {
    await installShellHook();
  } catch (error) {
    lastError = error;
  }
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

async function runDiagnostics() {
  const lines = [];
  const add = (status, label, detail = '') => {
    lines.push(`${status.padEnd(7)} ${label}${detail ? `: ${detail}` : ''}`);
  };
  const extension = vscode.extensions.getExtension('rtk.savytox');

  add('INFO', 'Extension version', extension?.packageJSON?.version || 'unknown');
  add('INFO', 'VS Code version', vscode.version);
  add('INFO', 'OS', `${process.platform} ${os.release()}`);
  add('INFO', 'Workspace', workspaceCwd());
  add('INFO', 'rtk.autoWrapTerminals', String(config().get('autoWrapTerminals', false)));
  add('INFO', 'rtk.command', config().get('command', '') || '(not configured)');
  add('INFO', 'Bundled CLI path', bundledCliPath());
  add(fs.existsSync(bundledCliPath()) ? 'OK' : 'BROKEN', 'Bundled CLI exists', fs.existsSync(bundledCliPath()) ? 'yes' : 'no');

  for (const candidate of commandCandidates()) {
    try {
      const version = await validateRtkCandidate(candidate);
      add('OK', candidate.label, version || 'validated');
    } catch (error) {
      add('BROKEN', candidate.label, error.message);
    }
  }

  const shellHookEnabled = config().get('autoWrapTerminals', false);
  add(shellHookEnabled ? 'WARN' : 'OK', 'Would git add . be wrapped?', shellHookEnabled ? 'yes, in new terminals with installed hooks' : 'no');

  const checkCommand = (command) => new Promise((resolve) => {
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
    execFile(lookup, [command], { windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
      resolve(error ? { ok: false, detail: stderr?.trim() || error.message } : { ok: true, detail: stdout.trim().split(/\r?\n/)[0] });
    });
  });

  for (const command of ['git', 'node', process.platform === 'win32' ? 'python' : 'python3']) {
    const result = await checkCommand(command);
    add(result.ok ? 'OK' : 'WARN', `${command} path`, result.detail);
  }

  const document = await vscode.workspace.openTextDocument({
    language: 'plaintext',
    content: [
      'RTK Diagnostics',
      '',
      ...lines,
      '',
      'Suggested fixes:',
      '- Set RTK_NODE_DISABLE=1 before a command when exact raw output is required.',
      '- Use RTK: Disable Automatic Terminal Wrapping to remove RTK-managed hook blocks.',
      '- Prefer the bundled CLI; repair or remove broken global rtk-node shims if diagnostics mark them broken.'
    ].join('\n')
  });
  await vscode.window.showTextDocument(document);
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
  <title>SavytoX Dashboard</title>
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
      <h1>SavytoX Token Savings</h1>
      <div class="subtitle">Session: ${escapeHtml(session.label || sessionLabel)}</div>
    </div>
  </header>
  ${error && engineMode() !== 'extension' ? `<div class="notice">Optional external CLI status failed: ${escapeHtml(error.message)}</div>` : ''}
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
  const adminUsers = data?.adminUsers || [];
  const settings = data?.azureSettings || {};
  const syncStatus = data?.syncStatus?.last_run || null;
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
  const userRows = adminUsers.length
    ? adminUsers.map((user) => `
      <tr>
        <td>${escapeHtml(user.email)}</td>
        <td>${escapeHtml(user.display_name || '')}</td>
        <td>${escapeHtml((user.roles || []).join(', ') || '')}</td>
        <td>${escapeHtml(user.status || '')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4" class="empty">No users loaded.</td></tr>';
  const initialRoleRules = JSON.stringify(settings.role_mapping_rules || {
    CEO: 'EXECUTIVE',
    Chief: 'EXECUTIVE',
    Director: 'EXECUTIVE',
    VP: 'EXECUTIVE',
    Manager: 'DEPARTMENT_MANAGER',
    Lead: 'DEPARTMENT_MANAGER',
    Engineer: 'EMPLOYEE',
    Developer: 'EMPLOYEE'
  }, null, 2);

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
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 14px 0;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 0;
      border-radius: 4px;
      cursor: pointer;
      padding: 7px 10px;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.danger {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }
    label {
      color: var(--vscode-descriptionForeground);
      display: block;
      font-size: 12px;
      margin-bottom: 4px;
    }
    input, textarea {
      box-sizing: border-box;
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 7px 8px;
    }
    textarea {
      min-height: 150px;
      resize: vertical;
      font-family: var(--vscode-editor-font-family);
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
    }
    .wide {
      grid-column: 1 / -1;
    }
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
    .panel {
      border-top: 1px solid var(--vscode-panel-border);
      margin-top: 20px;
      padding-top: 16px;
    }
    .status {
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
      min-height: 18px;
    }
    table { border-collapse: collapse; width: 100%; }
    th, td {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 8px 6px;
      text-align: left;
      vertical-align: top;
    }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; }
  </style>
</head>
<body>
  <h1>RTK Admin Dashboard</h1>
  <div class="subtitle">Organization: ${escapeHtml(data?.organizationId || '')}</div>
  ${error ? `<div class="notice">${escapeHtml(error.message)}</div>` : ''}
  <div id="message" class="status"></div>
  <div class="metrics">
    ${metric('Active Users', summary.active_users || 0)}
    ${metric('Sessions', summary.sessions || 0)}
    ${metric('Runs', summary.runs || 0)}
    ${metric('Saved', `${formatTokens(summary.saved_tokens || 0)} tokens`, `${percent.toFixed(1)}%`)}
  </div>

  <section class="panel">
    <h2>Azure AD Settings</h2>
    <div class="form-grid">
      <div>
        <label for="tenantId">Tenant ID</label>
        <input id="tenantId" value="${escapeHtml(settings.tenant_id || '')}">
      </div>
      <div>
        <label for="clientId">Client ID</label>
        <input id="clientId" value="${escapeHtml(settings.client_id || '')}">
      </div>
      <div>
        <label for="clientSecretRef">Client Secret Environment Variable</label>
        <input id="clientSecretRef" value="${escapeHtml(settings.client_secret_ref || 'AZURE_AD_CLIENT_SECRET')}">
      </div>
      <div>
        <label for="enabled">Enabled</label>
        <input id="enabled" type="checkbox" ${settings.enabled === false ? '' : 'checked'}>
      </div>
      <div class="wide">
        <label for="roleRules">Role Mapping Rules JSON</label>
        <textarea id="roleRules">${escapeHtml(initialRoleRules)}</textarea>
      </div>
    </div>
    <div class="toolbar">
      <button id="saveSettings">Save Settings</button>
      <button id="testConnection" class="secondary">Test Connection</button>
      <button id="syncUsers" class="secondary">Fetch Users From Azure AD</button>
      <button id="deleteSettings" class="danger">Delete Settings</button>
      <button id="refreshAdmin" class="secondary">Refresh</button>
    </div>
    <div class="status">Last sync: ${escapeHtml(syncStatus ? `${syncStatus.status} (${syncStatus.id})` : 'none')}</div>
  </section>

  <section class="panel">
    <h2>Imported Users</h2>
    <table>
      <thead><tr><th>Email</th><th>Name</th><th>Roles</th><th>Status</th></tr></thead>
      <tbody id="usersBody">${userRows}</tbody>
    </table>
  </section>

  <h2>User Usage</h2>
  <table>
    <thead><tr><th>User</th><th>Runs</th><th>Saved</th><th>Rate</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    const vscode = acquireVsCodeApi();
    const message = document.getElementById('message');
    function setMessage(text) {
      message.textContent = text || '';
    }
    function settingsPayload() {
      let roleRules;
      try {
        roleRules = JSON.parse(document.getElementById('roleRules').value || '{}');
      } catch (error) {
        throw new Error('Role mapping rules must be valid JSON.');
      }
      return {
        tenant_id: document.getElementById('tenantId').value.trim(),
        client_id: document.getElementById('clientId').value.trim() || null,
        client_secret_ref: document.getElementById('clientSecretRef').value.trim() || null,
        role_mapping_rules: roleRules,
        enabled: document.getElementById('enabled').checked
      };
    }
    function post(command, payload) {
      setMessage('Working...');
      vscode.postMessage({ command, payload });
    }
    document.getElementById('saveSettings').addEventListener('click', () => {
      try { post('saveAzureSettings', settingsPayload()); }
      catch (error) { setMessage(error.message); }
    });
    document.getElementById('testConnection').addEventListener('click', () => post('testAzureConnection'));
    document.getElementById('syncUsers').addEventListener('click', () => post('syncAzureUsers'));
    document.getElementById('deleteSettings').addEventListener('click', () => post('deleteAzureSettings'));
    document.getElementById('refreshAdmin').addEventListener('click', () => post('refreshAdmin'));
    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'status') setMessage(msg.text);
    });
  </script>
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
      'savytoxDashboard',
      'SavytoX Dashboard',
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

async function refreshAdminDashboard() {
  if (!adminPanel) return;
  try {
    const data = await getAdminDashboardData(extensionContext);
    adminPanel.webview.html = adminDashboardHtml(data, null);
  } catch (error) {
    adminPanel.webview.html = adminDashboardHtml(null, error);
    vscode.window.showErrorMessage(`Unable to refresh RTK admin dashboard: ${error.message}`);
  }
}

async function handleAdminMessage(message) {
  if (!adminPanel) return;
  const postStatus = (text) => adminPanel?.webview.postMessage({ type: 'status', text });
  try {
    if (message.command === 'saveAzureSettings') {
      await saveAzureAdSettings(extensionContext, message.payload);
      postStatus('Azure AD settings saved.');
      await refreshAdminDashboard();
    } else if (message.command === 'deleteAzureSettings') {
      const choice = await vscode.window.showWarningMessage(
        'Delete Azure AD settings for this organization?',
        'Delete',
        'Cancel'
      );
      if (choice !== 'Delete') {
        postStatus('Delete cancelled.');
        return;
      }
      await deleteAzureAdSettings(extensionContext);
      postStatus('Azure AD settings deleted.');
      await refreshAdminDashboard();
    } else if (message.command === 'testAzureConnection') {
      await testAzureAdConnection(extensionContext);
      postStatus('Azure AD connection succeeded.');
    } else if (message.command === 'syncAzureUsers') {
      const result = await syncAzureAdUsers(extensionContext);
      postStatus(`Azure AD sync ${result.status}: ${result.imported_users || 0} imported, ${result.updated_users || 0} updated.`);
      await refreshAdminDashboard();
    } else if (message.command === 'refreshAdmin') {
      const status = await getAzureAdSyncStatus(extensionContext).catch(() => null);
      const users = await getAdminUsers(extensionContext).catch(() => []);
      postStatus(`Refreshed. Users: ${users.length}. Last sync: ${status?.last_run?.status || 'none'}.`);
      await refreshAdminDashboard();
    }
  } catch (error) {
    postStatus(error.message);
    vscode.window.showErrorMessage(`RTK admin action failed: ${error.message}`);
  }
}

async function openAdminDashboard() {
  if (!(await ensureAuthenticated(extensionContext, true))) return;
  if (!adminPanel) {
    adminPanel = vscode.window.createWebviewPanel(
      'rtkAdminDashboard',
      'RTK Admin',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    adminPanel.webview.onDidReceiveMessage(handleAdminMessage);
    adminPanel.onDidDispose(() => {
      adminPanel = undefined;
    });
  } else {
    adminPanel.reveal();
  }

  await refreshAdminDashboard();
}

let extensionContext;

async function syncUsageNow() {
  try {
    if (!(await ensureAuthenticated(extensionContext, true))) return;
    if (!lastSnapshot) {
      await refreshStatus();
    }
    if (lastSnapshot) {
      if (await maybeSyncSnapshot(lastSnapshot, true)) {
        vscode.window.showInformationMessage('RTK usage sync completed.');
      } else {
        vscode.window.showErrorMessage(`Unable to sync RTK usage: ${syncErrorMessage(lastError)}`);
      }
    }
  } catch (error) {
    lastError = error;
    vscode.window.showErrorMessage(`Unable to sync RTK usage: ${syncErrorMessage(error)}`);
  }
}

async function importUsageNow() {
  try {
    if (!(await ensureAuthenticated(extensionContext, true))) return;
    if (!lastSnapshot) {
      await refreshStatus();
    }
    await importExistingHistory(extensionContext, lastSnapshot, workspaceCwd());
  } catch (error) {
    lastError = error;
    vscode.window.showErrorMessage(`Unable to import RTK usage: ${syncErrorMessage(error)}`);
  }
}

async function activate(context) {
  extensionContext = context;
  useWorkspaceSession();
  await setSessionId(context, savytoxWorkspaceSessionId(workspaceCwd()));

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = 'SavytoX: Ready';
  if (savytoxConfig().get('showStatusBar', true)) statusItem.show();
  context.subscriptions.push(statusItem);

  context.subscriptions.push(vscode.commands.registerCommand('savytox.openTokenSaverTerminal', openSavytoxTokenSaverTerminal));
  context.subscriptions.push(vscode.commands.registerCommand('savytox.copyOptimizedContext', copySavytoxOptimizedContext));
  context.subscriptions.push(vscode.commands.registerCommand('savytox.showDashboard', openDashboard));
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
  context.subscriptions.push(vscode.commands.registerCommand('rtk.disableAutoWrap', disableAutoWrap));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.diagnostics', runDiagnostics));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.startAgentTerminal', openSavytoxTokenSaverTerminal));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(resetToWorkspaceSession));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('rtk.refreshIntervalMs')) startTimer(context);
    if (event.affectsConfiguration('rtk') || event.affectsConfiguration('savytox')) refreshStatus();
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
  if (config().get('authRequired', false)) {
    ensureAuthenticated(context, false).catch((error) => {
      lastError = error;
    });
  }
  if (!context.globalState.get('savytox.onboardingShown')) {
    const choice = await vscode.window.showInformationMessage(
      'SavytoX is ready with local-first token saving in your VS Code workflow.',
      'Open Token Saver Terminal',
      'Copy Optimized Context',
      'Show Dashboard'
    );
    await context.globalState.update('savytox.onboardingShown', true);
    if (choice === 'Open Token Saver Terminal') await openSavytoxTokenSaverTerminal();
    if (choice === 'Copy Optimized Context') await copySavytoxOptimizedContext();
    if (choice === 'Show Dashboard') await openDashboard();
  }
}

function deactivate() {
  if (refreshTimer) clearInterval(refreshTimer);
}

module.exports = {
  activate,
  deactivate
};
