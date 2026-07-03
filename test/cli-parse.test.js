import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForTest } from '../src/cli.js';

test('proxy flags are parsed before command only', () => {
  const parsed = parseForTest(['--no-colors', 'git', 'diff', '--no-color']);
  assert.equal(parsed.flags.colors, false);
  assert.deepEqual(parsed.positional, ['git', 'diff', '--no-color']);
});

test('init flags are parsed after init', () => {
  const parsed = parseForTest(['init', '-g', '--hook-only']);
  assert.equal(parsed.flags.global, true);
  assert.equal(parsed.flags.hookOnly, true);
  assert.deepEqual(parsed.positional, ['init']);
});

test('agent init flags are parsed after init', () => {
  const parsed = parseForTest(['init', '-g', '--codex', '--uninstall']);
  assert.equal(parsed.flags.global, true);
  assert.deepEqual(parsed.flags.agents, ['codex']);
  assert.equal(parsed.flags.uninstall, true);
  assert.deepEqual(parsed.positional, ['init']);
});

test('opencode init flag is parsed', () => {
  const parsed = parseForTest(['init', '-g', '--opencode']);
  assert.equal(parsed.flags.global, true);
  assert.deepEqual(parsed.flags.agents, ['opencode']);
  assert.deepEqual(parsed.positional, ['init']);
});

test('all-agents init flag is parsed', () => {
  const parsed = parseForTest(['init', '-g', '--all-agents']);
  assert.equal(parsed.flags.global, true);
  assert.deepEqual(parsed.flags.agents, ['opencode', 'codex', 'claude']);
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
