import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);

function loadSyncWithVscodeMock(settings) {
  const fakeVscode = {
    version: '1.123.2',
    workspace: {
      getConfiguration(section) {
        assert.equal(section, 'rtk');
        return {
          get(key, fallback) {
            return settings.has(key) ? settings.get(key) : fallback;
          }
        };
      }
    },
    extensions: {
      getExtension(id) {
        assert.equal(id, 'rtk.savytox');
        return { packageJSON: { version: '0.1.1' } };
      }
    },
    window: {
      showInformationMessage() {},
      showErrorMessage() {},
      showWarningMessage() {}
    },
    authentication: {
      getSession() {
        throw new Error('authentication should not be requested during logged-in sync');
      }
    }
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return fakeVscode;
    return originalLoad.call(this, request, parent, isMain);
  };

  const syncPath = require.resolve('../sync.js');
  delete require.cache[syncPath];
  const sync = require(syncPath);
  Module._load = originalLoad;
  return { sync, syncPath };
}

function makeContext(accessToken = 'test-access-token') {
  const globalStateValues = new Map();
  return {
    secrets: {
      async get(key) {
        assert.equal(key, 'rtk.accessToken');
        return accessToken;
      }
    },
    globalState: {
      get(key) {
        return globalStateValues.get(key);
      },
      async update(key, value) {
        if (value === undefined) globalStateValues.delete(key);
        else globalStateValues.set(key, value);
      }
    }
  };
}

test('logged-in sync sends saved-token snapshot and events for dashboard totals', async () => {
  const settings = new Map([
    ['apiBaseUrl', 'https://rtk.test'],
    ['syncEnabled', true],
    ['authRequired', true]
  ]);
  const { sync, syncPath } = loadSyncWithVscodeMock(settings);
  const originalFetch = global.fetch;
  const requests = [];
  let sessionResponse = 0;

  global.fetch = async (url, options = {}) => {
    const parsedUrl = new URL(url);
    const body = options.body ? JSON.parse(options.body) : {};
    requests.push({ path: parsedUrl.pathname, method: options.method || 'GET', body });

    const responseBody = parsedUrl.pathname === '/api/extension/installs'
      ? { id: 'install-1' }
      : parsedUrl.pathname === '/api/extension/rtk/sessions'
        ? { id: `rtk-session-${++sessionResponse}` }
        : {};

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(responseBody);
      }
    };
  };

  try {
    await sync.syncSnapshot(makeContext(), {
      session: {
        id: 'dashboard-session',
        label: 'Dashboard Session',
        runs: 3,
        originalTokens: 500,
        compressedTokens: 125,
        savedTokens: 375,
        savedPercent: 75,
        startedAt: '2026-06-10T15:00:00.000Z',
        updatedAt: '2026-06-10T15:05:00.000Z',
        recentRuns: [
          {
            command: 'read',
            sessionId: 'dashboard-session',
            sessionLabel: 'Dashboard Session',
            timestamp: '2026-06-10T15:04:00.000Z',
            exitCode: 0,
            durationMs: 12.3,
            originalTokens: 200,
            compressedTokens: 40,
            savedTokens: 160,
            truncated: true
          }
        ]
      },
      total: {
        recentRuns: []
      }
    }, '/workspace');
  } finally {
    global.fetch = originalFetch;
    delete require.cache[syncPath];
  }

  const snapshotRequest = requests.find((request) => request.path === '/api/extension/usage/snapshot');
  const eventRequest = requests.find((request) => request.path === '/api/extension/usage/event');

  assert.ok(snapshotRequest, 'expected a dashboard snapshot request');
  assert.equal(snapshotRequest.method, 'POST');
  assert.equal(snapshotRequest.body.runs, 3);
  assert.equal(snapshotRequest.body.original_tokens, 500);
  assert.equal(snapshotRequest.body.compressed_tokens, 125);
  assert.equal(snapshotRequest.body.saved_tokens, 375);
  assert.equal(snapshotRequest.body.raw_summary.session.savedTokens, 375);

  assert.ok(eventRequest, 'expected recent run events to be synced');
  assert.equal(eventRequest.method, 'POST');
  assert.equal(eventRequest.body.events.length, 1);
  assert.equal(eventRequest.body.events[0].command, 'read');
  assert.equal(eventRequest.body.events[0].original_tokens, 200);
  assert.equal(eventRequest.body.events[0].compressed_tokens, 40);
  assert.equal(eventRequest.body.events[0].saved_tokens, 160);
  assert.equal(eventRequest.body.events[0].truncated, true);
});
