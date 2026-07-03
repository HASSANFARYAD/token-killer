import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recordOptimization, snapshot } = require('../src/dashboard/metrics.cjs');

function state() {
  const values = new Map();
  return {
    get: (key) => values.get(key),
    update: async (key, value) => {
      values.set(key, value);
    }
  };
}

test('extension metrics records token savings without a CLI', async () => {
  const context = { workspaceState: state() };
  await recordOptimization(context, '/workspace', 'rg', 'match\n'.repeat(100), 'file.ts (100 matches)\n  1: match');

  const metrics = snapshot(context, '/workspace');

  assert.equal(metrics.session.runs, 1);
  assert.ok(metrics.session.originalTokens > metrics.session.compressedTokens);
  assert.ok(metrics.session.savedTokens > 0);
  assert.equal(metrics.session.commands.rg.runs, 1);
  assert.equal(metrics.total.runs, 1);
});
