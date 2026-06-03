import { filterOutput } from './filters.js';
import { installCodexInstructions, installHook, uninstallCodexInstructions, uninstallHook } from './hooks.js';
import { loadConfig, ensureConfig, configPath } from './config.js';
import { formatGain, recordRun } from './stats.js';
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
    codex: false,
    show: false
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
      else if (arg === '--codex') flags.codex = true;
      else if (arg === '--show') flags.show = true;
      else if (arg === '--uninstall') flags.uninstall = true;
      else positional.push(arg);
    }
  } else {
    positional.push(...rest);
  }

  return { flags, positional };
}

export const parseForTest = parse;

function help() {
  return `rtk-node - thin command output proxy

Usage:
  rtk-node <command> [args...]
  rtk-node init [-g] [--hook-only]
  rtk-node init -g --codex
  rtk-node init -g --uninstall
  rtk-node uninstall
  rtk-node gain
  rtk-node config

Flags:
  --no-colors       Strip ANSI color codes from output
  -v, --verbose     Print unfiltered command output
  -u, --ultra-compact
                    Use more aggressive truncation and shorter summaries
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
    '--- rtk-node metadata ---',
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
      const codex = uninstallCodexInstructions({ global: flags.global });
      console.log(`Removed shell hook from ${hook.profile}`);
      console.log(`Removed Codex RTK files from ${codex.root}`);
      return;
    }
    if (flags.show) {
      console.log(`config: ${configPath()}`);
      console.log('hook commands: git, rg, grep, pytest, npm, ls, find, cat');
      console.log('codex mode: rtk-node init -g --codex');
      return;
    }
    ensureConfig();
    if (flags.codex) {
      const codex = installCodexInstructions({ global: flags.global });
      console.log(`Installed Codex RTK instructions in ${codex.root}`);
      if (!flags.hookOnly && process.platform !== 'win32') {
        const hook = installHook({ global: flags.global, hookOnly: flags.hookOnly });
        console.log(`Installed shell hook in ${hook.profile}`);
      } else if (process.platform === 'win32') {
        console.log('Native Windows Codex mode uses AGENTS.md/RTK.md instructions. Use WSL for shell auto-rewrite.');
      }
    } else {
      const result = installHook({ global: flags.global, hookOnly: flags.hookOnly });
      console.log(`Installed rtk-node hook in ${result.profile}`);
      console.log('Restart your shell or source the profile for changes to take effect.');
    }
    return;
  }

  if (subcommand === 'uninstall') {
    const result = uninstallHook({});
    console.log(result.changed ? `Removed rtk-node hook from ${result.profile}` : `No rtk-node hook found in ${result.profile}`);
    return;
  }

  if (subcommand === 'gain') {
    console.log(formatGain());
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
    console.error(`[rtk-node] failed to execute ${command}: ${result.error.message}`);
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
    process.stderr.write(`[rtk-node] filter failed, printing raw output: ${error.message}\n`);
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
