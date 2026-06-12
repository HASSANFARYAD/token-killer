import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function state(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => values.get(key),
    update: async (key, value) => values.set(key, value)
  };
}

function makeVscodeMock() {
  const calls = { clipboard: [], openedDocuments: [], info: [] };
  return {
    window: {
      activeTextEditor: null,
      showTextDocument: async () => undefined,
      showInformationMessage: async (message) => calls.info.push(message)
    },
    workspace: {
      openTextDocument: async (document) => {
        calls.openedDocuments.push(document);
        return document;
      }
    },
    env: {
      clipboard: {
        writeText: async (text) => calls.clipboard.push(text)
      }
    },
    calls
  };
}

async function withMockedVscode(mock, fn) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return mock;
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve('../src/context/copyOptimizedContext.cjs');
  delete require.cache[modulePath];
  try {
    const contextModule = require('../src/context/copyOptimizedContext.cjs');
    return await fn(contextModule);
  } finally {
    delete require.cache[modulePath];
    Module._load = originalLoad;
  }
}

test('copy optimized context works outside a git repository', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'savytox-nongit-'));
  const mock = makeVscodeMock();
  const extensionContext = { workspaceState: state({ 'savytox.lastTerminalSummary': 'recent error summary' }) };

  await withMockedVscode(mock, async ({ copyOptimizedContext }) => {
    const output = await copyOptimizedContext(extensionContext, temp, { preview: true, maxOutputChars: 1000 });

    assert.match(output, /SavytoX token-optimized context/);
    assert.match(output, /Recent terminal summary/);
    assert.doesNotMatch(output, /Git status:/);
    assert.equal(mock.calls.clipboard.length, 1);
    assert.equal(mock.calls.openedDocuments.length, 1);
  });
});

test('copy optimized context includes git status and diff summaries inside a git repository', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'savytox-git-'));
  execFileSync('git', ['init'], { cwd: temp, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: temp });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: temp });
  fs.writeFileSync(path.join(temp, 'file.txt'), 'one\n');
  execFileSync('git', ['add', 'file.txt'], { cwd: temp });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: temp, stdio: 'ignore' });
  fs.writeFileSync(path.join(temp, 'file.txt'), 'one\ntwo\n');

  const mock = makeVscodeMock();
  const extensionContext = { workspaceState: state() };

  await withMockedVscode(mock, async ({ copyOptimizedContext }) => {
    const output = await copyOptimizedContext(extensionContext, temp, { preview: false, maxOutputChars: 1000 });

    assert.match(output, /Git status:/);
    assert.match(output, /file\.txt/);
    assert.match(output, /Git diff summary:/);
    assert.equal(mock.calls.clipboard.length, 1);
    assert.equal(mock.calls.openedDocuments.length, 0);
  });
});
