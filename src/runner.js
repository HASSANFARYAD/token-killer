import { spawnSync } from 'node:child_process';
import { isProbablyBinary } from './utils.js';

export function runCommand(command, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
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
