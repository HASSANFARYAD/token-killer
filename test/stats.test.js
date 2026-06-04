import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyticsPath } from '../src/config.js';
import { analyticsSnapshot, formatSessionGain, readAnalytics, recordRun } from '../src/stats.js';

test('records token savings for the current session', () => {
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousSessionId = process.env.RTK_SESSION_ID;
  const previousSessionLabel = process.env.RTK_SESSION_LABEL;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-node-stats-'));

  try {
    process.env.XDG_DATA_HOME = temp;
    process.env.RTK_SESSION_ID = 'chat-123';
    process.env.RTK_SESSION_LABEL = 'Chat 123';

    recordRun('rg', 'a'.repeat(400), 'short');
    const snapshot = analyticsSnapshot('chat-123');

    assert.equal(snapshot.session.id, 'chat-123');
    assert.equal(snapshot.session.label, 'Chat 123');
    assert.equal(snapshot.session.runs, 1);
    assert.equal(snapshot.session.originalTokens, 100);
    assert.equal(snapshot.session.compressedTokens, 2);
    assert.equal(snapshot.session.savedTokens, 98);
    assert.equal(snapshot.total.savedTokens, 98);
    assert.match(formatSessionGain('chat-123'), /RTK session token gain/);
    assert.match(formatSessionGain('chat-123'), /saved: 98 tokens/);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    if (previousSessionId === undefined) delete process.env.RTK_SESSION_ID;
    else process.env.RTK_SESSION_ID = previousSessionId;
    if (previousSessionLabel === undefined) delete process.env.RTK_SESSION_LABEL;
    else process.env.RTK_SESSION_LABEL = previousSessionLabel;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('recordRun skips analytics when data directory cannot be created', () => {
  const previousDataHome = process.env.XDG_DATA_HOME;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-node-stats-'));
  const fileInsteadOfDir = path.join(temp, 'not-a-dir');
  fs.writeFileSync(fileInsteadOfDir, 'occupied');

  try {
    process.env.XDG_DATA_HOME = fileInsteadOfDir;

    assert.equal(recordRun('rg', 'a'.repeat(400), 'short'), false);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('records bounded recent run summaries without raw command output', () => {
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousSessionId = process.env.RTK_SESSION_ID;
  const previousSessionLabel = process.env.RTK_SESSION_LABEL;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-node-stats-'));

  try {
    process.env.XDG_DATA_HOME = temp;
    process.env.RTK_SESSION_ID = 'chat-recent';
    process.env.RTK_SESSION_LABEL = 'Recent Chat';

    for (let i = 0; i < 55; i += 1) {
      assert.equal(recordRun('rg', `secret raw output ${i}`, 'short', {
        exitCode: i % 2,
        durationMs: 12.34,
        truncated: i % 3 === 0
      }), true);
    }
    const snapshot = analyticsSnapshot('chat-recent');
    const latest = snapshot.session.recentRuns[0];

    assert.equal(snapshot.session.recentRuns.length, 50);
    assert.equal(snapshot.total.recentRuns.length, 50);
    assert.equal(latest.command, 'rg');
    assert.equal(latest.sessionId, 'chat-recent');
    assert.equal(latest.sessionLabel, 'Recent Chat');
    assert.equal(latest.exitCode, 0);
    assert.equal(latest.durationMs, 12.3);
    assert.equal(typeof latest.timestamp, 'string');
    assert.equal(Object.hasOwn(latest, 'originalText'), false);
    assert.equal(Object.hasOwn(latest, 'compressedText'), false);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    if (previousSessionId === undefined) delete process.env.RTK_SESSION_ID;
    else process.env.RTK_SESSION_ID = previousSessionId;
    if (previousSessionLabel === undefined) delete process.env.RTK_SESSION_LABEL;
    else process.env.RTK_SESSION_LABEL = previousSessionLabel;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('readAnalytics migrates old analytics files to the current shape', () => {
  const previousDataHome = process.env.XDG_DATA_HOME;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-node-stats-'));

  try {
    process.env.XDG_DATA_HOME = temp;
    fs.mkdirSync(path.dirname(analyticsPath()), { recursive: true });
    fs.writeFileSync(analyticsPath(), JSON.stringify({
      version: 2,
      totalRuns: 1,
      totalOriginalTokens: 10,
      totalCompressedTokens: 4,
      commands: { rg: { runs: 1, originalTokens: 10, compressedTokens: 4, savedTokens: 6 } },
      recentRuns: [{ command: 'rg', rawOutput: 'secret', originalTokens: 10 }],
      sessions: {
        old: {
          label: 'Old Session',
          runs: 1,
          originalTokens: 10,
          compressedTokens: 4,
          savedTokens: 6,
          commands: {},
          recentRuns: [{ command: 'rg', compressedText: 'secret', savedTokens: 6 }]
        }
      }
    }));

    const db = readAnalytics();

    assert.equal(db.version, 3);
    assert.equal(db.recentRuns.length, 1);
    assert.equal(db.sessions.old.recentRuns.length, 1);
    assert.equal(Object.hasOwn(db.recentRuns[0], 'rawOutput'), false);
    assert.equal(Object.hasOwn(db.sessions.old.recentRuns[0], 'compressedText'), false);
    assert.deepEqual(db.sessions.old.commands, {});
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
