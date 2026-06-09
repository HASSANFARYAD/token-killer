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
