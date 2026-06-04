import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForTest } from '../src/cli.js';

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
