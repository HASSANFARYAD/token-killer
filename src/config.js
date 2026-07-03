import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'sesshush';

export const DEFAULT_CONFIG = {
  excludedCommands: [],
  maxLines: 220,
  maxChars: 24000,
  matchesPerFile: 8,
  diffContextLines: 2,
  ultraCompact: false,
  telemetry: false,
  colors: true
};

export function configDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_NAME);
}

export function configPath() {
  return path.join(configDir(), 'config.json');
}

export function dataDir() {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, APP_NAME);
}

export function analyticsPath() {
  return path.join(dataDir(), 'analytics.json');
}

export function ensureConfig() {
  fs.mkdirSync(configDir(), { recursive: true });
  if (!fs.existsSync(configPath())) {
    fs.writeFileSync(configPath(), JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

export function loadConfig() {
  ensureConfig();
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
