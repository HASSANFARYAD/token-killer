import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseFinalOutputForTest, parseForTest } from '../src/cli.js';

test('proxy flags are parsed before command only', () => {
  const parsed = parseForTest(['--no-colors', 'git', 'diff', '--no-color']);
  assert.equal(parsed.flags.colors, false);
  assert.deepEqual(parsed.positional, ['git', 'diff', '--no-color']);
});

test('explain is parsed as a proxy flag before command only', () => {
  const parsed = parseForTest(['--explain', 'rg', '--explain', 'TODO']);
  assert.equal(parsed.flags.explain, true);
  assert.deepEqual(parsed.positional, ['rg', '--explain', 'TODO']);
});

test('init flags are parsed after init', () => {
  const parsed = parseForTest(['init', '-g', '--hook-only']);
  assert.equal(parsed.flags.global, true);
  assert.equal(parsed.flags.hookOnly, true);
  assert.deepEqual(parsed.positional, ['init']);
});

test('init accepts a concrete rtk command for shell hooks', () => {
  const parsed = parseForTest(['init', '-g', '--hook-only', '--command', "'/usr/bin/node' '/ext/bin/rtk-node.js'"]);
  assert.equal(parsed.flags.global, true);
  assert.equal(parsed.flags.hookOnly, true);
  assert.equal(parsed.flags.rtkCommand, "'/usr/bin/node' '/ext/bin/rtk-node.js'");
  assert.deepEqual(parsed.positional, ['init']);
});

test('codex init flags are parsed after init', () => {
  const parsed = parseForTest(['init', '-g', '--codex', '--uninstall']);
  assert.equal(parsed.flags.global, true);
  assert.equal(parsed.flags.codex, true);
  assert.equal(parsed.flags.uninstall, true);
  assert.deepEqual(parsed.positional, ['init']);
});

test('status json flag is parsed after status', () => {
  const parsed = parseForTest(['status', '--json']);
  assert.equal(parsed.flags.json, true);
  assert.deepEqual(parsed.positional, ['status']);
});

test('session json flag is parsed after session', () => {
  const parsed = parseForTest(['session', '--json']);
  assert.equal(parsed.flags.json, true);
  assert.deepEqual(parsed.positional, ['session']);
});

test('agent no summary flag is parsed after agent', () => {
  const parsed = parseForTest(['agent', '--no-summary', 'codex', '--version']);
  assert.equal(parsed.flags.noSummary, true);
  assert.deepEqual(parsed.positional, ['agent', 'codex', '--version']);
});

test('final output omits metadata when metadata would expand filtered output', () => {
  const output = chooseFinalOutputForTest({
    rawOutput: 'one\ntwo\nthree\n',
    body: 'summary',
    meta: '\n--- rtk-node metadata ---\nlarge footer',
    explain: ''
  });

  assert.equal(output, 'summary\n');
});

test('final output keeps metadata when it still saves space', () => {
  const output = chooseFinalOutputForTest({
    rawOutput: 'a'.repeat(200),
    body: 'summary',
    meta: '\n--- rtk-node metadata ---\nok',
    explain: ''
  });

  assert.match(output, /rtk-node metadata/);
});
