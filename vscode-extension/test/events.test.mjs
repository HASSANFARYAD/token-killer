import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsageEvent } from '../src/events.js';

test('normalized adapter event does not store content by default', () => {
  const event = normalizeUsageEvent({
    source: 'vscode',
    tool: 'vscode-extension',
    sessionId: 'session-1',
    savedTokens: 42,
    accuracy: 'estimated',
    method: 'compression_estimate'
  });

  assert.equal(event.tokens.saved, 42);
  assert.equal(event.tokens.accuracy, 'estimated');
  assert.equal(event.tokens.method, 'compression_estimate');
  assert.equal(event.prompt_stored, false);
  assert.equal(event.completion_stored, false);
  assert.equal(event.source_code_stored, false);
});

test('normalized adapter event rejects unknown accuracy values', () => {
  const event = normalizeUsageEvent({ accuracy: 'precise', method: 'private-log' });

  assert.equal(event.tokens.accuracy, 'unknown');
  assert.equal(event.tokens.method, 'unknown');
});

