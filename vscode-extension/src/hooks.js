import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir } from './config.js';

const START = '# >>> rtk-node hook >>>';
const END = '# <<< rtk-node hook <<<';
const CODEX_START = '# >>> rtk-node codex auto hook >>>';
const CODEX_END = '# <<< rtk-node codex auto hook <<<';
const ZSHENV_START = '# >>> rtk-node codex shell loader >>>';
const ZSHENV_END = '# <<< rtk-node codex shell loader <<<';
const POSIX_COMMANDS = ['git', 'rg', 'grep', 'pytest', 'npm', 'ls', 'find', 'cat'];
const POWERSHELL_COMMANDS = ['git', 'rg', 'grep', 'pytest', 'npm'];
const RTK_MD = `# RTK Node

Use \`rtk-node\` for shell commands that may produce noisy output.

Preferred command forms:
- \`rtk-node git status\`
- \`rtk-node git diff\`
- \`rtk-node git log --oneline -10\`
- \`rtk-node ls .\`
- \`rtk-node find "*.js" .\`
- \`rtk-node read path/to/file\`
- \`rtk-node rg "pattern" .\`
- \`rtk-node pytest -q\`
- \`rtk-node npm test\`

Use \`rtk-node -v <command>\` only when raw output is required.
`;

const AGENTS_BLOCK = `# RTK Node Command Output Compression

When running shell commands, prefer prefixing noisy commands with \`rtk-node\` so output is compact before it enters the model context. Use normal commands only when the unfiltered output is required.

Reference: @RTK.md
`;

function shellCommand(command) {
  return command || 'rtk-node';
}

function posixCommandCheck(command) {
  return `${command} --version >/dev/null 2>&1`;
}

function markedBlock(start, end, body) {
  return [start, body, end].join('\n');
}

