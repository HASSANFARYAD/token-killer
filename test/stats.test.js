import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyticsSnapshot, formatSessionGain, recordRun } from '../src/stats.js';

test('records token savings for the current session', () => {
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousSessionId = process.env.RTK_SESSION_ID;
  const previousSessionLabel = process.env.RTK_SESSION_LABEL;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'noisegate-stats-'));

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
    assert.match(formatSessionGain('chat-123'), /NoiseGate session token savings/);
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
