// Blocker 1: git status reported counts that did not match the repository.
//
// The prose format prints "modified:" in both the staged and unstaged sections
// with identical text, and the old filter matched it with two overlapping
// regexes, so every modified file was counted once as staged AND once as
// unstaged. Untracked files were only detected via a "?? " prefix that the
// prose format never emits, so untracked was always reported as 0.
//
// The fix asks git for porcelain v2, which is stable, unlocalised, and carries
// an explicit staged/unstaged code per file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOutput } from '../src/filters.js';
import { normalizeCommand } from '../src/cli.js';

const config = {
  maxLines: 220,
  maxChars: 24000,
  matchesPerFile: 8,
  diffContextLines: 2,
  ultraCompact: false
};

function status(output) {
  return filterOutput('git', ['status'], output, config).text;
}

function counts(text) {
  const read = (label) => Number(text.match(new RegExp(`^${label}: (\\d+)$`, 'm'))?.[1] ?? -1);
  return {
    staged: read('staged'),
    unstaged: read('unstaged'),
    untracked: read('untracked'),
    conflicts: read('conflicts')
  };
}

test('git status is asked for porcelain v2 so the counts are unambiguous', () => {
  const resolved = normalizeCommand('git', ['status']);

  assert.equal(resolved.rewritten, true);
  assert.deepEqual(resolved.args, ['status', '--porcelain=v2', '--branch']);
});

test('an explicit output format from the caller is respected', () => {
  for (const flag of ['--short', '-s', '--porcelain', '--porcelain=v1', '-z', '--long']) {
    const resolved = normalizeCommand('git', ['status', flag]);
    assert.equal(resolved.rewritten, false, `${flag} should not be rewritten`);
    assert.deepEqual(resolved.args, ['status', flag]);
  }
});

test('unrelated git commands are not rewritten', () => {
  assert.equal(normalizeCommand('git', ['diff']).rewritten, false);
  assert.equal(normalizeCommand('npm', ['test']).rewritten, false);
});

test('porcelain v2 counts match the repository exactly', () => {
  const output = [
    '# branch.oid aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '# branch.head main',
    '1 M. N... 100644 100644 100644 aaaa bbbb staged-only.txt',
    '1 .M N... 100644 100644 100644 aaaa bbbb unstaged-only.txt',
    '? untracked.txt'
  ].join('\n');

  assert.deepEqual(counts(status(output)), {
    staged: 1,
    unstaged: 1,
    untracked: 1,
    conflicts: -1
  });
});

test('a file both staged and modified counts once on each side, not twice on both', () => {
  const output = [
    '# branch.head main',
    '1 MM N... 100644 100644 100644 aaaa bbbb both.txt'
  ].join('\n');

  assert.deepEqual(counts(status(output)), {
    staged: 1,
    unstaged: 1,
    untracked: 0,
    conflicts: -1
  });
});

test('untracked files are never silently reported as zero', () => {
  const output = ['# branch.head main', '? a.txt', '? b.txt', '? c.txt'].join('\n');
  const text = status(output);

  assert.equal(counts(text).untracked, 3);
  assert.match(text, /untracked: a\.txt, b\.txt, c\.txt/);
});

test('renames report the new path and count as staged', () => {
  const output = [
    '# branch.head main',
    '2 R. N... 100644 100644 100644 aaaa bbbb R100 new-name.txt\told-name.txt'
  ].join('\n');
  const text = status(output);

  assert.equal(counts(text).staged, 1);
  assert.match(text, /staged: new-name\.txt/);
  assert.doesNotMatch(text, /old-name\.txt/);
});

test('merge conflicts are surfaced rather than folded into the other counts', () => {
  const output = [
    '# branch.head main',
    'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflicted.txt'
  ].join('\n');
  const text = status(output);

  assert.equal(counts(text).conflicts, 1);
  assert.match(text, /conflicts: conflicted\.txt/);
});

test('ignored entries are not counted', () => {
  const output = ['# branch.head main', '! ignored.log', '? real.txt'].join('\n');

  assert.equal(counts(status(output)).untracked, 1);
});

test('branch, detached head and ahead/behind are reported', () => {
  const tracked = status(['# branch.head main', '# branch.ab +2 -3'].join('\n'));
  assert.match(tracked, /^git status on main \(ahead 2, behind 3\)/);

  const detached = status('# branch.head (detached)');
  assert.match(detached, /HEAD \(detached\)/);
});

test('a clean tree is reported as clean', () => {
  const text = status(['# branch.head main', '# branch.ab +0 -0'].join('\n'));

  assert.deepEqual(counts(text), { staged: 0, unstaged: 0, untracked: 0, conflicts: -1 });
  assert.match(text, /^clean$/m);
});

test('prose fallback counts sections correctly when porcelain was not used', () => {
  // This is the exact shape that produced staged:2 unstaged:2 untracked:0.
  const output = [
    'On branch master',
    'Changes to be committed:',
    '  (use "git restore --staged <file>..." to unstage)',
    '\tmodified:   a.txt',
    '',
    'Changes not staged for commit:',
    '  (use "git add <file>..." to update what will be committed)',
    '\tmodified:   b.txt',
    '',
    'Untracked files:',
    '  (use "git add <file>..." to include in what will be committed)',
    '\tnew.txt',
    ''
  ].join('\n');

  const text = filterOutput('git', ['status', '--long'], output, config).text;

  assert.deepEqual(counts(text), {
    staged: 1,
    unstaged: 1,
    untracked: 1,
    conflicts: -1
  });
  assert.match(text, /staged: a\.txt/);
  assert.match(text, /unstaged: b\.txt/);
  assert.match(text, /untracked: new\.txt/);
});

test('file samples are capped but the remainder is reported', () => {
  const output = [
    '# branch.head main',
    ...Array.from({ length: 12 }, (_, i) => `? file-${i}.txt`)
  ].join('\n');
  const text = status(output);

  assert.equal(counts(text).untracked, 12);
  assert.match(text, /\.\.\. \(4 more\)/);
});
