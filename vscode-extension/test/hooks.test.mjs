import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  codexAutoHookBlock,
  hookBlock,
  installHook,
  uninstallHook,
  zshenvLoaderBlock
} from '../src/hooks.js';

test('PowerShell hook forwards all arguments to rtk-node', () => {
  const block = hookBlock('powershell', { command: 'rtk-node' });

  assert.match(block, /function global:git/);
  assert.match(block, /rtk-node git @args/);
  assert.match(block, /& \(Get-Command git\.exe -ErrorAction Stop\)\.Source @args/);
  assert.match(block, /rtk-node --version/);
  assert.match(block, /\$rtkAvailable/);
  assert.match(block, /\$env:RTK_NODE_DISABLE/);
});

test('PowerShell hook supports quoted bundled Node commands', () => {
  const command = "& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\Users\\Test User\\.vscode\\extensions\\rtk.savytox\\bin\\rtk-node.js'";
  const block = hookBlock('powershell', { command });

  assert.match(block, /C:\\Program Files\\nodejs\\node\.exe/);
  assert.match(block, /C:\\Users\\Test User/);
  assert.doesNotMatch(block, /& &/);
  assert.match(block, /rtk-node\.js' git @args/);
});

test('POSIX hook forwards quoted arguments to rtk-node', () => {
  const block = hookBlock('bash', { command: 'rtk-node' });

  assert.match(block, /git\(\) \{/);
  assert.match(block, /rtk-node git "\$@"/);
  assert.match(block, /command git "\$@"/);
  assert.match(block, /rtk-node --version >\/dev\/null 2>&1/);
  assert.match(block, /RTK_NODE_DISABLE/);
});

test('Fish hook falls back to native commands when rtk-node is unavailable', () => {
  const block = hookBlock('fish', { command: 'rtk-node' });

  assert.match(block, /else if rtk-node --version >\/dev\/null 2>&1/);
  assert.match(block, /command git \$argv/);
  assert.match(block, /RTK_NODE_DISABLE/);
});

test('Codex zsh auto hook routes supported commands and keeps fallback', () => {
  const block = codexAutoHookBlock({ command: 'rtk-node' });

  assert.match(block, /rtk-node codex auto hook/);
  assert.match(block, /RTK_NODE_DISABLE=1/);
  assert.match(block, /cat\(\) \{/);
  assert.match(block, /rtk-node cat "\$@"/);
  assert.match(block, /command cat "\$@"/);
});

test('zshenv loader is scoped to Codex and VS Code shells', () => {
  const block = zshenvLoaderBlock();

  assert.match(block, /CODEX_THREAD_ID/);
  assert.match(block, /CODEX_INTERNAL_ORIGINATOR_OVERRIDE/);
  assert.match(block, /VSCODE_IPC_HOOK/);
  assert.match(block, /codex-auto-hook\.zsh/);
});

test('PowerShell install writes Core and Windows PowerShell profiles', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-powershell-hooks-'));
  const originalUserProfile = process.env.USERPROFILE;

  try {
    process.env.USERPROFILE = tmp;
    const install = installHook({ shell: 'powershell', command: 'rtk-node' });

    assert.equal(install.profiles.length, 2);
    assert.ok(install.profiles.some((profile) => profile.includes(`${path.sep}PowerShell${path.sep}`)));
    assert.ok(install.profiles.some((profile) => profile.includes(`${path.sep}WindowsPowerShell${path.sep}`)));

    for (const profile of install.profiles) {
      assert.ok(fs.existsSync(profile));
      assert.match(fs.readFileSync(profile, 'utf8'), /function global:git/);
    }

    const uninstall = uninstallHook({ shell: 'powershell' });

    assert.equal(uninstall.changed, true);
    for (const profile of install.profiles) {
      assert.equal(fs.readFileSync(profile, 'utf8'), '');
    }
  } finally {
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
