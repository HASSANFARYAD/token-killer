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
  stripComments: false,
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

// A hand-edited config must not be able to destroy output. maxChars: 0 emitted
// nothing but a truncation marker, and a negative limit is meaningless, so
// every value is coerced back into a usable range rather than trusted.
const NUMERIC_BOUNDS = {
  maxLines: { min: 1, max: 100000 },
  maxChars: { min: 1, max: 10000000 },
  matchesPerFile: { min: 1, max: 1000 },
  diffContextLines: { min: 0, max: 100 }
};

export function sanitizeConfig(parsed) {
  const config = { ...DEFAULT_CONFIG, ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) };

  for (const [key, { min, max }] of Object.entries(NUMERIC_BOUNDS)) {
    const value = Math.trunc(Number(config[key]));
    // Below the minimum means a typo, not a request for one line of output, so
    // fall back to the default rather than clamping to a value that would
    // silently throw the output away. Above the maximum is just over-eager.
    if (!Number.isFinite(value) || value < min) config[key] = DEFAULT_CONFIG[key];
    else config[key] = Math.min(max, value);
  }

  for (const key of ['ultraCompact', 'telemetry', 'colors', 'stripComments']) {
    config[key] = Boolean(config[key]);
  }

  config.excludedCommands = Array.isArray(config.excludedCommands)
    ? config.excludedCommands.filter((entry) => typeof entry === 'string')
    : [];

  return config;
}

export function loadConfig() {
  try {
    ensureConfig();
    return sanitizeConfig(JSON.parse(fs.readFileSync(configPath(), 'utf8')));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
