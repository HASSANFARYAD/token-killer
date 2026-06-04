import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyticsPath, dataDir } from './config.js';

const ANALYTICS_VERSION = 3;
const MAX_RECENT_RUNS = 50;
const DEFAULT_CHARS_PER_TOKEN = 4;

function charsPerToken() {
  const value = Number(process.env.RTK_CHARS_PER_TOKEN);
  if (Number.isFinite(value) && value > 0) return value;
  return DEFAULT_CHARS_PER_TOKEN;
}

export function estimateTokens(text, options = {}) {
  if (!text) return 0;
  const ratio = typeof options.charsPerToken === 'number' && options.charsPerToken > 0
    ? options.charsPerToken
    : charsPerToken();
  return Math.max(1, Math.ceil(text.length / ratio));
}

function emptyDb() {
  return {
    version: ANALYTICS_VERSION,
    totalRuns: 0,
    totalOriginalTokens: 0,
    totalCompressedTokens: 0,
    commands: {},
    sessions: {},
    recentRuns: []
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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeRun(run) {
  if (!isRecord(run)) return null;
  return {
    command: typeof run.command === 'string' ? run.command : 'unknown',
    sessionId: typeof run.sessionId === 'string' ? run.sessionId : null,
    sessionLabel: typeof run.sessionLabel === 'string' ? run.sessionLabel : null,
    timestamp: typeof run.timestamp === 'string' ? run.timestamp : null,
    exitCode: typeof run.exitCode === 'number' ? run.exitCode : null,
    durationMs: typeof run.durationMs === 'number' ? run.durationMs : null,
    originalTokens: typeof run.originalTokens === 'number' ? run.originalTokens : 0,
    compressedTokens: typeof run.compressedTokens === 'number' ? run.compressedTokens : 0,
    savedTokens: typeof run.savedTokens === 'number' ? run.savedTokens : 0,
    truncated: Boolean(run.truncated)
  };
}

function sanitizeRecentRuns(runs) {
  if (!Array.isArray(runs)) return [];
  return runs.map(sanitizeRun).filter(Boolean).slice(0, MAX_RECENT_RUNS);
}

function ensureShape(db) {
  if (!isRecord(db)) return emptyDb();
  db.version = ANALYTICS_VERSION;
  db.totalRuns ||= 0;
  db.totalOriginalTokens ||= 0;
  db.totalCompressedTokens ||= 0;
  db.commands = isRecord(db.commands) ? db.commands : {};
  db.sessions = isRecord(db.sessions) ? db.sessions : {};
  db.recentRuns = sanitizeRecentRuns(db.recentRuns);
  for (const session of Object.values(db.sessions)) {
    if (!isRecord(session)) continue;
    session.commands = isRecord(session.commands) ? session.commands : {};
    session.recentRuns = sanitizeRecentRuns(session.recentRuns);
  }
  return db;
}

export function readAnalytics() {
  try {
    return ensureShape(JSON.parse(fs.readFileSync(analyticsPath(), 'utf8')));
  } catch {
    return emptyDb();
  }
}

function boundedRecent(runs, run) {
  return [run, ...(Array.isArray(runs) ? runs : [])].slice(0, MAX_RECENT_RUNS);
}

export function recordRun(command, originalText, compressedText, options = {}) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const db = readAnalytics();
    const originalTokens = estimateTokens(originalText);
    const compressedTokens = estimateTokens(compressedText);
    const savedTokens = Math.max(0, originalTokens - compressedTokens);
    const key = command || 'unknown';
    const now = new Date().toISOString();

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
      recentRuns: [],
      startedAt: now,
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

    const run = {
      command: key,
      sessionId: id,
      sessionLabel: session.label,
      timestamp: now,
      exitCode: typeof options.exitCode === 'number' ? options.exitCode : null,
      durationMs: typeof options.durationMs === 'number' ? Number(options.durationMs.toFixed(1)) : null,
      originalTokens,
      compressedTokens,
      savedTokens,
      truncated: Boolean(options.truncated)
    };
    db.recentRuns = boundedRecent(db.recentRuns, run);
    session.recentRuns = boundedRecent(session.recentRuns, run);

    fs.writeFileSync(analyticsPath(), JSON.stringify(db, null, 2));
    return true;
  } catch {
    return false;
  }
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
      commands: session.commands || {},
      recentRuns: session.recentRuns || []
    },
    total: {
      runs: db.totalRuns,
      savedTokens: saved,
      originalTokens: db.totalOriginalTokens,
      compressedTokens: db.totalCompressedTokens,
      savedPercent: ratio(saved, db.totalOriginalTokens),
      commands: db.commands,
      recentRuns: db.recentRuns || []
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
