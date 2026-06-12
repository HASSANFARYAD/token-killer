import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkCommand } = require('../src/adapters/externalCliAdapter.cjs');

test('optional external CLI reports unavailable without throwing', async () => {
  const result = await checkCommand('definitely-not-a-savytox-cli', process.cwd());

  assert.equal(result.available, false);
  assert.match(result.reason, /not|ENOENT|could not/i);
});
