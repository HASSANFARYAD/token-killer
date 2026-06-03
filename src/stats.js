import fs from 'node:fs';
import path from 'node:path';
import { analyticsPath, dataDir } from './config.js';

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function emptyDb() {
  return {
    version: 1,
    totalRuns: 0,
    totalOriginalTokens: 0,
    totalCompressedTokens: 0,
    commands: {}
  };
}

export function readAnalytics() {
  try {
    return JSON.parse(fs.readFileSync(analyticsPath(), 'utf8'));
  } catch {
    return emptyDb();
  }
}

export function recordRun(command, originalText, compressedText) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const db = readAnalytics();
  const originalTokens = estimateTokens(originalText);
  const compressedTokens = estimateTokens(compressedText);
  const savedTokens = Math.max(0, originalTokens - compressedTokens);
  const key = command || 'unknown';

  db.totalRuns += 1;
  db.totalOriginalTokens += originalTokens;
  db.totalCompressedTokens += compressedTokens;
  db.commands[key] ||= { runs: 0, originalTokens: 0, compressedTokens: 0, savedTokens: 0 };
  db.commands[key].runs += 1;
  db.commands[key].originalTokens += originalTokens;
  db.commands[key].compressedTokens += compressedTokens;
  db.commands[key].savedTokens += savedTokens;

  fs.writeFileSync(analyticsPath(), JSON.stringify(db, null, 2));
}

export function formatGain() {
  const db = readAnalytics();
  const saved = Math.max(0, db.totalOriginalTokens - db.totalCompressedTokens);
  const ratio = db.totalOriginalTokens ? ((saved / db.totalOriginalTokens) * 100).toFixed(1) : '0.0';
  const rows = Object.entries(db.commands)
    .sort(([, a], [, b]) => b.savedTokens - a.savedTokens)
    .map(([cmd, stat]) => {
      const cmdRatio = stat.originalTokens
        ? ((stat.savedTokens / stat.originalTokens) * 100).toFixed(1)
        : '0.0';
      return `${cmd.padEnd(12)} runs=${String(stat.runs).padStart(4)} saved=${String(stat.savedTokens).padStart(8)} tokens (${cmdRatio}%)`;
    });

  return [
    `RTK token gain`,
    `runs: ${db.totalRuns}`,
    `saved: ${saved} tokens (${ratio}%)`,
    `original: ${db.totalOriginalTokens} tokens`,
    `compressed: ${db.totalCompressedTokens} tokens`,
    rows.length ? '' : null,
    ...rows
  ].filter(Boolean).join('\n');
}

export function analyticsFilePath() {
  return path.resolve(analyticsPath());
}
