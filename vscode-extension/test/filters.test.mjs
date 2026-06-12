import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOutput } from '../src/filters.js';

const config = {
  maxLines: 30,
  maxChars: 4000,
  matchesPerFile: 2,
  diffContextLines: 1,
  ultraCompact: false
};

test('Get-Content uses the read filter', () => {
  const output = [
    '# comment',
    '',
    '',
    'value one',
    'value two'
  ].join('\n');

  const result = filterOutput('Get-Content', ['-Raw', 'file.txt'], output, config);

  assert.match(result.text, /value one/);
  assert.match(result.text, /value two/);
  assert.doesNotMatch(result.text, /comment/);
  assert.equal(result.explain.filter, 'read');
});

test('Get-ChildItem compacts PowerShell directory output', () => {
  const output = [
    '',
    '    Directory: D:\\Projects\\RTK\\vscode-extension',
    '',
    '',
    'Mode                 LastWriteTime         Length Name',
    '----                 -------------         ------ ----',
    'd-----          6/5/2026   2:08 PM                .vscode',
    'd-----          6/3/2026   9:44 PM                bin',
    '-a----          6/9/2026   3:49 PM          31404 extension.js',
    '-a----          6/8/2026   3:42 PM           7191 README.md'
  ].join('\n');

  const result = filterOutput('Get-ChildItem', ['-Force'], output, config);

  assert.match(result.text, /\.vscode\//);
  assert.match(result.text, /bin\//);
  assert.match(result.text, /extension\.js 30\.7K/);
  assert.match(result.text, /README\.md 7\.0K/);
  assert.match(result.text, /Summary: 2 files, 2 dirs/);
  assert.doesNotMatch(result.text, /LastWriteTime/);
});

test('package-manager test/build failures use test-output filtering', () => {
  const output = [
    'lots of setup noise',
    'FAIL src/app.test.ts',
    'AssertionError: expected true',
    'Test Suites: 1 failed, 1 total',
    'Tests: 1 failed, 4 passed'
  ].join('\n');

  for (const [command, args] of [
    ['npm', ['run', 'build']],
    ['pnpm', ['test']],
    ['yarn', ['test']]
  ]) {
    const result = filterOutput(command, args, output, config);
    assert.equal(result.explain.filter, 'test output');
    assert.match(result.text, /FAIL src\/app\.test\.ts/);
    assert.match(result.text, /AssertionError/);
  }
});

test('git status, diff, and log have command-specific filters', () => {
  assert.equal(filterOutput('git', ['status'], '## main\n M file.js\n?? new.js', config).explain.filter, 'git status');
  assert.equal(filterOutput('git', ['diff'], 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new', config).explain.filter, 'git diff');
  assert.equal(filterOutput('git', ['log'], 'commit 1234567890abcdef\nAuthor: Test\n', config).explain.filter, 'git log');
});
