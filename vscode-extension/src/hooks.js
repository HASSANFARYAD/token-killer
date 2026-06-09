import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const START = '# >>> rtk-node hook >>>';
const END = '# <<< rtk-node hook <<<';
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

function hookBlock(shell, { command } = {}) {
  const rtkCommand = shellCommand(command);

  if (shell === 'fish') {
    return [
      START,
      'set -gx RTK_NODE_HOOK 1',
      ...POSIX_COMMANDS.map((cmd) => [
        `function ${cmd}`,
        '  if test -n "$RTK_NODE_ACTIVE"',
        `    command ${cmd} $argv`,
        '  else',
        `    ${rtkCommand} ${cmd} $argv`,
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
        '  if ($env:RTK_NODE_ACTIVE) {',
        `    & (Get-Command ${native[cmd]} -ErrorAction Stop).Source @args`,
        '  } else {',
        `    & ${rtkCommand} ${cmd} @args`,
        '  }',
        '}'
      ].join('\n')),
      END
    ].join('\n');
  }

  return [
    START,
    'export RTK_NODE_HOOK=1',
    ...POSIX_COMMANDS.map((cmd) => [
      `${cmd}() {`,
      '  if [ -n "$RTK_NODE_ACTIVE" ]; then',
      `    command ${cmd} "$@"`,
      '  else',
      `    ${rtkCommand} ${cmd} "$@"`,
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

export function installHook({ shell = detectShell(), global = false, hookOnly = false, command = '' } = {}) {
  const target = profilePath(shell);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const next = `${removeExisting(current)}\n\n${hookBlock(shell, { command })}\n`;
  fs.writeFileSync(target, next);
  return { shell, profile: target, global, hookOnly };
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
  const target = profilePath(shell);
  if (!fs.existsSync(target)) return { shell, profile: target, changed: false };
  const current = fs.readFileSync(target, 'utf8');
  const next = removeExisting(current);
  fs.writeFileSync(target, next ? `${next}\n` : '');
  return { shell, profile: target, changed: current !== next };
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
