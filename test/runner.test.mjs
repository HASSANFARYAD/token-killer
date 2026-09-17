import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandForTest, runCommand } from '../src/runner.js';

test('Windows PowerShell commands are routed through powershell.exe', { skip: process.platform !== 'win32' }, () => {
  const resolved = commandForTest('Get-Content', ['-Raw', 'README.md']);

  assert.equal(resolved.command, 'powershell.exe');
  assert.deepEqual(resolved.args.slice(0, 4), [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command'
  ]);
  assert.match(resolved.args[4], /^& \{ .*Get-Content @args; .*\}$/);
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
  // Use a fixture rather than a file in the repo: this asserts that the
  // PowerShell routing returns the file's contents, not what any doc says.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-runner-'));
  const fixture = path.join(dir, 'fixture.txt');
  fs.writeFileSync(fixture, '# Sesshush runner fixture\n');

  try {
    const result = runCommand('Get-Content', ['-Raw', fixture]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /# Sesshush runner fixture/);
    assert.equal(result.stderr, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
