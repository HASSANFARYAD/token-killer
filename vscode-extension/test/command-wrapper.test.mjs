import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { optimizeCommandOutput } = require('../src/terminal/commandWrapper.cjs');

test('maxOutputChars caps generic optimized output', async () => {
  const output = Array.from({ length: 40 }, (_, index) => `line ${index} ${'x'.repeat(30)}`).join('\n');
  const optimized = await optimizeCommandOutput('unknown-command', output, {
    optimizationMode: 'balanced',
    maxOutputChars: 120
  });

  assert.equal(optimized.truncated, true);
  assert.ok(optimized.text.length < output.length);
  assert.match(optimized.text, /chars truncated/);
});

test('preserveErrors behavior keeps test failures and stack details', async () => {
  const output = [
    'setup noise',
    'FAIL src/app.test.ts',
    'Error: expected true to be false',
    '    at src/app.test.ts:10:5',
    'Tests: 1 failed, 4 passed'
  ].join('\n');
  const optimized = await optimizeCommandOutput('npm test', output, {
    optimizationMode: 'balanced',
    maxOutputChars: 2000,
    preserveErrors: true
  });

  assert.match(optimized.text, /FAIL src\/app\.test\.ts/);
  assert.match(optimized.text, /expected true/);
  assert.match(optimized.text, /src\/app\.test\.ts:10:5/);
  assert.match(optimized.text, /Tests: 1 failed/);
});
