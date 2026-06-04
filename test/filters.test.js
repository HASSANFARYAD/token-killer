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

test('git status summarizes porcelain output', () => {
  const output = [
    '## main...origin/main',
    ' M src/a.js',
    'M  src/b.js',
    '?? src/c.js'
  ].join('\n');
  const result = filterOutput('git', ['status'], output, config);
  assert.match(result.text, /git status on main/);
  assert.match(result.text, /staged: 1/);
  assert.match(result.text, /unstaged: 1/);
  assert.match(result.text, /untracked: 1/);
});

test('git diff keeps hunks and omits context', () => {
  const output = [
    'diff --git a/a.js b/a.js',
    'index 111..222 100644',
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -1,4 +1,4 @@',
    ' context',
    ' unchanged',
    '-old',
    '+new'
  ].join('\n');
  const result = filterOutput('git', ['diff'], output, config);
  assert.match(result.text, /diff --git/);
  assert.match(result.text, /@@ -1,4 \+1,4 @@/);
  assert.match(result.text, /-old/);
  assert.match(result.text, /\+new/);
});

test('git diff --stat preserves stat rows', () => {
  const output = [
    ' src/cli.js     | 12 +++++++++---',
    ' src/filters.js |  8 +++++++-',
    ' 2 files changed, 16 insertions(+), 4 deletions(-)'
  ].join('\n');
  const result = filterOutput('git', ['diff', '--stat'], output, config);

  assert.match(result.text, /src\/cli\.js/);
  assert.match(result.text, /2 files changed/);
  assert.equal(result.explain.filter, 'git diff stat');
});

test('rg groups matches by file and caps per file', () => {
  const output = [
    'src/a.js:1:TODO one',
    'src/a.js:2:TODO two',
    'src/a.js:3:TODO three',
    'src/b.js:4:TODO four'
  ].join('\n');
  const result = filterOutput('rg', ['TODO'], output, config);
  assert.match(result.text, /src\/a\.js \(3 matches\)/);
  assert.match(result.text, /1: TODO one/);
  assert.match(result.text, /\.\.\. \(1 more matches\)/);
  assert.match(result.text, /src\/b\.js \(1 matches\)/);
  assert.equal(result.explain.filter, 'search matches');
  assert.match(result.explain.kept.join(' '), /up to 2 matches per file/);
  assert.equal(Object.hasOwn(result.explain, 'rawOutput'), false);
});

test('pytest keeps failures and summary', () => {
  const output = [
    'test_ok.py .',
    'test_bad.py F',
    '================================ FAILURES ================================',
    '_______________________________ test_bad ________________________________',
    'E   AssertionError: expected 1',
    '========================= 1 failed, 1 passed in 0.10s ===================='
  ].join('\n');
  const result = filterOutput('pytest', ['-q'], output, config);
  assert.match(result.text, /FAILURES/);
  assert.match(result.text, /AssertionError/);
  assert.match(result.text, /1 failed, 1 passed/);
  assert.doesNotMatch(result.text, /test_ok\.py \./);
  assert.equal(result.explain.filter, 'test output');
  assert.match(result.explain.omitted.join(' '), /passing test noise/);
});

test('generic fallback truncates huge output', () => {
  const output = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
  const result = filterOutput('unknown', [], output, config);
  assert.equal(result.truncated, true);
  assert.match(result.text, /lines truncated/);
  assert.equal(result.explain.filter, 'generic truncate');
});

test('ls compacts long listing into names and summary', () => {
  const output = [
    'total 16',
    'drwxr-xr-x 2 user staff 64 Jan 1 12:00 .',
    'drwxr-xr-x 2 user staff 64 Jan 1 12:00 ..',
    'drwxr-xr-x 2 user staff 64 Jan 1 12:00 src',
    '-rw-r--r-- 1 user staff 1234 Jan 1 12:00 package.json',
    '-rw-r--r-- 1 user staff 5678 Jan 1 12:00 README.md'
  ].join('\n');
  const result = filterOutput('ls', ['-la'], output, config);
  assert.match(result.text, /src\//);
  assert.match(result.text, /package\.json 1\.2K/);
  assert.match(result.text, /Summary: 2 files, 1 dirs/);
  assert.doesNotMatch(result.text, /drwx/);
});

test('dir compacts Windows directory output', () => {
  const output = [
    ' Volume in drive D is New Volume',
    ' Directory of D:\\Projects\\RTK',
    '06/03/2026  07:26 PM    <DIR>          bin',
    '06/03/2026  07:43 PM    <DIR>          src',
    '06/03/2026  07:27 PM               553 package.json'
  ].join('\n');
  const result = filterOutput('dir', [], output, config);
  assert.match(result.text, /bin\//);
  assert.match(result.text, /src\//);
  assert.match(result.text, /package\.json 553B/);
  assert.match(result.text, /Summary: 1 files, 2 dirs/);
  assert.doesNotMatch(result.text, /Volume in drive/);
});

test('read strips simple comments and repeated blank lines', () => {
  const output = [
    '// comment',
    '',
    '',
    'const value = 1;',
    '# shell comment',
    'console.log(value);'
  ].join('\n');
  const result = filterOutput('read', ['file.js'], output, config);
  assert.match(result.text, /const value = 1/);
  assert.match(result.text, /console\.log/);
  assert.doesNotMatch(result.text, /comment/);
});

test('git log compacts commits', () => {
  const output = [
    'commit abcdef1234567890',
    'Author: Somebody',
    'Date: Today',
    '    add feature',
    'commit 1234567890abcdef',
    '    fix bug'
  ].join('\n');
  const result = filterOutput('git', ['log'], output, config);
  assert.match(result.text, /abcdef12/);
  assert.match(result.text, /12345678/);
  assert.doesNotMatch(result.text, /Author:/);
});
