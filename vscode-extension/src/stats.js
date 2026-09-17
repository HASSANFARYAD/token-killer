// GENERATED FILE - do not edit. Source: src/stats.js (npm run sync:engine)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyticsPath, dataDir } from './config.js';

const ANALYTICS_VERSION = 3;
const MAX_RECENT_RUNS = 50;
const DEFAULT_CHARS_PER_TOKEN = 4;

const CHARS_PER_TOKEN_KEYS = ['SESSHUSH_CHARS_PER_TOKEN', 'RTK_CHARS_PER_TOKEN'];

function charsPerToken() {
  for (const key of CHARS_PER_TOKEN_KEYS) {
    const value = Number(process.env[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
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

const AGENT_SESSION_IDS = [
  'SESSHUSH_SESSION_ID',
  'NOISEGATE_SESSION_ID',
  'RTK_SESSION_ID',
  'OPENCODE_SESSION_ID',
  'CLAUDE_SESSION_ID',
  'CODEX_SESSION_ID',
  'TERM_SESSION_ID',
  'WINDOW_ID'
];

function sessionId() {
  for (const key of AGENT_SESSION_IDS) {
    if (process.env[key]) return process.env[key];
  }
  return `${os.userInfo().username}:${process.cwd()}`;
}

const AGENT_LABEL_KEYS = [
  'SESSHUSH_SESSION_LABEL',
  'NOISEGATE_SESSION_LABEL',
  'OPENCODE_SESSION_LABEL',
  'RTK_SESSION_LABEL',
  'CLAUDE_SESSION_LABEL',
  'CODEX_SESSION_LABEL'
];

function resolveAgentLabel() {
  for (const key of AGENT_LABEL_KEYS) {
    if (process.env[key]) return process.env[key];
  }
  return null;
}

function sessionLabel(id) {
  const label = resolveAgentLabel();
  if (label) return label;
  for (const key of AGENT_SESSION_IDS) {
    if (id === process.env[key]) return id;
  }
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

// Sessions are keyed by agent session id, or by user:cwd when there is none, so
// the map grows without limit over time. The whole file is parsed and rewritten
// on every single command, so unbounded growth is a steadily worsening tax on
// every command the user runs.
const MAX_SESSIONS = 200;

function pruneSessions(db) {
  const ids = Object.keys(db.sessions);
  if (ids.length <= MAX_SESSIONS) return;

  const keep = new Set(ids
    .map((id) => ({ id, at: db.sessions[id]?.updatedAt || db.sessions[id]?.startedAt || '' }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, MAX_SESSIONS)
    .map((entry) => entry.id));

  for (const id of ids) {
    if (!keep.has(id)) delete db.sessions[id];
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const LOCK_ATTEMPTS = 60;
const LOCK_WAIT_MS = 20;
const LOCK_STALE_MS = 10_000;

// recordRun is a read-modify-write of a single JSON file, and commands very
// often run in parallel. Without a lock the last writer wins and every other
// run is silently dropped: 12 concurrent commands recorded 1. That makes the
// savings figure — the entire point of the tool — an undercount.
function withLock(lockPath, fn) {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    let handle;
    try {
      handle = fs.openSync(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') return fn(); // cannot lock here; do not lose the run
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lockPath);
      } catch { /* another process cleaned it up */ }
      sleepSync(LOCK_WAIT_MS);
      continue;
    }

    try {
      return fn();
    } finally {
      try { fs.closeSync(handle); } catch { /* already closed */ }
      try { fs.unlinkSync(lockPath); } catch { /* already removed */ }
    }
  }
  return false; // contended for too long; drop this sample rather than stall the command
}

// Write via a temp file and rename so a crash or a concurrent reader never sees
// a half-written file.
function writeAtomic(target, contents) {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, contents);
  try {
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
}

export function recordRun(command, originalText, compressedText, options = {}) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    return withLock(`${analyticsPath()}.lock`, () => recordRunLocked(command, originalText, compressedText, options));
  } catch {
    return false;
  }
}

function recordRunLocked(command, originalText, compressedText, options = {}) {
  try {
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
    pruneSessions(db);

    writeAtomic(analyticsPath(), JSON.stringify(db, null, 2));
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
    commands: {},
    recentRuns: []
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
    `Sesshush token savings`,
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
    `Sesshush session token savings`,
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
