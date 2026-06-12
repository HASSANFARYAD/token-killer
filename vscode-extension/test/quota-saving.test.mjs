import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chooseFinalOutputForTest } from '../src/cli.js';
import { filterOutput } from '../src/filters.js';
import { analyticsSnapshot, estimateTokens, recordRun } from '../src/stats.js';

const extensionRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = fileURLToPath(new URL('../bin/rtk-node.js', import.meta.url));

function makeTempHome(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rtk-${name}-`));
}

function withAnalyticsHome(name, fn) {
  const dataHome = makeTempHome(name);
  const configHome = makeTempHome(`${name}-config`);
  const previous = {
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    RTK_SESSION_ID: process.env.RTK_SESSION_ID,
    RTK_SESSION_LABEL: process.env.RTK_SESSION_LABEL
  };

  process.env.XDG_DATA_HOME = dataHome;
  process.env.XDG_CONFIG_HOME = configHome;
  process.env.RTK_SESSION_ID = `${name}-session`;
  process.env.RTK_SESSION_LABEL = `${name} session`;

  try {
    return fn({ dataHome, configHome, sessionId: process.env.RTK_SESSION_ID });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('happy path filters noisy command output and records positive token savings', () => {
  const dataHome = makeTempHome('cli-data');
  const configHome = makeTempHome('cli-config');
  const fixtureDir = makeTempHome('cli-fixture');
  const fixturePath = path.join(fixtureDir, 'noisy-output.txt');
  const noisyLines = Array.from({ length: 160 }, (_, index) => `# generated noisy line ${index}`);
  fs.writeFileSync(fixturePath, [...noisyLines, '', '', 'meaningful result'].join('\n'));

  const result = spawnSync(process.execPath, [cliPath, 'read', fixturePath], {
    cwd: extensionRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      XDG_DATA_HOME: dataHome,
      XDG_CONFIG_HOME: configHome,
      RTK_SESSION_ID: 'cli-happy-path',
      RTK_SESSION_LABEL: 'CLI happy path'
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /meaningful result/);
  assert.doesNotMatch(result.stdout, /generated noisy line/);

  const analyticsPath = path.join(dataHome, 'rtk-node', 'analytics.json');
  const analytics = JSON.parse(fs.readFileSync(analyticsPath, 'utf8'));
  const session = analytics.sessions['cli-happy-path'];

  assert.equal(session.runs, 1);
  assert.ok(session.originalTokens > session.compressedTokens);
  assert.ok(session.savedTokens > 0);
  assert.equal(session.commands.read.runs, 1);
});

test('zero-token runs stay at zero savings and zero percent', () => {
  withAnalyticsHome('zero-token', ({ sessionId }) => {
    assert.equal(estimateTokens(''), 0);

    const recorded = recordRun('read', '', '', { exitCode: 0, durationMs: 0 });
    const snapshot = analyticsSnapshot(sessionId);

    assert.equal(recorded, true);
    assert.equal(snapshot.session.runs, 1);
    assert.equal(snapshot.session.originalTokens, 0);
    assert.equal(snapshot.session.compressedTokens, 0);
    assert.equal(snapshot.session.savedTokens, 0);
    assert.equal(snapshot.session.savedPercent, 0);
  });
});

test('configured max output caps truncate oversized fallback output', () => {
  const output = Array.from({ length: 20 }, (_, index) => `line-${index} ${'x'.repeat(30)}`).join('\n');
  const result = filterOutput('unknown-command', [], output, {
    maxLines: 100,
    maxChars: 80,
    matchesPerFile: 8,
    diffContextLines: 2,
    ultraCompact: false
  });

  assert.equal(result.truncated, true);
  assert.match(result.text, /chars truncated/);
  assert.equal(result.explain.filter, 'generic truncate');
});

test('repeated identical output is deduplicated by the fallback compressor', () => {
  const result = filterOutput('unknown-command', [], Array(8).fill('same line').join('\n'), {
    maxLines: 30,
    maxChars: 4000,
    matchesPerFile: 8,
    diffContextLines: 2,
    ultraCompact: false
  });

  assert.match(result.text, /^same line/m);
  assert.match(result.text, /repeated 7x/);
  assert.equal(result.explain.filter, 'generic truncate');
});

test('repeated identical runs are counted without corrupting saved-token totals', () => {
  withAnalyticsHome('repeat-run', ({ sessionId }) => {
    const original = 'large output '.repeat(80);
    const compressed = 'large output summary';
    const expectedSaved = estimateTokens(original) - estimateTokens(compressed);

    recordRun('rg', original, compressed, { exitCode: 0, durationMs: 1, truncated: true });
    recordRun('rg', original, compressed, { exitCode: 0, durationMs: 1, truncated: true });

    const snapshot = analyticsSnapshot(sessionId);

    assert.equal(snapshot.session.runs, 2);
    assert.equal(snapshot.session.commands.rg.runs, 2);
    assert.equal(snapshot.session.savedTokens, expectedSaved * 2);
    assert.equal(snapshot.total.savedTokens, expectedSaved * 2);
  });
});

test('small outputs fall back to raw output when metadata would increase size', () => {
  const rawOutput = 'ok\n';
  const finalOutput = chooseFinalOutputForTest({
    rawOutput,
    body: 'ok',
    meta: '\n--- rtk-node metadata ---\nsaved: 0.0%',
    explain: ''
  });

  assert.equal(finalOutput, rawOutput);
});
