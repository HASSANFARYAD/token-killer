// Regression tests for the second round of issues.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { filterOutput } from '../src/filters.js';
import { genericTruncate } from '../src/utils.js';
import { analyticsSnapshot, recordRun } from '../src/stats.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin', 'sesshush.js');

const config = {
  maxLines: 220,
  maxChars: 24000,
  matchesPerFile: 8,
  diffContextLines: 2,
  ultraCompact: false
};

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-rb-'));
  try {
    return fn(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function runCli(args, home, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, XDG_DATA_HOME: home, XDG_CONFIG_HOME: home, ...extraEnv }
  });
}

// ---------------------------------------------------------------- ordering --

test('stdout and stderr keep their real interleaving', () => {
  withHome((home) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-mix-'));
    const script = path.join(dir, 'mix.cjs');
    fs.writeFileSync(script,
      'process.stdout.write("1-out\\n");process.stderr.write("2-err\\n");'
      + 'process.stdout.write("3-out\\n");process.stderr.write("4-err\\n");');

    try {
      const result = runCli(['node', script], home);
      const order = ['1-out', '2-err', '3-out', '4-err'].map((line) => result.stdout.indexOf(line));

      assert.ok(order.every((index) => index >= 0), `missing lines in: ${result.stdout}`);
      assert.deepEqual(order, [...order].sort((a, b) => a - b), 'output was regrouped by stream');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --------------------------------------------------------- large capture ----

test('output larger than the old 64MB pipe no longer fails the command', { timeout: 120000 }, () => {
  withHome((home) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-big-'));
    const script = path.join(dir, 'big.cjs');
    // ~70MB, which used to abort with spawnSync ENOBUFS and lose every byte.
    fs.writeFileSync(script, 'const s="x".repeat(1024);for(let i=0;i<70000;i++)console.log(s);');

    try {
      const result = runCli(['node', script], home);

      assert.equal(result.status, 0, `a succeeding command must not be reported as failed: ${result.stdout.slice(0, 200)}`);
      assert.doesNotMatch(result.stdout, /ENOBUFS/);
      assert.ok(result.stdout.length > 0, 'all output was lost');
      assert.ok(result.stdout.length < 5 * 1024 * 1024, 'output was not compressed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ------------------------------------------------------------ concurrency ---

test('concurrent runs are all recorded', { timeout: 120000 }, () => {
  withHome((home) => {
    const runs = 16;
    const children = Array.from({ length: runs }, () => spawnSync(
      process.execPath,
      [cli, 'node', '-p', '1'],
      { encoding: 'utf8', cwd: repoRoot, env: { ...process.env, XDG_DATA_HOME: home, XDG_CONFIG_HOME: home } }
    ));

    assert.ok(children.every((child) => child.status === 0), 'a child failed');

    const db = JSON.parse(fs.readFileSync(path.join(home, 'sesshush', 'analytics.json'), 'utf8'));
    assert.equal(db.totalRuns, runs, 'runs were lost to a read-modify-write race');
  });
});

test('a corrupt analytics file does not break recording', () => {
  withHome((home) => {
    const previous = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = home;
    try {
      fs.mkdirSync(path.join(home, 'sesshush'), { recursive: true });
      fs.writeFileSync(path.join(home, 'sesshush', 'analytics.json'), '{ not json at all');

      assert.equal(recordRun('git', 'aaaa', 'a', { exitCode: 0 }), true);
      assert.equal(analyticsSnapshot().total.runs, 1);
    } finally {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
    }
  });
});

test('the session map is pruned so it cannot grow without limit', () => {
  withHome((home) => {
    const previous = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = home;
    try {
      for (let i = 0; i < 260; i += 1) {
        recordRun('git', 'aaaa', 'a', { exitCode: 0 });
        process.env.SESSHUSH_SESSION_ID = `session-${i}`;
      }
      const db = JSON.parse(fs.readFileSync(path.join(home, 'sesshush', 'analytics.json'), 'utf8'));
      assert.ok(Object.keys(db.sessions).length <= 200, `sessions grew to ${Object.keys(db.sessions).length}`);
    } finally {
      delete process.env.SESSHUSH_SESSION_ID;
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
    }
  });
});

// ---------------------------------------------------------------- unicode ---

test('truncation never splits a surrogate pair', () => {
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  for (const maxChars of [7, 8, 9, 10, 11, 12, 13]) {
    const head = genericTruncate('ab😀😀😀😀😀xyz', { maxLines: 500, maxChars });
    assert.ok(!lone.test(head.text), `lone surrogate at maxChars=${maxChars}`);

    const tail = genericTruncate('ab😀😀😀😀😀xyz', { maxLines: 500, maxChars, preserveTail: true });
    assert.ok(!lone.test(tail.text), `lone surrogate (tail) at maxChars=${maxChars}`);
  }
});

// ------------------------------------------------------------------ read ----

test('reading a file keeps comments by default', () => {
  const source = [
    '# Copyright 2026 Acme Corp.',
    'import os',
    '',
    '# TODO: threshold must stay 0.85 per ticket SEC-4412',
    'THRESHOLD = 0.85'
  ].join('\n');

  const text = filterOutput('cat', ['demo.py'], source, config).text;

  assert.match(text, /Copyright 2026 Acme Corp/);
  assert.match(text, /SEC-4412/);
  assert.match(text, /THRESHOLD = 0\.85/);
});

test('a markdown H1 is not mistaken for a comment', () => {
  const text = filterOutput('cat', ['notes.md'], '# Deployment Runbook\nintro\n## Step 1\n', config).text;

  assert.match(text, /# Deployment Runbook/);
  assert.match(text, /## Step 1/);
});

test('comment stripping is still available when asked for', () => {
  const source = '# a comment\ncode = 1\n';
  const text = filterOutput('cat', ['x.py'], source, { ...config, stripComments: true }).text;

  assert.doesNotMatch(text, /a comment/);
  assert.match(text, /code = 1/);
});

// ------------------------------------------------------------ diagnostics ---

test('compiler diagnostics survive; progress noise does not', () => {
  const cases = [
    {
      command: 'go',
      args: ['build'],
      raw: ['go: downloading example.com/x v1.2.3', './main.go:5:2: undefined: foo'],
      keep: [/\.\/main\.go:5:2: undefined: foo/],
      drop: [/downloading/]
    },
    {
      command: 'tsc',
      args: ['--noEmit'],
      raw: ['src/a.ts(12,5): error TS2345: not assignable', 'Found 1 error.'],
      keep: [/TS2345/, /Found 1 error/],
      drop: []
    },
    {
      command: 'dotnet',
      args: ['build'],
      raw: ['  Determining projects to restore...', 'C:\\proj\\S.cs(88,13): error CS0103: name does not exist', '    1 Error(s)'],
      keep: [/CS0103/, /1 Error\(s\)/, /C:\\proj\\S\.cs/],
      drop: [/Determining projects/]
    }
  ];

  for (const { command, args, raw, keep, drop } of cases) {
    const text = filterOutput(command, args, raw.join('\n'), { ...config, failed: true, preserveTail: true }).text;
    for (const re of keep) assert.match(text, re, `${command}: dropped a diagnostic`);
    for (const re of drop) assert.doesNotMatch(text, re, `${command}: kept progress noise`);
  }
});

test('a rust diagnostic keeps its whole snippet block', () => {
  const raw = [
    '   Compiling foo v0.1.0',
    'error[E0308]: mismatched types',
    ' --> src/main.rs:4:18',
    '  |',
    '4 |     let x: i32 = "s";',
    '  |                  ^^^ expected i32'
  ].join('\n');

  const text = filterOutput('cargo', ['build'], raw, { ...config, failed: true, preserveTail: true }).text;

  assert.match(text, /E0308/);
  assert.match(text, /let x: i32 = "s";/, 'the offending source line was dropped');
  assert.match(text, /\^\^\^ expected i32/);
  assert.doesNotMatch(text, /Compiling foo/);
});

test('build output is treated as failure-safe', () => {
  // A failed build must still be compressed rather than dumped raw.
  const raw = ['step 1', 'step 2', 'src/a.ts(1,1): error TS1005: expected'].join('\n');
  const text = filterOutput('tsc', [], raw, { ...config, failed: true, preserveTail: true }).text;

  assert.match(text, /TS1005/);
  assert.doesNotMatch(text, /step 1/);
});
