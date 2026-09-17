// Blocker 2: piped stdin was dropped, and a failing PowerShell cmdlet exited 0.
//
// `echo x | sesshush cat` produced a Get-Content error AND exit 0, so an agent
// saw a failed command as a success — the same false-pass that the broken bin/
// entrypoint used to produce.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandForTest } from '../src/runner.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin', 'sesshush.js');

function runCli(args, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-stdin-'));
  try {
    return spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      cwd: options.cwd || repoRoot,
      input: options.input,
      env: { ...process.env, XDG_DATA_HOME: home, XDG_CONFIG_HOME: home, SESSHUSH_SESSION_ID: 'stdin' }
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('piped stdin reaches the wrapped command', () => {
  const result = runCli(['cat'], { input: 'hello-from-stdin\n' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /hello-from-stdin/);
});

test('piped stdin reaches a filtering consumer', () => {
  const result = runCli(['grep', 'beta'], { input: 'alpha\nbeta\ngamma\n' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /beta/);
  assert.doesNotMatch(result.stdout, /alpha/);
});

test('PowerShell routing is skipped for a stdin reader with no file operand', {
  skip: process.platform !== 'win32'
}, () => {
  // Get-Content requires a -Path and cannot read a pipe, so `cat` reading stdin
  // must not be rewritten into a cmdlet.
  assert.equal(commandForTest('cat', []).command, 'cat');
  assert.equal(commandForTest('cat', ['-']).command, 'cat');
  assert.equal(commandForTest('cat', ['file.txt']).command, 'powershell.exe');
});

test('a failing PowerShell cmdlet exits non-zero', { skip: process.platform !== 'win32' }, () => {
  const missing = path.join(os.tmpdir(), 'sesshush-definitely-missing-file.txt');
  const result = runCli(['cat', missing]);

  assert.notEqual(result.status, 0, 'a failed cmdlet must not report success');
});

test('a succeeding PowerShell cmdlet still exits zero and returns content', {
  skip: process.platform !== 'win32'
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-ps-'));
  const file = path.join(dir, 'fixture.txt');
  fs.writeFileSync(file, 'fixture line\n');

  try {
    const result = runCli(['cat', file]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fixture line/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the PowerShell script keeps the script block last so @args is populated', {
  skip: process.platform !== 'win32'
}, () => {
  const resolved = commandForTest('Get-Content', ['-Raw', 'file.txt']);
  const script = resolved.args[4];

  // powershell.exe -Command appends trailing args to the command text, and that
  // is what fills @args, so nothing may follow the closing brace.
  assert.match(script, /\}$/);
  assert.match(script, /Get-Content @args/);
  assert.match(script, /\$global:LASTEXITCODE = 0/);
  assert.match(script, /if \(-not \$ok\) \{ exit 1 \}/);
  assert.deepEqual(resolved.args.slice(5), ['-Raw', 'file.txt']);
});
