import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const START = '# >>> sesshush hook >>>';
const END = '# <<< sesshush hook <<<';
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

function hookBlock(shell) {
  if (shell === 'fish') {
    return [
      START,
      'set -gx SESSHUSH_HOOK 1',
      ...POSIX_COMMANDS.map((cmd) => [
        `function ${cmd}`,
        '  if test -n "$SESSHUSH_ACTIVE"',
        `    command ${cmd} $argv`,
        '  else',
        `    sesshush ${cmd} $argv`,
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
        '  if ($env:SESSHUSH_ACTIVE) {',
        `    & (Get-Command ${native[cmd]} -ErrorAction Stop).Source @args`,
        '  } else {',
        `    & sesshush ${cmd} @args`,
        '  }',
        '}'
      ].join('\n')),
      END
    ].join('\n');
  }

  return [
    START,
    'export SESSHUSH_HOOK=1',
    ...POSIX_COMMANDS.map((cmd) => [
      `${cmd}() {`,
      '  if [ -n "$SESSHUSH_ACTIVE" ]; then',
      `    command ${cmd} "$@"`,
      '  else',
      `    sesshush ${cmd} "$@"`,
      '  fi',
      '}'
    ].join('\n')),
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

function profilePath(shell) {
  const home = os.homedir();
  if (shell === 'fish') return path.join(home, '.config', 'fish', 'config.fish');
  if (shell === 'zsh') return path.join(home, '.zshrc');
  if (shell === 'powershell') {
    const doc = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Documents') : home;
    return path.join(doc, 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
  }
  return path.join(home, '.bashrc');
}

function removeExisting(content) {
  const re = new RegExp(`\\n?${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g');
  return content.replace(re, '\n').trimEnd();
}

export function installHook({ shell = detectShell(), global = false, hookOnly = false } = {}) {
  const target = profilePath(shell);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const next = `${removeExisting(current)}\n\n${hookBlock(shell)}\n`;
  fs.writeFileSync(target, next);
  return { shell, profile: target, global, hookOnly };
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

export function installAgentInstructions({ global = false, agents = AGENT_DIRS.map(a => a.name) } = {}) {
  const results = [];
  const dirs = AGENT_DIRS.filter(a => agents.includes(a.name));
  const targets = global ? dirs.map(a => ({ name: a.name, root: path.join(os.homedir(), a.dir) }))
    : [...dirs.map(a => ({ name: a.name, root: path.join(process.cwd(), a.dir) })), { name: 'cwd', root: process.cwd() }];
  for (const { name, root } of targets) {
    const result = installAgentInstructionsForDir(root);
    results.push({ agent: name, ...result });
  }
  return results;
}

export function uninstallAgentInstructions({ global = false, agents = AGENT_DIRS.map(a => a.name) } = {}) {
  const results = [];
  const dirs = AGENT_DIRS.filter(a => agents.includes(a.name));
  const targets = global ? dirs.map(a => ({ name: a.name, root: path.join(os.homedir(), a.dir) }))
    : [...dirs.map(a => ({ name: a.name, root: path.join(process.cwd(), a.dir) })), { name: 'cwd', root: process.cwd() }];
  for (const { name, root } of targets) {
    const result = uninstallAgentInstructionsForDir(root);
    results.push({ agent: name, ...result });
  }
  return results;
}

export function installCodexInstructions({ global = false } = {}) {
  return installAgentInstructions({ global, agents: ['codex'] });
}

export function uninstallCodexInstructions({ global = false } = {}) {
  return uninstallAgentInstructions({ global, agents: ['codex'] });
}

const VSCODE_EXTENSION_ID = 'sesshush-token-savings';

function vsixPath() {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const parent = path.resolve(dir, '..');
  const candidates = [
    path.join(parent, 'vscode-extension', '*.vsix'),
    path.join(parent, 'vscode-extension', `sesshush-token-savings-*.vsix`)
  ];
  return candidates;
}

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
  const parent = path.resolve(dir, '..');
  const vsixDir = path.join(parent, 'vscode-extension');

  let found = null;
  try {
    const files = fs.readdirSync(vsixDir);
    for (const file of files) {
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

export function uninstallHook({ shell = detectShell() } = {}) {
  const target = profilePath(shell);
  if (!fs.existsSync(target)) return { shell, profile: target, changed: false };
  const current = fs.readFileSync(target, 'utf8');
  const next = removeExisting(current);
  fs.writeFileSync(target, next ? `${next}\n` : '');
  return { shell, profile: target, changed: current !== next };
}
