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

function shouldUsePowerShell(command) {
  return process.platform === 'win32' && POWERSHELL_COMMANDS.has(command.toLowerCase());
}

export function commandForTest(command, args) {
  if (!shouldUsePowerShell(command)) {
    return {
      command,
      args,
      options: {
        shell: process.platform === 'win32'
      }
    };
  }

  return {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `& { ${command} @args }`,
      ...args
    ],
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
    env: { ...process.env, RTK_NODE_ACTIVE: '1' }
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
