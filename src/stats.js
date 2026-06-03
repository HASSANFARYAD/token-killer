import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyticsPath, dataDir } from './config.js';

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function emptyDb() {
  return {
    version: 2,
    totalRuns: 0,
    totalOriginalTokens: 0,
    totalCompressedTokens: 0,
    commands: {},
    sessions: {}
  };
}

function sessionId() {
  return process.env.RTK_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || process.env.CODEX_SESSION_ID
    || process.env.TERM_SESSION_ID
    || `${os.userInfo().username}:${process.cwd()}`;
}

function sessionLabel(id) {
  if (process.env.RTK_SESSION_LABEL) return process.env.RTK_SESSION_LABEL;
  if (id === process.env.RTK_SESSION_ID) return id;
  return process.cwd();
}

function ensureShape(db) {
  db.version ||= 2;
  db.totalRuns ||= 0;
  db.totalOriginalTokens ||= 0;
  db.totalCompressedTokens ||= 0;
  db.commands ||= {};
  db.sessions ||= {};
  return db;
}

export function readAnalytics() {
  try {
    return ensureShape(JSON.parse(fs.readFileSync(analyticsPath(), 'utf8')));
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

  const id = sessionId();
  db.sessions[id] ||= {
    label: sessionLabel(id),
    runs: 0,
    originalTokens: 0,
    compressedTokens: 0,
    savedTokens: 0,
    commands: {},
    startedAt: new Date().toISOString(),
    updatedAt: null
  };
  const session = db.sessions[id];
  session.runs += 1;
  session.originalTokens += originalTokens;
  session.compressedTokens += compressedTokens;
  session.savedTokens += savedTokens;
  session.updatedAt = new Date().toISOString();
  session.commands[key] ||= { runs: 0, originalTokens: 0, compressedTokens: 0, savedTokens: 0 };
  session.commands[key].runs += 1;
  session.commands[key].originalTokens += originalTokens;
  session.commands[key].compressedTokens += compressedTokens;
  session.commands[key].savedTokens += savedTokens;

  fs.writeFileSync(analyticsPath(), JSON.stringify(db, null, 2));
}

function ratio(saved, original) {
  return original ? Number(((saved / original) * 100).toFixed(1)) : 0;
}

function formatCommandRows(commands) {
  return Object.entries(commands)
    .sort(([, a], [, b]) => b.savedTokens - a.savedTokens)
    .map(([cmd, stat]) => {
      const cmdRatio = stat.originalTokens
        ? ((stat.savedTokens / stat.originalTokens) * 100).toFixed(1)
        : '0.0';
      return `${cmd.padEnd(12)} runs=${String(stat.runs).padStart(4)} saved=${String(stat.savedTokens).padStart(8)} tokens (${cmdRatio}%)`;
    });
}

export function currentSessionId() {
  return sessionId();
}

export function analyticsSnapshot(id = sessionId()) {
  const db = readAnalytics();
  const saved = Math.max(0, db.totalOriginalTokens - db.totalCompressedTokens);
  const session = db.sessions[id] || {
    label: sessionLabel(id),
    runs: 0,
    originalTokens: 0,
    compressedTokens: 0,
    savedTokens: 0,
    commands: {}
  };

  return {
    session: {
      id,
      label: session.label,
      runs: session.runs,
      savedTokens: session.savedTokens,
      originalTokens: session.originalTokens,
      compressedTokens: session.compressedTokens,
      savedPercent: ratio(session.savedTokens, session.originalTokens),
      startedAt: session.startedAt || null,
      updatedAt: session.updatedAt || null,
      commands: session.commands || {}
    },
    total: {
      runs: db.totalRuns,
      savedTokens: saved,
      originalTokens: db.totalOriginalTokens,
      compressedTokens: db.totalCompressedTokens,
      savedPercent: ratio(saved, db.totalOriginalTokens),
      commands: db.commands
    }
  };
}

export function formatGain() {
  const snapshot = analyticsSnapshot();
  const rows = formatCommandRows(snapshot.total.commands);

  return [
    `RTK token gain`,
    `runs: ${snapshot.total.runs}`,
    `saved: ${snapshot.total.savedTokens} tokens (${snapshot.total.savedPercent.toFixed(1)}%)`,
    `original: ${snapshot.total.originalTokens} tokens`,
    `compressed: ${snapshot.total.compressedTokens} tokens`,
    rows.length ? '' : null,
    ...rows
  ].filter(Boolean).join('\n');
}

export function formatSessionGain(id = sessionId()) {
  const snapshot = analyticsSnapshot(id);
  const rows = formatCommandRows(snapshot.session.commands);

  return [
    `RTK session token gain`,
    `session: ${snapshot.session.label}`,
    `runs: ${snapshot.session.runs}`,
    `saved: ${snapshot.session.savedTokens} tokens (${snapshot.session.savedPercent.toFixed(1)}%)`,
    `original: ${snapshot.session.originalTokens} tokens`,
    `compressed: ${snapshot.session.compressedTokens} tokens`,
    rows.length ? '' : null,
    ...rows
  ].filter(Boolean).join('\n');
}

export function analyticsFilePath() {
  return path.resolve(analyticsPath());
}
