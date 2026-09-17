// Third round: argument handling, escape sequences, binary output, config.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandForTest } from '../src/runner.js';
import { stripAnsi } from '../src/ansi.js';
import { sanitizeConfig, DEFAULT_CONFIG } from '../src/config.js';
import { runInternal } from '../src/internal.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin', 'sesshush.js');

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-safety-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args, dir) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: dir,
    env: { ...process.env, XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir }
  });
}

// ------------------------------------------------- argument handling --------
//
// Spawning with shell:true on Windows let cmd.exe interpret the metacharacters
// inside arguments: "a && echo x" ran echo, and "> f.txt" created a file.
// Wrapping a command must never change what that command does.

test('shell metacharacters in an argument are passed through literally', () => {
  withDir((dir) => {
    const script = path.join(dir, 'show.cjs');
    fs.writeFileSync(script, 'console.log("ARGV:" + JSON.stringify(process.argv.slice(2)));');

    for (const hostile of ['a && echo INJECTED', 'a | b', 'a & b', 'a; echo x', '$(echo x)', '`echo x`']) {
      const result = runCli(['node', script, hostile], dir);
      assert.equal(result.status, 0, result.stdout);
      assert.match(result.stdout, /ARGV:/);
      const argv = JSON.parse(result.stdout.match(/ARGV:(\[.*\])/)[1]);
      assert.deepEqual(argv, [hostile], `argument was reinterpreted: ${hostile}`);
      // The literal argument is echoed back inside ARGV, so look for the word
      // only where a second command's output would have appeared.
      assert.doesNotMatch(result.stdout, /^INJECTED$/m, `a second command ran for: ${hostile}`);
    }
  });
});

test('a redirect inside an argument does not create a file', () => {
  withDir((dir) => {
    const script = path.join(dir, 'show.cjs');
    fs.writeFileSync(script, 'console.log("done");');

    runCli(['node', script, '> injected.txt'], dir);

    assert.equal(fs.existsSync(path.join(dir, 'injected.txt')), false, 'a redirect in an argument took effect');
  });
});

test('arguments keep their quotes and percent signs', () => {
  withDir((dir) => {
    const script = path.join(dir, 'show.cjs');
    fs.writeFileSync(script, 'console.log("ARGV:" + JSON.stringify(process.argv.slice(2)));');

    const args = ['say "hi"', 'a b', '%PATH%', 'C:\\proj\\file.js'];
    const result = runCli(['node', script, ...args], dir);
    const argv = JSON.parse(result.stdout.match(/ARGV:(\[[\s\S]*\])/)[1]);

    assert.deepEqual(argv, args);
  });
});

test('a .cmd shim is invoked with quoted arguments', { skip: process.platform !== 'win32' }, () => {
  const resolved = commandForTest('npm', ['run', 'a && echo x']);

  if (!resolved.command.toLowerCase().includes('cmd.exe')) return; // npm resolved to an exe
  assert.equal(resolved.options.shell, false);
  assert.equal(resolved.options.windowsVerbatimArguments, true);
  // Every argument is quoted, which is what stops cmd.exe acting on && and >.
  assert.match(resolved.args[3], /"a && echo x"/);
});

test('commands are never spawned through a shell', () => {
  for (const [command, args] of [['git', ['status']], ['node', ['-v']], ['some-unknown-cmd', []]]) {
    const resolved = commandForTest(command, args);
    assert.notEqual(resolved.options.shell, true, `${command} is still spawned via a shell`);
  }
});

test('real commands still run after the resolution change', () => {
  withDir((dir) => {
    const result = runCli(['node', '--version'], dir);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /v\d+\./);
  });
});

test('a .cmd shim on PATH is still runnable', { skip: process.platform !== 'win32' }, () => {
  withDir((dir) => {
    const result = runCli(['npm', '--version'], dir);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /\d+\.\d+\.\d+/);
  });
});

// --------------------------------------------------- escape sequences -------

