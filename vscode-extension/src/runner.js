// GENERATED FILE - do not edit. Source: src/runner.js (npm run sync:engine)
import { spawnSync } from 'node:child_process';
import { isProbablyBinary } from './utils.js';

const POWERSHELL_COMMANDS = new Set([
  'cat',
  'cd',
  'copy',
  'cp',
  'del',
  'dir',
  'echo',
  'erase',
  'gc',
  'gci',
  'get-childitem',
  'get-content',
  'ls',
  'mkdir',
  'move',
  'mv',
  'pwd',
  'remove-item',
  'ren',
  'rename-item',
  'rm',
  'set-content',
  'type',
  'write-output'
]);

// These read stdin when given no file operand. Rewriting them to a cmdlet then
// produces "Get-Content: missing mandatory parameter -Path" instead of reading
// the pipe, so route them to the real command in that case.
const STDIN_READERS = new Set(['cat', 'type', 'gc', 'get-content']);

function hasFileOperand(args) {
  return args.some((arg) => !arg.startsWith('-'));
}

function shouldUsePowerShell(command, args = []) {
  if (process.platform !== 'win32') return false;
  const name = command.toLowerCase();
  if (!POWERSHELL_COMMANDS.has(name)) return false;
  if (STDIN_READERS.has(name) && !hasFileOperand(args)) return false;
  return true;
}

export function commandForTest(command, args = []) {
  if (!shouldUsePowerShell(command, args)) {
    return {
      command,
      args,
      options: {
        shell: process.platform === 'win32'
      }
    };
  }

  // A failing cmdlet raises a non-terminating error and leaves powershell.exe
  // exiting 0, which reports a failed command to the caller as a success.
  // Reset $LASTEXITCODE, then translate both native exit codes and cmdlet
  // errors ($?) into a real process exit code.
  //
  // powershell.exe -Command appends any trailing arguments to the command
  // text, and they are what populates @args, so the script block invocation
  // has to be the last thing in the string: the exit handling goes inside it.
  const script = '& { '
    + '$global:LASTEXITCODE = 0; '
    + `${command} @args; `
    + '$ok = $?; '
    + 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; '
    + 'if (-not $ok) { exit 1 } '
    + '}';

  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args],
    options: {
      shell: false
    }
  };
}

export function runCommand(command, args) {
  const started = process.hrtime.bigint();
  const resolved = commandForTest(command, args);
  const result = spawnSync(resolved.command, resolved.args, {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    ...resolved.options,
    // Hand our stdin straight to the child so `producer | sesshush consumer`
    // works. Reading it here instead would block forever whenever stdin is an
    // open pipe that never closes, which is the normal case under CI and agent
    // harnesses. stdout/stderr stay piped so they can still be filtered.
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, SESSHUSH_ACTIVE: '1' }
  });
  const ended = process.hrtime.bigint();
  const durationMs = Number(ended - started) / 1_000_000;

  const stdoutBuffer = result.stdout || Buffer.alloc(0);
  const stderrBuffer = result.stderr || Buffer.alloc(0);
  const combined = Buffer.concat([stdoutBuffer, stderrBuffer]);
  const binary = isProbablyBinary(combined);

  return {
    stdout: stdoutBuffer.toString('utf8'),
    stderr: stderrBuffer.toString('utf8'),
    rawBuffer: combined,
    status: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal,
    error: result.error,
    durationMs,
    binary
  };
}
