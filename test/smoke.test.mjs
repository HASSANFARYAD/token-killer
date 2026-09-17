// Smoke tests for the published package.
//
// The package once shipped a bin/ entrypoint whose newlines had been stripped,
// so the shebang swallowed the whole file: every wrapped command produced no
// output and exited 0, which reads to an agent as a command that passed.
// These tests run the real binary the way npm installs it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin', 'sesshush.js');

function runCli(args, options = {}) {
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-smoke-'));
  try {
    return spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      cwd: options.cwd || repoRoot,
      env: {
        ...process.env,
        XDG_DATA_HOME: dataHome,
        XDG_CONFIG_HOME: dataHome,
        SESSHUSH_SESSION_ID: 'smoke',
        ...options.env
      }
    });
  } finally {
    fs.rmSync(dataHome, { recursive: true, force: true });
  }
}

test('the package entrypoint is a loadable module, not an inert shebang line', () => {
  const source = fs.readFileSync(cli, 'utf8');
  const lines = source.split('\n').filter((line) => line.trim());

  assert.ok(lines.length > 1, 'bin/sesshush.js collapsed onto a single line');
  assert.match(lines[0], /^#!/);
  assert.match(source, /main\(process\.argv\.slice\(2\)\)/);
});

test('--version prints a version and exits 0', () => {
  const result = runCli(['--version']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sesshush \d+\.\d+\.\d+/);
});

test('help is printed when no command is given', () => {
  const result = runCli([]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
});

// Run a script from a file rather than `node -e`: on Windows the runner spawns
// with shell:true, which mangles quoted inline scripts.
function withScript(body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-script-'));
  const file = path.join(dir, 'script.cjs');
  fs.writeFileSync(file, body);
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a wrapped command actually runs and produces output', () => {
  withScript('console.log("hello from the child");', (file) => {
    const result = runCli(['node', file]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /hello from the child/);
  });
});

test('a failing command exits non-zero and still reports why', () => {
  withScript('console.error("boom: the real reason"); process.exit(3);', (file) => {
    const result = runCli(['node', file]);

    assert.equal(result.status, 3, 'exit code must be propagated, not swallowed');
    assert.match(`${result.stdout}${result.stderr}`, /boom: the real reason/);
  });
});

test('a failing command is never compressed into silence', () => {
  const body = 'for (let i = 0; i < 400; i++) console.log("noise line " + i);\n'
    + 'console.error("FAIL: assertion x !== y");\nprocess.exit(1);\n';

  withScript(body, (file) => {
    const result = runCli(['node', file]);

    assert.equal(result.status, 1);
    assert.ok(result.stdout.trim().length > 0, 'failure produced no output at all');
    assert.match(result.stdout, /FAIL: assertion x !== y/);
  });
});

// Blocker 3: the vsix that shipped inside the npm tarball contained only 5
// files — no bin/, no src/ — so the extension it installed had no bundled CLI
// and auto-wrap failed outright. Skipped when no vsix has been built.
test('a built vsix contains a runnable bundled CLI', () => {
  const vsixDir = path.join(repoRoot, 'vscode-extension');
  const vsix = fs.readdirSync(vsixDir).filter((file) => file.endsWith('.vsix'));

  if (!vsix.length) return; // nothing packaged in this checkout

  const manifest = JSON.parse(fs.readFileSync(path.join(vsixDir, 'package.json'), 'utf8'));
  const expected = `${manifest.name}-${manifest.version}.vsix`;
  assert.ok(vsix.includes(expected), `expected ${expected}, found ${vsix.join(', ')}`);
  assert.equal(vsix.length, 1, `stale vsix alongside the current build: ${vsix.join(', ')}`);

  const entries = spawnSync(process.execPath, ['-e',
    `const z=require('zlib'),f=require('fs');const b=f.readFileSync(process.argv[1]);`
    + `let i=0,out=[];while((i=b.indexOf(Buffer.from('PK\\x03\\x04'),i))>=0){`
    + `const n=b.readUInt16LE(i+26),m=b.readUInt16LE(i+28);`
    + `out.push(b.slice(i+30,i+30+n).toString());i+=30+n+m;}console.log(out.join('\\n'));`,
    path.join(vsixDir, expected)
  ], { encoding: 'utf8' }).stdout;

  assert.match(entries, /extension\/bin\/sesshush\.js/, 'vsix has no bundled CLI');
  assert.match(entries, /extension\/src\/cli\.js/, 'vsix has no engine');
  assert.match(entries, /extension\/src\/filters\.js/, 'vsix has no filters');
});

test('engine copy shipped in the extension is in sync with src/', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'sync-engine.mjs'), '--check'], {
    encoding: 'utf8',
    cwd: repoRoot
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
