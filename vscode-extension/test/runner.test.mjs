import test from 'node:test';
import assert from 'node:assert/strict';
import { commandForTest, runCommand } from '../src/runner.js';

test('Windows PowerShell commands are routed through powershell.exe', { skip: process.platform !== 'win32' }, () => {
  const resolved = commandForTest('Get-Content', ['-Raw', 'README.md']);

  assert.equal(resolved.command, 'powershell.exe');
  assert.deepEqual(resolved.args.slice(0, 5), [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    '& { Get-Content @args }'
  ]);
  assert.deepEqual(resolved.args.slice(5), ['-Raw', 'README.md']);
  assert.equal(resolved.options.shell, false);
});

test('regular commands keep the executable runner path', () => {
  const resolved = commandForTest('git', ['status']);

  assert.equal(resolved.command, 'git');
  assert.deepEqual(resolved.args, ['status']);
  assert.equal(resolved.options.shell, process.platform === 'win32');
});

test('regular commands preserve dot path arguments', () => {
  const resolved = commandForTest('git', ['add', '.']);

  assert.equal(resolved.command, 'git');
  assert.deepEqual(resolved.args, ['add', '.']);
  assert.equal(resolved.options.shell, process.platform === 'win32');
});

test('runs PowerShell cmdlets on Windows', { skip: process.platform !== 'win32' }, () => {
  const result = runCommand('Get-Content', ['-Raw', 'README.md']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /# RTK Token Savings for VS Code/);
  assert.equal(result.stderr, '');
});
