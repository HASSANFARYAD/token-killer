// Item 2: output from a failed command is compressed too.
//
// The CLI used to return raw output as soon as the exit code was non-zero, so
// the test-output filter — the one written specifically to strip passing noise
// and keep failures — could never run on a failing build, which is the case
// that produces the most output and matters most.
//
// Compressing failures is only safe if the reason for the failure survives, so
// these tests pin both halves: the output shrinks, and the error is still there.

import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, filterOutput, isFailureSafe } from '../src/filters.js';
import { genericTruncate } from '../src/utils.js';

const config = {
  maxLines: 220,
  maxChars: 24000,
  matchesPerFile: 8,
  diffContextLines: 2,
  ultraCompact: false
};

function pytestOutput() {
  const passing = Array.from({ length: 200 }, (_, i) => `tests/test_thing.py::test_case_${i} PASSED   [ 50%]`);
  return [
    ...passing,
    '=================================== FAILURES ===================================',
    '________________________________ test_the_one _________________________________',
    '    def test_the_one():',
    '>       assert compute(2) == 5',
    'E       AssertionError: assert 4 == 5',
    'tests/test_thing.py:91: AssertionError',
    '=========================== short test summary info ============================',
    'FAILED tests/test_thing.py::test_the_one - AssertionError: assert 4 == 5',
    '======================== 1 failed, 200 passed in 3.21s ========================='
  ].join('\n');
}

test('a failing test run is compressed and keeps the failure', () => {
  const raw = pytestOutput();
  const result = filterOutput('pytest', ['-q'], raw, { ...config, failed: true, preserveTail: true });

  assert.ok(result.text.length < raw.length / 2, 'failing output was not meaningfully compressed');
  assert.match(result.text, /AssertionError: assert 4 == 5/);
  assert.match(result.text, /FAILED tests\/test_thing\.py::test_the_one/);
  assert.match(result.text, /1 failed, 200 passed/);
  assert.doesNotMatch(result.text, /test_case_7 PASSED/);
});

test('the test filter is the one applied to a failed test command', () => {
  assert.ok(isFailureSafe(classify('pytest', ['-q'], { failed: true })));
  assert.ok(isFailureSafe(classify('npm', ['test'], { failed: true })));
});

test('summarizing filters are not applied to a failed command', () => {
  // gitOk reduces output to "ok push"; on a failure that would hide the error.
  assert.ok(classify('git', ['push'], { failed: false }), 'git push should have a filter on success');
  assert.equal(classify('git', ['push'], { failed: true }), null);
  assert.equal(classify('git', ['status'], { failed: true }), null);
  assert.equal(classify('git', ['diff'], { failed: true }), null);
});

test('a failed push keeps its error instead of reporting success', () => {
  const raw = 'fatal: No configured push destination.\nrun git remote add <name> <url>\n';
  const result = filterOutput('git', ['push'], raw, { ...config, failed: true, preserveTail: true });

  assert.match(result.text, /No configured push destination/);
  assert.doesNotMatch(result.text, /^ok push/m);
});

test('generic truncation keeps the tail when the command failed', () => {
  const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
  lines.push('ERROR: the actual reason it failed');
  const raw = lines.join('\n');

  const onFailure = genericTruncate(raw, { ...config, maxLines: 40, preserveTail: true });
  assert.match(onFailure.text, /ERROR: the actual reason it failed/);

  const onSuccess = genericTruncate(raw, { ...config, maxLines: 40 });
  assert.equal(onSuccess.truncated, true);
});

test('character-level truncation also keeps the tail on failure', () => {
  const raw = `${'x'.repeat(5000)}\nERROR: trailing reason`;
  const result = genericTruncate(raw, { ...config, maxChars: 500, preserveTail: true });

  assert.match(result.text, /ERROR: trailing reason/);
  assert.equal(result.truncated, true);
});