test('OSC escape sequences are stripped, not passed through', () => {
  // OSC 8 hyperlinks carry a full URL that is invisible but costs tokens.
  const link = '\u001b]8;;https://example.com/very/long/url\u0007click\u001b]8;;\u0007 done';
  assert.equal(stripAnsi(link), 'click done');

  // OSC 0/2 set the window title.
  assert.equal(stripAnsi('\u001b]0;Window Title\u0007text'), 'text');

  // ST-terminated form.
  assert.equal(stripAnsi('\u001b]8;;url\u001b\\link\u001b]8;;\u001b\\'), 'link');
});

test('CSI sequences are still stripped', () => {
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red');
  assert.equal(stripAnsi('\u001b[2K\u001b[1Gprogress'), 'progress');
});

test('text with no escapes is untouched', () => {
  assert.equal(stripAnsi('plain text [not] an escape'), 'plain text [not] an escape');
});

// ---------------------------------------------------------- binary ----------

test('reading a binary file describes it instead of dumping bytes', () => {
  withDir((dir) => {
    const blob = path.join(dir, 'blob.bin');
    fs.writeFileSync(blob, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff, 0x00, 0x41]));

    const result = runInternal('read', [blob]);

    assert.match(result.stdout, /<binary file:/);
    assert.doesNotMatch(result.stdout, /\ufffd/, 'binary was decoded as text');
    assert.equal(result.status, 0);
  });
});

test('binary command output is summarised rather than written through', () => {
  withDir((dir) => {
    const blob = path.join(dir, 'blob.bin');
    fs.writeFileSync(blob, Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256)));

    const result = runCli(['cat', blob], dir);

    assert.match(result.stdout, /<binary output: \d+ bytes, not shown/);
    assert.ok(result.stdout.length < 200, 'binary bytes reached the output');
  });
});

test('a text file is still read normally', () => {
  withDir((dir) => {
    const file = path.join(dir, 'notes.txt');
    fs.writeFileSync(file, 'first line\nsecond line\n');

    const result = runInternal('read', [file]);

    assert.match(result.stdout, /first line/);
    assert.match(result.stdout, /second line/);
  });
});

// ---------------------------------------------------------- config ----------

test('nonsensical config values fall back to defaults instead of erasing output', () => {
  for (const hostile of [
    { maxLines: -5 },
    { maxLines: 0 },
    { maxChars: 0 },
    { maxChars: -99 },
    { maxLines: 'abc' },
    { matchesPerFile: -1 },
    { diffContextLines: -3 }
  ]) {
    const config = sanitizeConfig(hostile);
    assert.ok(config.maxLines >= 1, `maxLines ${config.maxLines}`);
    assert.ok(config.maxChars >= 1, `maxChars ${config.maxChars}`);
    assert.ok(config.matchesPerFile >= 1);
    assert.ok(config.diffContextLines >= 0);
  }

  assert.equal(sanitizeConfig({ maxChars: 0 }).maxChars, DEFAULT_CONFIG.maxChars);
  assert.equal(sanitizeConfig({ maxLines: -5 }).maxLines, DEFAULT_CONFIG.maxLines);
});

test('a deliberately small but valid limit is respected', () => {
  assert.equal(sanitizeConfig({ maxLines: 10 }).maxLines, 10);
  assert.equal(sanitizeConfig({ diffContextLines: 0 }).diffContextLines, 0);
});

test('absurdly large limits are capped', () => {
  assert.ok(sanitizeConfig({ maxLines: 1e12 }).maxLines <= 100000);
  assert.ok(sanitizeConfig({ maxChars: 1e12 }).maxChars <= 10000000);
});

test('a config of the wrong shape does not break loading', () => {
  for (const shape of [null, undefined, [], 'a string', 42]) {
    const config = sanitizeConfig(shape);
    assert.deepEqual(config.excludedCommands, []);
    assert.equal(config.maxLines, DEFAULT_CONFIG.maxLines);
  }
});

test('excludedCommands is coerced to a list of strings', () => {
  assert.deepEqual(sanitizeConfig({ excludedCommands: 'notanarray' }).excludedCommands, []);
  assert.deepEqual(sanitizeConfig({ excludedCommands: ['git', 7, null, 'rg'] }).excludedCommands, ['git', 'rg']);
});
