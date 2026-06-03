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
  return vscode.workspace.getConfiguration('rtk');
}

function makeSessionId() {
  return `vscode-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const configuredCommand = config().get('command', 'rtk-node');
  const candidates = [];
  const push = (command, argsPrefix = []) => {
    if (!candidates.some((candidate) => candidate.command === command && candidate.argsPrefix.join('\0') === argsPrefix.join('\0'))) {
      candidates.push({ command, argsPrefix });
    }
  };

  if (configuredCommand) push(configuredCommand);
  if (process.platform === 'win32') {
    push('rtk-node.cmd');
    push(path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'rtk-node.cmd'));
  } else {
    push('rtk-node');
  }

  const localCli = path.join(workspaceCwd(), 'bin', 'rtk-node.js');
  if (fs.existsSync(localCli)) push(process.execPath, [localCli]);

  return candidates;
}

function bundledCliCommand() {
  const bundledCli = path.join(__dirname, 'bin', 'rtk-node.js');
  if (fs.existsSync(bundledCli)) {
    return `${JSON.stringify(process.execPath)} ${JSON.stringify(bundledCli)}`;
  }
  return process.platform === 'win32' ? 'rtk-node.cmd' : 'rtk-node';
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

  try {
    const snapshot = await runRtkStatus();
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
    statusItem.command = 'rtk.refresh';
    statusItem.show();
  } catch (error) {
    statusItem.text = 'RTK unavailable';
    statusItem.tooltip = `Unable to run RTK status: ${error.message}`;
    statusItem.command = 'rtk.refresh';
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
  vscode.window.showInformationMessage(`RTK session started: ${sessionLabel}`);
}

async function contextStateSet() {
  await vscode.commands.executeCommand('setContext', 'rtk.sessionId', sessionId);
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

async function activate(context) {
  sessionId = context.globalState.get('sessionId') || makeSessionId();
  sessionLabel = context.globalState.get('sessionLabel') || `VS Code ${new Date().toLocaleTimeString()}`;

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = 'RTK starting';
  statusItem.show();
  context.subscriptions.push(statusItem);

  context.subscriptions.push(vscode.commands.registerCommand('rtk.refresh', refreshStatus));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.newSession', newSession));
  context.subscriptions.push(vscode.commands.registerCommand('rtk.startAgentTerminal', startAgentTerminal));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('rtk.refreshIntervalMs')) startTimer(context);
    if (event.affectsConfiguration('rtk')) refreshStatus();
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
