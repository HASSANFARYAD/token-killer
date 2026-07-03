import { filterOutput } from './filters.js';
import { installAgentInstructions, installHook, installVscodeExtension, uninstallAgentInstructions, uninstallHook, uninstallVscodeExtension } from './hooks.js';
import { loadConfig, ensureConfig, configPath } from './config.js';
import { analyticsSnapshot, currentSessionId, formatGain, formatSessionGain, recordRun } from './stats.js';
import { runCommand } from './runner.js';
import { runInternal } from './internal.js';
import { byteLength, lineCount } from './utils.js';
import { maybeStripAnsi } from './ansi.js';

function parse(argv) {
  const flags = {
    colors: true,
    verbose: false,
    ultraCompact: false,
    hookOnly: false,
    global: false,
    noVscode: false,
    agents: [],
    show: false,
    json: false
  };
  const positional = [];
  let i = 0;

  for (; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-colors') flags.colors = false;
    else if (arg === '-v' || arg === '--verbose') flags.verbose = true;
    else if (arg === '-u' || arg === '--ultra-compact') flags.ultraCompact = true;
    else break;
  }

  if (i >= argv.length) return { flags, positional };

  const command = argv[i];
  positional.push(command);
  const rest = argv.slice(i + 1);

  if (command === 'init') {
    for (const arg of rest) {
      if (arg === '--hook-only') flags.hookOnly = true;
      else if (arg === '-g' || arg === '--global') flags.global = true;
      else if (arg === '--codex') flags.agents.push('codex');
      else if (arg === '--opencode') flags.agents.push('opencode');
      else if (arg === '--all-agents') flags.agents = ['opencode', 'codex', 'claude'];
      else if (arg === '--no-vscode') flags.noVscode = true;
      else if (arg === '--show') flags.show = true;
      else if (arg === '--uninstall') flags.uninstall = true;
      else positional.push(arg);
    }
  } else if (command === 'status' || command === 'session') {
    for (const arg of rest) {
      if (arg === '--json') flags.json = true;
      else positional.push(arg);
    }
  } else {
    positional.push(...rest);
  }

  return { flags, positional };
}

export const parseForTest = parse;

function help() {
  return `noisegate - thin command output proxy

Usage:
  noisegate <command> [args...]
  noisegate init [-g] [--hook-only] [--no-vscode]
  noisegate init -g --codex
  noisegate init -g --opencode
  noisegate init -g --all-agents
  noisegate init -g --uninstall
  noisegate uninstall
  noisegate gain
  noisegate session [--json]
  noisegate status [--json]
  noisegate config

Flags:
  --no-colors       Strip ANSI color codes from output
  -v, --verbose     Print unfiltered command output
  -u, --ultra-compact
                    Use more aggressive truncation and shorter summaries

Agent init flags:
  --codex           Install NoiseGate instructions for Codex AI
  --opencode        Install NoiseGate instructions for opencode AI
  --all-agents      Install NoiseGate instructions for all supported agents
  --no-vscode       Skip auto-install of VS Code extension

Note: \`noisegate init -g --all-agents\` installs everything in one step:
  shell hooks + agent instructions + VS Code extension (if VS Code detected).
`;
}

function metadata({ command, args, result, original, compressed, truncated }) {
  const originalBytes = byteLength(original);
  const compressedBytes = byteLength(compressed);
  const originalLines = lineCount(original);
  const compressedLines = lineCount(compressed);
  const saved = originalBytes ? ((Math.max(0, originalBytes - compressedBytes) / originalBytes) * 100).toFixed(1) : '0.0';
  return [
    '',
    '--- noisegate metadata ---',
    `command: ${[command, ...args].join(' ')}`,
    `exit_code: ${result.status}`,
    `duration_ms: ${result.durationMs.toFixed(1)}`,
    `original: ${originalBytes} bytes, ${originalLines} lines`,
    `compressed: ${compressedBytes} bytes, ${compressedLines} lines`,
    `saved: ${saved}%`,
    `truncated: ${truncated ? 'yes' : 'no'}`
  ].join('\n');
}

