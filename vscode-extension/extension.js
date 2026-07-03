const vscode = require('vscode');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let statusItem;
let refreshTimer;
let sessionId;
let sessionLabel;

function workspaceCwd() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
}

function config() {
  return vscode.workspace.getConfiguration('sesshush');
}

function makeSessionId() {
  return `vscode-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTokens(tokens) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function sesshushEnv() {
  const npmGlobal = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const pathValue = process.env[pathKey] || '';
  const nextPath = process.platform === 'win32' && !pathValue.includes(npmGlobal)
    ? `${npmGlobal};${pathValue}`
    : pathValue;

  return {
    ...process.env,
    [pathKey]: nextPath,
    SESSHUSH_SESSION_ID: sessionId,
    SESSHUSH_SESSION_LABEL: sessionLabel,
    NOISEGATE_SESSION_ID: sessionId,
    RTK_SESSION_ID: sessionId
  };
}

function commandCandidates() {
  const configuredCommand = config().get('command', 'sesshush');
  const candidates = [];
  const push = (command, argsPrefix = []) => {
    if (!candidates.some((candidate) => candidate.command === command && candidate.argsPrefix.join('\0') === argsPrefix.join('\0'))) {
      candidates.push({ command, argsPrefix });
    }
  };

  if (configuredCommand) push(configuredCommand);
  if (process.platform === 'win32') {
    push('sesshush.cmd');
    push(path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'sesshush.cmd'));
  } else {
    push('sesshush');
  }

  const localCli = path.join(workspaceCwd(), 'bin', 'sesshush.js');
  if (fs.existsSync(localCli)) push(process.execPath, [localCli]);

  return candidates;
}

function execSesshushCandidate(candidate) {
  return new Promise((resolve, reject) => {
    execFile(candidate.command, [...candidate.argsPrefix, 'status', '--json'], {
      cwd: workspaceCwd(),
      env: sesshushEnv(),
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

async function runSesshushStatus() {
  const errors = [];
  for (const candidate of commandCandidates()) {
    try {
      return await execSesshushCandidate(candidate);
    } catch (error) {
      errors.push(`${candidate.command}: ${error.message}`);
    }
  }
  throw new Error(errors.join('\n'));
}

async function refreshStatus() {
  if (!statusItem) return;

  try {
    const snapshot = await runSesshushStatus();
    const showTotal = config().get('showTotalWhenNoSession', true);
    const source = snapshot.session.runs || !showTotal ? snapshot.session : snapshot.total;
    const label = snapshot.session.runs || !showTotal ? 'session' : 'total';

    statusItem.text = `Sesshush $(zap) ${formatTokens(source.savedTokens)} saved`;
    statusItem.tooltip = [
      `Sesshush token savings (${label})`,
      `Saved: ${source.savedTokens} tokens (${source.savedPercent.toFixed(1)}%)`,
      `Original: ${source.originalTokens} tokens`,
      `Compressed: ${source.compressedTokens} tokens`,
      `Runs: ${source.runs}`,
      `Session: ${sessionLabel}`
    ].join('\n');
    statusItem.command = 'sesshush.refresh';
    statusItem.show();
  } catch (error) {
    statusItem.text = 'Sesshush unavailable';
    statusItem.tooltip = `Unable to run Sesshush status: ${error.message}`;
    statusItem.command = 'sesshush.refresh';
    statusItem.show();
  }
}

function startTimer(context) {
  if (refreshTimer) clearInterval(refreshTimer);
  const interval = config().get('refreshIntervalMs', 3000);
  refreshTimer = setInterval(refreshStatus, interval);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
}

async function newSession() {
  sessionId = makeSessionId();
  sessionLabel = `VS Code ${new Date().toLocaleTimeString()}`;
  await contextStateSet();
  await refreshStatus();
  vscode.window.showInformationMessage(`Sesshush session started: ${sessionLabel}`);
}

async function contextStateSet() {
  await vscode.commands.executeCommand('setContext', 'sesshush.sessionId', sessionId);
}

async function startAgentTerminal() {
  const defaultCommand = config().get('defaultAgentCommand', 'codex');
  const command = await vscode.window.showInputBox({
    title: 'Sesshush: Start Agent Terminal',
    prompt: 'Agent command to run with Sesshush session tracking',
    value: defaultCommand
  });
  if (!command) return;

  if (!sessionId) {
    sessionId = makeSessionId();
    sessionLabel = `VS Code ${new Date().toLocaleTimeString()}`;
    await contextStateSet();
  }

  const terminal = vscode.window.createTerminal({
    name: `Sesshush Agent: ${command}`,
    cwd: workspaceCwd(),
    env: {
      SESSHUSH_SESSION_ID: sessionId,
      SESSHUSH_SESSION_LABEL: sessionLabel,
      NOISEGATE_SESSION_ID: sessionId,
      RTK_SESSION_ID: sessionId
    }
  });
  terminal.show();
  terminal.sendText(command);
  await refreshStatus();
}

async function activate(context) {
  sessionId = context.globalState.get('sessionId') || makeSessionId();
  sessionLabel = context.globalState.get('sessionLabel') || `VS Code ${new Date().toLocaleTimeString()}`;

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusItem.text = 'Sesshush starting...';
  statusItem.show();
  context.subscriptions.push(statusItem);

  context.subscriptions.push(vscode.commands.registerCommand('sesshush.refresh', refreshStatus));
  context.subscriptions.push(vscode.commands.registerCommand('sesshush.newSession', newSession));
  context.subscriptions.push(vscode.commands.registerCommand('sesshush.startAgentTerminal', startAgentTerminal));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('sesshush.refreshIntervalMs')) startTimer(context);
    if (event.affectsConfiguration('sesshush')) refreshStatus();
  }));

  context.subscriptions.push({
    dispose: () => {
      context.globalState.update('sessionId', sessionId);
      context.globalState.update('sessionLabel', sessionLabel);
    }
  });

  await contextStateSet();
  startTimer(context);
  await refreshStatus();
}

function deactivate() {
  if (refreshTimer) clearInterval(refreshTimer);
}

module.exports = {
  activate,
  deactivate
};
