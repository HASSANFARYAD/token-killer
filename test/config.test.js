import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';

test('loadConfig falls back to defaults when config directory cannot be created', () => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-node-config-'));
  const fileInsteadOfDir = path.join(temp, 'not-a-dir');
  fs.writeFileSync(fileInsteadOfDir, 'occupied');

  try {
    process.env.XDG_CONFIG_HOME = fileInsteadOfDir;

    assert.deepEqual(loadConfig(), DEFAULT_CONFIG);
  } finally {
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
