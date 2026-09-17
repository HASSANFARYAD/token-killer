// GENERATED FILE - do not edit. Source: src/hooks.js (npm run sync:engine)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configDir } from './config.js';

const START = '# >>> sesshush hook >>>';
const END = '# <<< sesshush hook <<<';
const CODEX_START = '# >>> sesshush codex auto hook >>>';
const CODEX_END = '# <<< sesshush codex auto hook <<<';
const ZSHENV_START = '# >>> sesshush codex shell loader >>>';
const ZSHENV_END = '# <<< sesshush codex shell loader <<<';

// Marker pairs left behind by earlier releases. Reinstall and uninstall strip
// these too, so upgrading does not leave a second, stale wrapper behind.
const LEGACY_MARKERS = [
  ['# >>> rtk-node hook >>>', '# <<< rtk-node hook <<<'],
  ['# >>> noisegate hook >>>', '# <<< noisegate hook <<<'],
  ['# >>> rtk-node codex auto hook >>>', '# <<< rtk-node codex auto hook <<<'],
  ['# >>> rtk-node codex shell loader >>>', '# <<< rtk-node codex shell loader <<<']
];

const POSIX_COMMANDS = ['git', 'rg', 'grep', 'pytest', 'npm', 'ls', 'find', 'cat'];
const POWERSHELL_COMMANDS = ['git', 'rg', 'grep', 'pytest', 'npm'];

const SESSHUSH_MD = `# Sesshush

Use \`sesshush\` for shell commands that may produce noisy output.

Preferred command forms:
- \`sesshush git status\`
- \`sesshush git diff\`
- \`sesshush git log --oneline -10\`
- \`sesshush ls .\`
- \`sesshush find "*.js" .\`
- \`sesshush read path/to/file\`
- \`sesshush rg "pattern" .\`
- \`sesshush pytest -q\`
- \`sesshush npm test\`

Use \`sesshush -v <command>\` only when raw output is required.

Set \`SESSHUSH_SESSION_ID\` (or \`RTK_SESSION_ID\`, \`OPENCODE_SESSION_ID\`, \`CLAUDE_SESSION_ID\`, \`CODEX_SESSION_ID\`, \`TERM_SESSION_ID\`) to group command runs into a session for token tracking.
`;

const AGENTS_BLOCK = `# Sesshush Command Output Compression

When running shell commands, prefer prefixing noisy commands with \`sesshush\` so output is compact before it enters the model context. Use normal commands only when the unfiltered output is required.

Sesshush supports all AI coding agents: opencode, Claude Code, Codex, Cursor, and any terminal-based agent. Session tracking works via \`SESSHUSH_SESSION_ID\`, \`RTK_SESSION_ID\`, \`OPENCODE_SESSION_ID\`, \`CLAUDE_SESSION_ID\`, or \`CODEX_SESSION_ID\` environment variables.

Reference: @SESSHUSH.md
`;

const AGENT_DIRS = [
  { name: 'opencode', dir: '.opencode' },
  { name: 'codex', dir: '.codex' },
  { name: 'claude', dir: '.claude' }
];

function shellCommand(command) {
  return command || 'sesshush';
}

function posixCommandCheck(command) {
  return `${command} --version >/dev/null 2>&1`;
}