export async function main(argv) {
  const { flags, positional } = parse(argv);
  const subcommand = positional[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(help());
    return;
  }

  if (subcommand === 'init') {
    if (flags.uninstall) {
      const hook = uninstallHook({});
      const vscode = uninstallVscodeExtension();
      const agents = uninstallAgentInstructions({ global: flags.global, agents: flags.agents.length ? flags.agents : undefined });
      console.log(`Removed shell hook from ${hook.profile}`);
      if (vscode.uninstalled) console.log('Uninstalled VS Code extension');
      else if (!vscode.reason?.includes('not found')) console.log(`VS Code extension: ${vscode.reason || 'skipped'}`);
      for (const result of agents) {
        console.log(`Removed agent files from ${result.agent}: ${result.noisegatePath}`);
      }
      return;
    }
    if (flags.show) {
      console.log(`config: ${configPath()}`);
      console.log('hook commands: git, rg, grep, pytest, npm, ls, find, cat');
      console.log('agent modes: --codex, --opencode, --all-agents');
      console.log('extension: installs VS Code extension automatically when VS Code is detected');
      console.log('  --no-vscode  Skip VS Code extension install');
      return;
    }
    ensureConfig();
    if (flags.agents.length) {
      const results = installAgentInstructions({ global: flags.global, agents: flags.agents });
      for (const result of results) {
        console.log(`Installed NoiseGate instructions for ${result.agent} in ${result.noisegatePath}`);
      }
      if (!flags.hookOnly && process.platform !== 'win32') {
        const hook = installHook({ global: flags.global, hookOnly: flags.hookOnly });
        console.log(`Installed shell hook in ${hook.profile}`);
      } else if (process.platform === 'win32') {
        console.log('Native Windows mode uses AGENTS.md/NOISEGATE.md instructions. Use WSL for shell auto-rewrite.');
      } else if (flags.hookOnly) {
        console.log('Hook-only mode: no shell functions installed.');
      }
      if (!flags.noVscode) {
        const vscode = installVscodeExtension();
        if (vscode.installed) console.log(`Installed VS Code extension from ${vscode.vsix}`);
        else if (vscode.reason) console.log(`VS Code extension: ${vscode.reason}`);
      }
    } else {
      const result = installHook({ global: flags.global, hookOnly: flags.hookOnly });
      console.log(`Installed noisegate hook in ${result.profile}`);
      console.log('Restart your shell or source the profile for changes to take effect.');
    }
    return;
  }

  if (subcommand === 'uninstall') {
    const hook = uninstallHook({});
    const vscode = uninstallVscodeExtension();
    const agents = uninstallAgentInstructions({ global: true });
    console.log(hook.changed ? `Removed shell hook from ${hook.profile}` : `No noisegate hook found in ${hook.profile}`);
    if (vscode.uninstalled) console.log('Uninstalled VS Code extension');
    else if (!vscode.reason?.includes('not found')) console.log(`VS Code extension: ${vscode.reason || 'skipped'}`);
    for (const result of agents) {
      console.log(`Removed agent files from ${result.agent}: ${result.noisegatePath}`);
    }
    return;
  }

  if (subcommand === 'gain') {
    console.log(formatGain());
    return;
  }

  if (subcommand === 'session') {
    if (flags.json) {
      console.log(JSON.stringify(analyticsSnapshot().session, null, 2));
    } else {
      console.log(formatSessionGain());
    }
    return;
  }

  if (subcommand === 'status') {
    const snapshot = analyticsSnapshot();
    if (flags.json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      console.log([
        `NoiseGate status`,
        `session_id: ${currentSessionId()}`,
        `session_saved: ${snapshot.session.savedTokens} tokens (${snapshot.session.savedPercent.toFixed(1)}%)`,
        `total_saved: ${snapshot.total.savedTokens} tokens (${snapshot.total.savedPercent.toFixed(1)}%)`
      ].join('\n'));
    }
    return;
  }

  if (subcommand === 'config') {
    ensureConfig();
    console.log(configPath());
    return;
  }

  const config = loadConfig();
  config.ultraCompact = flags.ultraCompact || config.ultraCompact;
  const command = subcommand;
  const args = positional.slice(1);
  const commandName = command.split(/[\\/]/).pop();

  const internal = runInternal(command, args);
  const result = internal
    ? { ...internal, durationMs: 0, binary: false }
    : runCommand(command, args);
  const rawOutput = `${result.stdout}${result.stderr}`;

  if (result.error) {
    console.error(`[noisegate] failed to execute ${command}: ${result.error.message}`);
    process.exit(result.status);
  }

  if (flags.verbose || config.excludedCommands.includes(commandName) || result.binary) {
    process.stdout.write(maybeStripAnsi(rawOutput, flags.colors && config.colors));
    process.exit(result.status);
  }

  let filtered;
  try {
    filtered = filterOutput(command, args, rawOutput, config);
  } catch (error) {
    process.stderr.write(`[noisegate] filter failed, printing raw output: ${error.message}\n`);
    process.stdout.write(maybeStripAnsi(rawOutput, flags.colors && config.colors));
    process.exit(result.status);
  }

  const body = maybeStripAnsi(filtered.text, flags.colors && config.colors);
  const meta = metadata({
    command,
    args,
    result,
    original: rawOutput,
    compressed: body,
    truncated: filtered.truncated
  });
  const finalOutput = `${body}${meta}\n`;
  process.stdout.write(finalOutput);
  recordRun(commandName, rawOutput, finalOutput);
  process.exit(result.status);
}