function removeMarkedBlock(content, start, end) {
  const re = new RegExp(`\\n?${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g');
  return content.replace(re, '\n').trimEnd();
}

function posixFunctionBlock(cmd, rtkCommand) {
  return [
    `${cmd}() {`,
    '  if [ -n "$RTK_NODE_ACTIVE" ] || [ -n "$RTK_NODE_DISABLE" ]; then',
    `    command ${cmd} "$@"`,
    `  elif ${posixCommandCheck(rtkCommand)}; then`,
    `    ${rtkCommand} ${cmd} "$@"`,
    '  else',
    `    command ${cmd} "$@"`,
    '  fi',
    '}'
  ].join('\n');
}

export function codexAutoHookPath() {
  return path.join(configDir(), 'codex-auto-hook.zsh');
}

function zshenvPath() {
  return path.join(os.homedir(), '.zshenv');
}

export function codexAutoHookBlock({ command } = {}) {
  const rtkCommand = shellCommand(command);
  return markedBlock(
    CODEX_START,
    CODEX_END,
    [
      '# RTK-Node auto-routing for Codex/VS Code command shells.',
      '# Set RTK_NODE_DISABLE=1 to bypass the wrapper for exact-output debugging.',
      'export RTK_NODE_HOOK=1',
      ...POSIX_COMMANDS.map((cmd) => posixFunctionBlock(cmd, rtkCommand))
    ].join('\n')
  );
}

export function zshenvLoaderBlock() {
  return markedBlock(
    ZSHENV_START,
    ZSHENV_END,
    [
      '# Load RTK-Node routing for Codex/VS Code managed zsh shells.',
      '# This keeps normal system zsh scripts unchanged unless they run under those hosts.',
      'if [[ -n "${CODEX_THREAD_ID:-}" || "${CODEX_INTERNAL_ORIGINATOR_OVERRIDE:-}" == codex_* || -n "${VSCODE_IPC_HOOK:-}" ]]; then',
      '  __rtk_codex_auto_hook="${XDG_CONFIG_HOME:-$HOME/.config}/rtk-node/codex-auto-hook.zsh"',
      '  if [[ -r "$__rtk_codex_auto_hook" ]]; then',
      '    source "$__rtk_codex_auto_hook"',
      '  fi',
      '  unset __rtk_codex_auto_hook',
      'fi'
    ].join('\n')
  );
}

export function hookBlock(shell, { command } = {}) {
  const rtkCommand = shellCommand(command);

  if (shell === 'fish') {
    return [
      START,
      'set -gx RTK_NODE_HOOK 1',
      ...POSIX_COMMANDS.map((cmd) => [
        `function ${cmd}`,
        '  if test -n "$RTK_NODE_ACTIVE"; or test -n "$RTK_NODE_DISABLE"',
        `    command ${cmd} $argv`,
        `  else if ${rtkCommand} --version >/dev/null 2>&1`,
        `    ${rtkCommand} ${cmd} $argv`,
        '  else',
        `    command ${cmd} $argv`,
        '  end',
        'end'
      ].join('\n')),
      END
    ].join('\n');
  }

  if (shell === 'powershell') {
    const native = {
      git: 'git.exe',
      rg: 'rg.exe',
      grep: 'grep.exe',
      pytest: 'pytest.exe',
      npm: 'npm.cmd'
    };
    return [
      START,
      '$env:RTK_NODE_HOOK = "1"',
      ...POWERSHELL_COMMANDS.map((cmd) => [
        `function global:${cmd} {`,
        '  if ($env:RTK_NODE_ACTIVE -or $env:RTK_NODE_DISABLE) {',
        `    & (Get-Command ${native[cmd]} -ErrorAction Stop).Source @args`,
        '  } else {',
        '    $rtkAvailable = $false',
        '    try {',
        `      ${rtkCommand} --version *> $null`,
        '      $rtkAvailable = ($LASTEXITCODE -eq 0)',
        '    } catch {',
        '      $rtkAvailable = $false',
        '    }',
        '    if ($rtkAvailable) {',
        `      ${rtkCommand} ${cmd} @args`,
        '    } else {',
        `      & (Get-Command ${native[cmd]} -ErrorAction Stop).Source @args`,
        '    }',
        '  }',
        '}'
      ].join('\n')),
      END
    ].join('\n');
  }

  return [
    START,
    'export RTK_NODE_HOOK=1',
    ...POSIX_COMMANDS.map((cmd) => posixFunctionBlock(cmd, rtkCommand)),
    END
  ].join('\n');
}

function detectShell() {
  if (process.platform === 'win32') return 'powershell';
  const shell = path.basename(process.env.SHELL || '').toLowerCase();
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('zsh')) return 'zsh';
  return 'bash';
}

function profilePaths(shell) {
  const home = os.homedir();
  if (shell === 'fish') return [path.join(home, '.config', 'fish', 'config.fish')];
  if (shell === 'zsh') return [path.join(home, '.zshrc')];
  if (shell === 'powershell') {
    const documentRoot = path.join(process.env.USERPROFILE || home, 'Documents');
    return [
      path.join(documentRoot, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      path.join(documentRoot, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1')
    ];
  }
  return [path.join(home, '.bashrc')];
}

function profilePath(shell) {
  return profilePaths(shell)[0];
}

function removeExisting(content) {
  return removeMarkedBlock(content, START, END);
}

function installCodexAutoHook({ command = '' } = {}) {
  const autoHookTarget = codexAutoHookPath();
  fs.mkdirSync(path.dirname(autoHookTarget), { recursive: true });
  fs.writeFileSync(autoHookTarget, `${codexAutoHookBlock({ command })}\n`);

  const loaderTarget = zshenvPath();
  const current = fs.existsSync(loaderTarget) ? fs.readFileSync(loaderTarget, 'utf8') : '';
  const next = `${removeMarkedBlock(current, ZSHENV_START, ZSHENV_END)}\n\n${zshenvLoaderBlock()}\n`;
  fs.writeFileSync(loaderTarget, next);

  return { autoHook: autoHookTarget, loader: loaderTarget };
}

function uninstallCodexAutoHook() {
  const loaderTarget = zshenvPath();
  let loaderChanged = false;

  if (fs.existsSync(loaderTarget)) {
    const current = fs.readFileSync(loaderTarget, 'utf8');
    const next = removeMarkedBlock(current, ZSHENV_START, ZSHENV_END);
    fs.writeFileSync(loaderTarget, next ? `${next}\n` : '');
    loaderChanged = current !== next;
  }

  const autoHookTarget = codexAutoHookPath();
  let autoHookChanged = false;
  if (fs.existsSync(autoHookTarget)) {
    fs.unlinkSync(autoHookTarget);
    autoHookChanged = true;
  }

  return { autoHook: autoHookTarget, loader: loaderTarget, changed: loaderChanged || autoHookChanged };
}

export function installHook({ shell = detectShell(), global = false, hookOnly = false, command = '' } = {}) {
  const targets = profilePaths(shell);
  const block = hookBlock(shell, { command });

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const next = `${removeExisting(current)}\n\n${block}\n`;
    fs.writeFileSync(target, next);
  }

  const codexAutoHook = shell === 'zsh' ? installCodexAutoHook({ command }) : null;
  return { shell, profile: targets[0], profiles: targets, codexAutoHook, global, hookOnly };
}

export function installCodexInstructions({ global = false } = {}) {
  const root = global ? path.join(os.homedir(), '.codex') : process.cwd();
  fs.mkdirSync(root, { recursive: true });
  const rtkPath = path.join(root, 'RTK.md');
  const agentsPath = path.join(root, 'AGENTS.md');
  fs.writeFileSync(rtkPath, RTK_MD);

  const current = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  const next = current.includes('RTK Node Command Output Compression')
    ? current
    : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${AGENTS_BLOCK}`;
  fs.writeFileSync(agentsPath, next);
  return { root, rtkPath, agentsPath };
}

export function uninstallHook({ shell = detectShell() } = {}) {
  const targets = profilePaths(shell);
  const codexAutoHook = shell === 'zsh' ? uninstallCodexAutoHook() : null;
  let changed = Boolean(codexAutoHook?.changed);

  for (const target of targets) {
    if (!fs.existsSync(target)) continue;

    const current = fs.readFileSync(target, 'utf8');
    const next = removeExisting(current);
    fs.writeFileSync(target, next ? `${next}\n` : '');
    changed = changed || current !== next;
  }

  return { shell, profile: targets[0], profiles: targets, codexAutoHook, changed };
}

export function uninstallCodexInstructions({ global = false } = {}) {
  const root = global ? path.join(os.homedir(), '.codex') : process.cwd();
  const rtkPath = path.join(root, 'RTK.md');
  const agentsPath = path.join(root, 'AGENTS.md');
  if (fs.existsSync(rtkPath)) fs.unlinkSync(rtkPath);
  if (fs.existsSync(agentsPath)) {
    const current = fs.readFileSync(agentsPath, 'utf8');
    const next = current
      .replace(/# RTK Node Command Output Compression[\s\S]*?Reference: @RTK\.md\n?/g, '')
      .trimEnd();
    fs.writeFileSync(agentsPath, next ? `${next}\n` : '');
  }
  return { root, rtkPath, agentsPath };
}
