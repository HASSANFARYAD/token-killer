import test from 'node:test';
import assert from 'node:assert/strict';
import { hookBlock } from '../src/hooks.js';

test('PowerShell hook forwards all arguments to rtk-node', () => {
  const block = hookBlock('powershell', { command: 'rtk-node' });

  assert.match(block, /function global:git/);
  assert.match(block, /& rtk-node git @args/);
  assert.match(block, /& \(Get-Command git\.exe -ErrorAction Stop\)\.Source @args/);
  assert.match(block, /& rtk-node --version/);
  assert.match(block, /\$rtkAvailable/);
});

test('POSIX hook forwards quoted arguments to rtk-node', () => {
  const block = hookBlock('bash', { command: 'rtk-node' });

  assert.match(block, /git\(\) \{/);
  assert.match(block, /rtk-node git "\$@"/);
  assert.match(block, /command git "\$@"/);
  assert.match(block, /rtk-node --version >\/dev\/null 2>&1/);
});

test('Fish hook falls back to native commands when rtk-node is unavailable', () => {
  const block = hookBlock('fish', { command: 'rtk-node' });

  assert.match(block, /else if rtk-node --version >\/dev\/null 2>&1/);
  assert.match(block, /command git \$argv/);
});
