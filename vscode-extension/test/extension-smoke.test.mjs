import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('manifest exposes extension-only SavytoX commands', () => {
  const commands = new Set(manifest.contributes.commands.map((command) => command.command));

  assert.ok(commands.has('savytox.openTokenSaverTerminal'));
  assert.ok(commands.has('savytox.copyOptimizedContext'));
  assert.ok(commands.has('savytox.showDashboard'));
  assert.ok(manifest.activationEvents.includes('onCommand:savytox.openTokenSaverTerminal'));
});

test('manifest defaults to extension engine and local-first sync settings', () => {
  const settings = manifest.contributes.configuration.properties;

  assert.equal(settings['savytox.engine'].default, 'extension');
  assert.deepEqual(settings['savytox.engine'].enum, ['extension', 'external-cli', 'auto']);
  assert.equal(settings['savytox.optimizationMode'].default, 'balanced');
  assert.deepEqual(settings['savytox.optimizationMode'].enum, ['safe', 'balanced', 'aggressive']);
  assert.equal(settings['savytox.enableTokenSaverTerminal'].default, true);
  assert.equal(settings['savytox.enableShellIntegrationCapture'].default, true);
  assert.equal(settings['savytox.externalCommand'].default, '');
  assert.equal(settings['savytox.showStatusBar'].default, true);
  assert.equal(settings['savytox.maxOutputChars'].default, 18000);
  assert.equal(settings['savytox.preserveErrors'].default, true);
  assert.equal(settings['rtk.authRequired'].default, false);
  assert.equal(settings['rtk.syncEnabled'].default, false);
});

test('extension entrypoint does not expose unavailable state for missing CLI by default', () => {
  const source = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');

  assert.doesNotMatch(source, /RTK unavailable/);
  assert.match(source, /SavytoX: Ready/);
  assert.match(source, /runSavytoxStatus/);
});

test('README documents local-first behavior and current limitation', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

  assert.match(readme, /local-first VS Code extension/);
  assert.match(readme, /No `rtk-node`, `rtk`, standalone CLI/);
  assert.match(readme, /No source code, terminal output, or workspace data is sent to a server by default/);
  assert.match(readme, /allows future VS Code shell integration capture when available/);
});
