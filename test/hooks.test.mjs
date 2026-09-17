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

test('PowerShell hook forwards all arguments to sesshush', () => {
  const block = hookBlock('powershell', { command: 'sesshush' });

  assert.match(block, /function global:git/);
  assert.match(block, /sesshush git @args/);
  assert.match(block, /& \(Get-Command git\.exe -ErrorAction Stop\)\.Source @args/);
  assert.match(block, /sesshush --version/);
  assert.match(block, /\$sesshushAvailable/);
  assert.match(block, /\$env:SESSHUSH_DISABLE/);
});

test('PowerShell hook supports quoted bundled Node commands', () => {
  const command = "& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\Users\\Test User\\.vscode\\extensions\\rtk.savytox\\bin\\sesshush.js'";
  const block = hookBlock('powershell', { command });

  assert.match(block, /C:\\Program Files\\nodejs\\node\.exe/);
  assert.match(block, /C:\\Users\\Test User/);
  assert.doesNotMatch(block, /& &/);
  assert.match(block, /sesshush\.js' git @args/);
});

test('POSIX hook forwards quoted arguments to sesshush', () => {
  const block = hookBlock('bash', { command: 'sesshush' });

  assert.match(block, /git\(\) \{/);
  assert.match(block, /sesshush git "\$@"/);
  assert.match(block, /command git "\$@"/);
  assert.match(block, /sesshush --version >\/dev\/null 2>&1/);
  assert.match(block, /SESSHUSH_DISABLE/);
});

test('Fish hook falls back to native commands when sesshush is unavailable', () => {
  const block = hookBlock('fish', { command: 'sesshush' });

  assert.match(block, /else if sesshush --version >\/dev\/null 2>&1/);
  assert.match(block, /command git \$argv/);
  assert.match(block, /SESSHUSH_DISABLE/);
});

test('Codex zsh auto hook routes supported commands and keeps fallback', () => {
  const block = codexAutoHookBlock({ command: 'sesshush' });

  assert.match(block, /sesshush codex auto hook/);
  assert.match(block, /SESSHUSH_DISABLE=1/);
  assert.match(block, /cat\(\) \{/);
  assert.match(block, /sesshush cat "\$@"/);
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshush-powershell-hooks-'));
  const originalUserProfile = process.env.USERPROFILE;

  try {
    process.env.USERPROFILE = tmp;
    const install = installHook({ shell: 'powershell', command: 'sesshush' });

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
