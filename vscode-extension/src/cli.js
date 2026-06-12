import { spawnSync } from 'node:child_process';
import { filterOutput } from './filters.js';
import { runAgent } from './agent.js';
import { installCodexInstructions, installHook, uninstallCodexInstructions, uninstallHook } from './hooks.js';
import { loadConfig, ensureConfig, configPath } from './config.js';
import { analyticsSnapshot, currentSessionId, formatGain, formatSessionGain, recordRun } from './stats.js';
import { runCommand } from './runner.js';
import { runInternal } from './internal.js';
import { byteLength, lineCount } from './utils.js';
import { maybeStripAnsi } from './ansi.js';

const VERSION = '0.1.1';

function parse(argv) {
  const flags = {
    colors: true,
    verbose: false,
    explain: false,
    ultraCompact: false,
    hookOnly: false,
    global: false,
    codex: false,
    show: false,
    json: false,
    noSummary: false,
    command: ''
  };
  const positional = [];
  let i = 0;

  for (; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-colors') flags.colors = false;
    else if (arg === '-v' || arg === '--verbose') flags.verbose = true;
    else if (arg === '--explain') flags.explain = true;
    else if (arg === '-u' || arg === '--ultra-compact') flags.ultraCompact = true;
    else break;
  }

  if (i >= argv.length) return { flags, positional };

  const command = argv[i];
  positional.push(command);
  const rest = argv.slice(i + 1);

  if (command === 'init') {
    for (let restIndex = 0; restIndex < rest.length; restIndex += 1) {
      const arg = rest[restIndex];
      if (arg === '--hook-only') flags.hookOnly = true;
      else if (arg === '-g' || arg === '--global') flags.global = true;
      else if (arg === '--codex') flags.codex = true;
      else if (arg === '--show') flags.show = true;
      else if (arg === '--uninstall') flags.uninstall = true;
      else if (arg === '--command') flags.command = rest[++restIndex] || '';
      else positional.push(arg);
    }
  } else if (command === 'status' || command === 'session') {
    for (const arg of rest) {
      if (arg === '--json') flags.json = true;
      else positional.push(arg);
    }
  } else if (command === 'agent') {
    for (const arg of rest) {
      if (arg === '--no-summary') flags.noSummary = true;
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
  rtk-node init [-g] [--hook-only] [--command <rtk-command>]
  rtk-node init -g --codex
  rtk-node init -g --uninstall
  rtk-node uninstall
  rtk-node uninstall-hooks
  rtk-node doctor
  rtk-node gain
  rtk-node session [--json]
  rtk-node status [--json]
  rtk-node agent [--no-summary] <codex|claude|command> [args...]
  rtk-node config

Flags:
  --no-colors       Strip ANSI color codes from output
  -v, --verbose     Print unfiltered command output
  --explain         Print a short explanation of the applied compression
  -u, --ultra-compact
                    Use more aggressive truncation and shorter summaries
`;
}

function doctorReport() {
  const lines = [
    'RTK doctor',
    `version: ${VERSION}`,
    `platform: ${process.platform}`,
    `node: ${process.version}`,
    `cwd: ${process.cwd()}`,
    `config: ${configPath()}`,
    `RTK_NODE_ACTIVE: ${process.env.RTK_NODE_ACTIVE ? 'set' : 'not set'}`,
    `RTK_NODE_HOOK: ${process.env.RTK_NODE_HOOK ? 'set' : 'not set'}`,
    `PATH: ${process.env.PATH || process.env.Path || ''}`
  ];

  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  for (const command of ['git', 'node', process.platform === 'win32' ? 'python' : 'python3']) {
    const result = spawnSync(lookup, [command], { encoding: 'utf8', shell: false });
    lines.push(`${command}: ${result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : 'not found'}`);
  }

  return lines.join('\n');
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

function explainMetadata(explain) {
  if (!explain) return '';
  const lines = [
    '',
    '--- rtk-node explain ---',
    `filter: ${explain.filter || 'unknown'}`
  ];
  if (typeof explain.originalLines === 'number') lines.push(`original_lines: ${explain.originalLines}`);
  if (typeof explain.outputLines === 'number') lines.push(`output_lines: ${explain.outputLines}`);
  if (typeof explain.omittedLines === 'number') lines.push(`omitted_lines: ${explain.omittedLines}`);
  if (Array.isArray(explain.kept) && explain.kept.length) lines.push(`kept: ${explain.kept.join('; ')}`);
  if (Array.isArray(explain.omitted) && explain.omitted.length) lines.push(`omitted: ${explain.omitted.join('; ')}`);
  return lines.join('\n');
}

function chooseFinalOutput({ rawOutput, body, meta, explain }) {
  const withMetadata = `${body}${meta}${explain}\n`;
  const bodyOnly = body ? `${body}\n` : '';
  const rawBytes = byteLength(rawOutput);
  const bodyBytes = byteLength(bodyOnly);
  const withMetadataBytes = byteLength(withMetadata);

  if (rawBytes === 0) return bodyOnly;
  if (withMetadataBytes <= rawBytes) return withMetadata;
  if (bodyBytes < rawBytes) return bodyOnly;
  return rawOutput;
}

export const chooseFinalOutputForTest = chooseFinalOutput;

export async function main(argv) {
  const { flags, positional } = parse(argv);
  const subcommand = positional[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(help());
    return;
  }

  if (subcommand === '--version' || subcommand === 'version') {
    console.log(`rtk-node ${VERSION}`);
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
        const hook = installHook({ global: flags.global, hookOnly: flags.hookOnly, command: flags.command });
        console.log(`Installed shell hook in ${hook.profile}`);
      } else if (process.platform === 'win32') {
        console.log('Native Windows Codex mode uses AGENTS.md/RTK.md instructions. Use WSL for shell auto-rewrite.');
      }
    } else {
      const result = installHook({ global: flags.global, hookOnly: flags.hookOnly, command: flags.command });
      console.log(`Installed rtk-node hook in ${result.profile}`);
      console.log('Restart your shell or source the profile for changes to take effect.');
    }
    return;
  }

  if (subcommand === 'uninstall' || subcommand === 'uninstall-hooks') {
    const result = uninstallHook({});
    console.log(result.changed ? `Removed rtk-node hook from ${result.profile}` : `No rtk-node hook found in ${result.profile}`);
    return;
  }

  if (subcommand === 'doctor') {
    console.log(doctorReport());
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
        `RTK status`,
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

  if (subcommand === 'agent') {
    const status = runAgent(positional[1], positional.slice(2), { summary: !flags.noSummary });
    if (typeof status === 'number') process.exit(status);
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

  if (result.status !== 0) {
    process.stdout.write(maybeStripAnsi(rawOutput, flags.colors && config.colors));
    recordRun(commandName, rawOutput, rawOutput, {
      exitCode: result.status,
      durationMs: result.durationMs,
      truncated: false
    });
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
  const explain = flags.explain ? explainMetadata(filtered.explain) : '';
  const finalOutput = chooseFinalOutput({ rawOutput, body, meta, explain });
  process.stdout.write(finalOutput);
  recordRun(commandName, rawOutput, finalOutput, {
    exitCode: result.status,
    durationMs: result.durationMs,
    truncated: filtered.truncated
  });
  process.exit(result.status);
}
