import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function state(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => values.get(key),
    update: async (key, value) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    },
    values
  };
}

function makeVscodeMock(options = {}) {
  const commands = new Map();
  const configValues = {
    rtk: {
      authRequired: false,
      autoWrapTerminals: false,
      followWorkspacePath: true,
      refreshIntervalMs: 100000,
      showTotalWhenNoSession: true,
      syncIntervalMs: 30000
    },
    savytox: {
      engine: 'extension',
      enableTokenSaverTerminal: true,
      optimizationMode: 'balanced',
      maxOutputChars: 18000,
      showStatusBar: true
    },
    ...(options.configValues || {})
  };
  const calls = {
    statusBars: [],
    terminals: [],
    panels: [],
    informationMessages: [],
    clipboard: [],
    openedDocuments: []
  };
  const globalState = state(options.globalState || {});
  const workspaceState = state(options.workspaceState || {});

  const mock = {
    StatusBarAlignment: { Right: 2 },
    ViewColumn: { One: 1 },
    Uri: { file: (fsPath) => ({ fsPath }) },
    version: '1.99.0-test',
    window: {
      activeTextEditor: null,
      createStatusBarItem: () => {
        const item = {
          text: '',
          tooltip: '',
          command: '',
          shown: false,
          show() { this.shown = true; },
          hide() { this.shown = false; },
          dispose() {}
        };
        calls.statusBars.push(item);
        return item;
      },
      createTerminal: (options) => {
        const terminal = {
          options,
          shown: false,
          show() { this.shown = true; },
          sendText(text) { this.sentText = text; },
          dispose() {}
        };
        calls.terminals.push(terminal);
        options?.pty?.open?.();
        return terminal;
      },
      createWebviewPanel: (viewType, title, column, panelOptions) => {
        const panel = {
          viewType,
          title,
          column,
          panelOptions,
          webview: {
            html: '',
            onDidReceiveMessage() {}
          },
          revealCalled: false,
          reveal() { this.revealCalled = true; },
          onDidDispose() {},
          dispose() {}
        };
        calls.panels.push(panel);
        return panel;
      },
      showInformationMessage: async (message) => {
        calls.informationMessages.push(message);
        return options.infoChoice;
      },
      showErrorMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showTextDocument: async () => undefined
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: options.workspacePath || process.cwd() } }],
      getConfiguration: (section) => ({
        get: (key, fallback) => configValues[section]?.[key] ?? fallback,
        update: async (key, value) => {
          configValues[section] ||= {};
          configValues[section][key] = value;
        }
      }),
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      openTextDocument: async (document) => {
        calls.openedDocuments.push(document);
        return document;
      }
    },
    commands: {
      registerCommand: (name, fn) => {
        commands.set(name, fn);
        return { dispose() {} };
      },
      executeCommand: async () => undefined
    },
    extensions: {
      getExtension: () => ({ packageJSON: { version: '0.1.1' } })
    },
    env: {
      clipboard: {
        writeText: async (text) => calls.clipboard.push(text)
      }
    },
    EventEmitter: class {
      constructor() {
        this.listeners = [];
        this.event = (listener) => {
          this.listeners.push(listener);
          return { dispose() {} };
        };
      }
      fire(value) {
        for (const listener of this.listeners) listener(value);
      }
      dispose() {}
    },
    calls,
    registeredCommands: commands,
    context: {
      subscriptions: [],
      globalState,
      workspaceState,
      secrets: {
        get: async () => undefined,
        store: async () => undefined,
        delete: async () => undefined
      }
    }
  };
  return mock;
}

async function withMockedVscode(mock, fn) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return mock;
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePaths = [
    '../extension.js',
    '../src/terminal/tokenSaverTerminal.cjs',
    '../src/context/copyOptimizedContext.cjs',
    '../src/terminal/commandWrapper.cjs',
    '../src/adapters/externalCliAdapter.cjs',
    '../src/dashboard/metrics.cjs'
  ].map((request) => require.resolve(request));
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  try {
    const extension = require('../extension.js');
    return await fn(extension);
  } finally {
    try {
      require.cache[modulePaths[0]]?.exports?.deactivate?.();
    } catch {
      // Best-effort cleanup for mocked activation tests.
    }
    for (const modulePath of modulePaths) delete require.cache[modulePath];
    Module._load = originalLoad;
  }
}