function markedBlock(start, end, body) {
  return [start, body, end].join('\n');
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeMarkedBlock(content, start, end) {
  const re = new RegExp(`\\n?${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`, 'g');
  return content.replace(re, '\n').trimEnd();
}

function posixFunctionBlock(cmd, sesshush) {
  return [
    `${cmd}() {`,
    '  if [ -n "$SESSHUSH_ACTIVE" ] || [ -n "$SESSHUSH_DISABLE" ] || [ -n "$RTK_NODE_ACTIVE" ] || [ -n "$RTK_NODE_DISABLE" ]; then',
    `    command ${cmd} "$@"`,
    `  elif ${posixCommandCheck(sesshush)}; then`,
    `    ${sesshush} ${cmd} "$@"`,
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
  const sesshush = shellCommand(command);
  return markedBlock(
    CODEX_START,
    CODEX_END,
    [
      '# Sesshush auto-routing for Codex/VS Code command shells.',
      '# Set SESSHUSH_DISABLE=1 to bypass the wrapper for exact-output debugging.',
      'export SESSHUSH_HOOK=1',
      ...POSIX_COMMANDS.map((cmd) => posixFunctionBlock(cmd, sesshush))
    ].join('\n')
  );
}

export function zshenvLoaderBlock() {
  return markedBlock(
    ZSHENV_START,
    ZSHENV_END,
    [
      '# Load Sesshush routing for Codex/VS Code managed zsh shells.',
      '# This keeps normal system zsh scripts unchanged unless they run under those hosts.',
      'if [[ -n "${CODEX_THREAD_ID:-}" || "${CODEX_INTERNAL_ORIGINATOR_OVERRIDE:-}" == codex_* || -n "${VSCODE_IPC_HOOK:-}" ]]; then',
      '  __sesshush_codex_auto_hook="${XDG_CONFIG_HOME:-$HOME/.config}/sesshush/codex-auto-hook.zsh"',
      '  if [[ -r "$__sesshush_codex_auto_hook" ]]; then',
      '    source "$__sesshush_codex_auto_hook"',
      '  fi',
      '  unset __sesshush_codex_auto_hook',
      'fi'
    ].join('\n')
  );
}

export function hookBlock(shell, { command } = {}) {
  const sesshush = shellCommand(command);

  if (shell === 'fish') {
    return [
      START,
      'set -gx SESSHUSH_HOOK 1',
      ...POSIX_COMMANDS.map((cmd) => [
        `function ${cmd}`,
        '  if test -n "$SESSHUSH_ACTIVE"; or test -n "$SESSHUSH_DISABLE"; or test -n "$RTK_NODE_ACTIVE"; or test -n "$RTK_NODE_DISABLE"',
        `    command ${cmd} $argv`,
        `  else if ${sesshush} --version >/dev/null 2>&1`,
        `    ${sesshush} ${cmd} $argv`,
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
      '$env:SESSHUSH_HOOK = "1"',
      ...POWERSHELL_COMMANDS.map((cmd) => [
        `function global:${cmd} {`,
        '  if ($env:SESSHUSH_ACTIVE -or $env:SESSHUSH_DISABLE -or $env:RTK_NODE_ACTIVE -or $env:RTK_NODE_DISABLE) {',
        `    & (Get-Command ${native[cmd]} -ErrorAction Stop).Source @args`,
        '  } else {',
        // The command may be a quoted bundled-Node invocation with spaces in
        // the path, so probe it by running it rather than with Get-Command.
        '    $sesshushAvailable = $false',
        '    try {',
        `      ${sesshush} --version *> $null`,
        '      $sesshushAvailable = ($LASTEXITCODE -eq 0)',
        '    } catch {',
        '      $sesshushAvailable = $false',
        '    }',
        '    if ($sesshushAvailable) {',
        `      ${sesshush} ${cmd} @args`,
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
    'export SESSHUSH_HOOK=1',
    ...POSIX_COMMANDS.map((cmd) => posixFunctionBlock(cmd, sesshush)),
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

function removeExisting(content) {
  let next = removeMarkedBlock(content, START, END);
  for (const [start, end] of LEGACY_MARKERS) {
    next = removeMarkedBlock(next, start, end);
  }
  return next;
}

function installCodexAutoHook({ command = '' } = {}) {
  const autoHookTarget = codexAutoHookPath();
  fs.mkdirSync(path.dirname(autoHookTarget), { recursive: true });
  fs.writeFileSync(autoHookTarget, `${codexAutoHookBlock({ command })}\n`);

  const loaderTarget = zshenvPath();
  const current = fs.existsSync(loaderTarget) ? fs.readFileSync(loaderTarget, 'utf8') : '';
  const next = `${removeExisting(removeMarkedBlock(current, ZSHENV_START, ZSHENV_END))}\n\n${zshenvLoaderBlock()}\n`;
  fs.writeFileSync(loaderTarget, next);

  return { autoHook: autoHookTarget, loader: loaderTarget };
}

function uninstallCodexAutoHook() {
  const loaderTarget = zshenvPath();
  let loaderChanged = false;

  if (fs.existsSync(loaderTarget)) {
    const current = fs.readFileSync(loaderTarget, 'utf8');
    const next = removeExisting(removeMarkedBlock(current, ZSHENV_START, ZSHENV_END));
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

function installAgentInstructionsForDir(root) {
  fs.mkdirSync(root, { recursive: true });
  const sesshushPath = path.join(root, 'SESSHUSH.md');
  const agentsPath = path.join(root, 'AGENTS.md');
  fs.writeFileSync(sesshushPath, SESSHUSH_MD);

  const current = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  const next = current.includes('Sesshush Command Output Compression')
    ? current
    : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${AGENTS_BLOCK}`;
  fs.writeFileSync(agentsPath, next);
  return { sesshushPath, agentsPath };
}

function uninstallAgentInstructionsForDir(root) {
  const sesshushPath = path.join(root, 'SESSHUSH.md');
  const agentsPath = path.join(root, 'AGENTS.md');
  if (fs.existsSync(sesshushPath)) fs.unlinkSync(sesshushPath);
  if (fs.existsSync(agentsPath)) {
    const current = fs.readFileSync(agentsPath, 'utf8');
    const next = current
      .replace(/# Sesshush Command Output Compression[\s\S]*?Reference: @SESSHUSH\.md\n?/g, '')
      .trimEnd();
    fs.writeFileSync(agentsPath, next ? `${next}\n` : '');
  }
  return { sesshushPath, agentsPath };
}

function agentTargets({ global, agents }) {
  const dirs = AGENT_DIRS.filter((agent) => agents.includes(agent.name));
  if (global) return dirs.map((agent) => ({ name: agent.name, root: path.join(os.homedir(), agent.dir) }));
  return [
    ...dirs.map((agent) => ({ name: agent.name, root: path.join(process.cwd(), agent.dir) })),
    { name: 'cwd', root: process.cwd() }
  ];
}

export function installAgentInstructions({ global = false, agents = AGENT_DIRS.map((a) => a.name) } = {}) {
  return agentTargets({ global, agents }).map(({ name, root }) => ({
    agent: name,
    ...installAgentInstructionsForDir(root)
  }));
}

export function uninstallAgentInstructions({ global = false, agents = AGENT_DIRS.map((a) => a.name) } = {}) {
  return agentTargets({ global, agents }).map(({ name, root }) => ({
    agent: name,
    ...uninstallAgentInstructionsForDir(root)
  }));
}

export function installCodexInstructions({ global = false } = {}) {
  return installAgentInstructions({ global, agents: ['codex'] });
}

export function uninstallCodexInstructions({ global = false } = {}) {
  return uninstallAgentInstructions({ global, agents: ['codex'] });
}

const VSCODE_EXTENSION_ID = 'sesshush-token-savings';

function vsCodeAvailable() {
  try {
    const result = spawnSync('code', ['--version'], {
      stdio: 'pipe',
      timeout: 3000,
      windowsHide: true
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function installVscodeExtension() {
  if (!vsCodeAvailable()) return { installed: false, reason: 'VS Code CLI not found' };

  const dir = path.dirname(new URL(import.meta.url).pathname);
  const vsixDir = path.join(path.resolve(dir, '..'), 'vscode-extension');

  let found = null;
  try {
    for (const file of fs.readdirSync(vsixDir)) {
      if (file.endsWith('.vsix')) {
        found = path.join(vsixDir, file);
        break;
      }
    }
  } catch {
    return { installed: false, reason: 'VSIX directory not found' };
  }

  if (!found) return { installed: false, reason: 'No VSIX file found' };

  try {
    const result = spawnSync('code', ['--install-extension', found], {
      stdio: 'pipe',
      timeout: 15000,
      windowsHide: true
    });
    return {
      installed: result.status === 0,
      vsix: found,
      stderr: result.status !== 0 ? result.stderr?.toString() : undefined
    };
  } catch (error) {
    return { installed: false, reason: error.message };
  }
}

export function uninstallVscodeExtension() {
  if (!vsCodeAvailable()) return { uninstalled: false, reason: 'VS Code CLI not found' };

  try {
    const result = spawnSync('code', ['--uninstall-extension', VSCODE_EXTENSION_ID], {
      stdio: 'pipe',
      timeout: 15000,
      windowsHide: true
    });
    return {
      uninstalled: result.status === 0,
      stderr: result.status !== 0 ? result.stderr?.toString() : undefined
    };
  } catch (error) {
    return { uninstalled: false, reason: error.message };
  }
}