test('first activation with no CLI registers SavytoX commands and shows ready status', async () => {
  const mock = makeVscodeMock();

  await withMockedVscode(mock, async (extension) => {
    await extension.activate(mock.context);

    assert.ok(mock.registeredCommands.has('savytox.openTokenSaverTerminal'));
    assert.ok(mock.registeredCommands.has('savytox.copyOptimizedContext'));
    assert.ok(mock.registeredCommands.has('savytox.showDashboard'));
    assert.equal(mock.calls.statusBars.at(-1).text, 'SavytoX: Ready');
    assert.equal(mock.calls.informationMessages.filter((message) => /ready with local-first token saving/.test(message)).length, 1);
  });
});

test('onboarding does not repeat after it has been shown', async () => {
  const mock = makeVscodeMock({ globalState: { 'savytox.onboardingShown': true } });

  await withMockedVscode(mock, async (extension) => {
    await extension.activate(mock.context);

    assert.equal(mock.calls.informationMessages.filter((message) => /ready with local-first token saving/.test(message)).length, 0);
  });
});

test('Token Saver Terminal command creates the controlled terminal', async () => {
  const mock = makeVscodeMock({ globalState: { 'savytox.onboardingShown': true } });

  await withMockedVscode(mock, async (extension) => {
    await extension.activate(mock.context);
    await mock.registeredCommands.get('savytox.openTokenSaverTerminal')();

    assert.equal(mock.calls.terminals.length, 1);
    assert.equal(mock.calls.terminals[0].options.name, 'SavytoX Token Saver');
    assert.ok(mock.calls.terminals[0].options.pty);
  });
});

test('dashboard opens with empty local metrics', async () => {
  const mock = makeVscodeMock({ globalState: { 'savytox.onboardingShown': true } });

  await withMockedVscode(mock, async (extension) => {
    await extension.activate(mock.context);
    await mock.registeredCommands.get('savytox.showDashboard')();

    assert.equal(mock.calls.panels.length, 1);
    assert.equal(mock.calls.panels[0].title, 'SavytoX Dashboard');
    assert.match(mock.calls.panels[0].webview.html, /SavytoX Token Savings/);
    assert.match(mock.calls.panels[0].webview.html, /Session Runs/);
  });
});

test('registered copy optimized context command runs without an active git dependency', async () => {
  const mock = makeVscodeMock({ globalState: { 'savytox.onboardingShown': true } });

  await withMockedVscode(mock, async (extension) => {
    await extension.activate(mock.context);
    await mock.registeredCommands.get('savytox.copyOptimizedContext')();

    assert.equal(mock.calls.clipboard.length, 1);
    assert.match(mock.calls.clipboard[0], /SavytoX token-optimized context/);
    assert.equal(mock.calls.openedDocuments.length, 1);
  });
});

test('extension mode ignores unavailable external CLI during activation', async () => {
  const mock = makeVscodeMock({
    globalState: { 'savytox.onboardingShown': true },
    configValues: {
      savytox: {
        engine: 'extension',
        externalCommand: 'definitely-missing-savytox-cli',
        enableTokenSaverTerminal: true,
        optimizationMode: 'balanced',
        maxOutputChars: 18000,
        showStatusBar: true
      }
    }
  });

  await withMockedVscode(mock, async (extension) => {
    await extension.activate(mock.context);

    assert.equal(mock.calls.statusBars.at(-1).text, 'SavytoX: Ready');
  });
});

test('auto mode falls back to extension metrics when external CLI is unavailable', async () => {
  const mock = makeVscodeMock({
    globalState: { 'savytox.onboardingShown': true },
    configValues: {
      savytox: {
        engine: 'auto',
        externalCommand: 'definitely-missing-savytox-cli',
        enableTokenSaverTerminal: true,
        optimizationMode: 'balanced',
        maxOutputChars: 18000,
        showStatusBar: true
      }
    }
  });

  await withMockedVscode(mock, async (extension) => {
    await extension.activate(mock.context);

    assert.equal(mock.calls.statusBars.at(-1).text, 'SavytoX: Ready');
  });
});

test('activation does not install shell hooks automatically even when legacy setting is true', async () => {
  const mock = makeVscodeMock({
    globalState: { 'savytox.onboardingShown': true },
    configValues: {
      rtk: {
        authRequired: false,
        autoWrapTerminals: true,
        followWorkspacePath: true,
        refreshIntervalMs: 100000,
        showTotalWhenNoSession: true,
        syncIntervalMs: 30000
      }
    }
  });

  await withMockedVscode(mock, async (extension) => {
    await extension.activate(mock.context);

    assert.equal(mock.calls.statusBars.at(-1).text, 'SavytoX: Ready');
  });
});

test('default activation does not call network sync', async () => {
  const mock = makeVscodeMock({ globalState: { 'savytox.onboardingShown': true } });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network should not be called');
  };

  try {
    await withMockedVscode(mock, async (extension) => {
      await extension.activate(mock.context);
      assert.equal(fetchCalls, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
