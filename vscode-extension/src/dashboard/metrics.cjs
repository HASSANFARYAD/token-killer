const STATE_KEY = 'savytox.metrics.v1';
const SESSION_KEY = 'savytox.sessionId';
const DEFAULT_CHARS_PER_TOKEN = 4;
const MAX_RECENT_RUNS = 50;

function emptyTotals() {
  return {
    runs: 0,
    rawChars: 0,
    optimizedChars: 0,
    rawTokens: 0,
    optimizedTokens: 0,
    savedTokens: 0,
    commands: {},
    recentRuns: []
  };
}

function estimateTokensFromChars(chars) {
  if (!chars) return 0;
  return Math.max(1, Math.ceil(chars / DEFAULT_CHARS_PER_TOKEN));
}

function savedPercent(total) {
  return total.rawTokens ? Number(((total.savedTokens / total.rawTokens) * 100).toFixed(1)) : 0;
}

function normalizeStore(store) {
  return {
    total: { ...emptyTotals(), ...(store?.total || {}) },
    sessions: store?.sessions && typeof store.sessions === 'object' ? store.sessions : {}
  };
}

function workspaceSessionId(workspacePath) {
  return `workspace:${workspacePath || 'no-workspace'}`;
}

function getSessionId(context, workspacePath) {
  const existing = context.workspaceState.get(SESSION_KEY);
  if (existing) return existing;
  return workspaceSessionId(workspacePath);
}

async function setSessionId(context, id) {
  await context.workspaceState.update(SESSION_KEY, id);
}

function addToTotal(total, run) {
  total.runs += 1;
  total.rawChars += run.rawChars;
  total.optimizedChars += run.optimizedChars;
  total.rawTokens += run.rawTokens;
  total.optimizedTokens += run.optimizedTokens;
  total.savedTokens += run.savedTokens;
  total.commands[run.command] ||= {
    runs: 0,
    originalTokens: 0,
    compressedTokens: 0,
    rawTokens: 0,
    optimizedTokens: 0,
    savedTokens: 0
  };
  const command = total.commands[run.command];
  command.runs += 1;
  command.originalTokens += run.rawTokens;
  command.compressedTokens += run.optimizedTokens;
  command.rawTokens += run.rawTokens;
  command.optimizedTokens += run.optimizedTokens;
  command.savedTokens += run.savedTokens;
  total.recentRuns = [run, ...(total.recentRuns || [])].slice(0, MAX_RECENT_RUNS);
}

async function recordOptimization(context, workspacePath, command, rawOutput, optimizedOutput, options = {}) {
  const store = normalizeStore(context.workspaceState.get(STATE_KEY));
  const sessionId = getSessionId(context, workspacePath);
  store.sessions[sessionId] ||= {
    ...emptyTotals(),
    id: sessionId,
    label: options.sessionLabel || `Workspace ${workspacePath ? workspacePath.split(/[\\/]/).pop() : ''}`.trim(),
    startedAt: new Date().toISOString(),
    updatedAt: null
  };

  const rawChars = String(rawOutput || '').length;
  const optimizedChars = String(optimizedOutput || '').length;
  const rawTokens = estimateTokensFromChars(rawChars);
  const optimizedTokens = estimateTokensFromChars(optimizedChars);
  const run = {
    command: command || 'unknown',
    timestamp: new Date().toISOString(),
    exitCode: typeof options.exitCode === 'number' ? options.exitCode : null,
    durationMs: typeof options.durationMs === 'number' ? Number(options.durationMs.toFixed(1)) : null,
    rawChars,
    optimizedChars,
    originalTokens: rawTokens,
    compressedTokens: optimizedTokens,
    rawTokens,
    optimizedTokens,
    savedTokens: Math.max(0, rawTokens - optimizedTokens),
    truncated: Boolean(options.truncated)
  };

  addToTotal(store.total, run);
  addToTotal(store.sessions[sessionId], run);
  store.sessions[sessionId].updatedAt = run.timestamp;

  await context.workspaceState.update(STATE_KEY, store);
  await context.workspaceState.update('savytox.lastTerminalSummary', options.summary || optimizedOutput || '');
  return run;
}

function toSnapshotPart(total, fallback = {}) {
  return {
    ...fallback,
    runs: total.runs || 0,
    rawChars: total.rawChars || 0,
    optimizedChars: total.optimizedChars || 0,
    rawTokens: total.rawTokens || 0,
    optimizedTokens: total.optimizedTokens || 0,
    originalTokens: total.rawTokens || 0,
    compressedTokens: total.optimizedTokens || 0,
    savedTokens: total.savedTokens || 0,
    savedPercent: savedPercent(total),
    commands: total.commands || {},
    recentRuns: total.recentRuns || []
  };
}

function snapshot(context, workspacePath) {
  const store = normalizeStore(context.workspaceState.get(STATE_KEY));
  const sessionId = getSessionId(context, workspacePath);
  const session = store.sessions[sessionId] || {
    ...emptyTotals(),
    id: sessionId,
    label: `Workspace ${workspacePath ? workspacePath.split(/[\\/]/).pop() : ''}`.trim()
  };
  return {
    session: toSnapshotPart(session, {
      id: sessionId,
      label: session.label || sessionId,
      startedAt: session.startedAt || null,
      updatedAt: session.updatedAt || null
    }),
    total: toSnapshotPart(store.total)
  };
}

module.exports = {
  estimateTokensFromChars,
  getSessionId,
  recordOptimization,
  setSessionId,
  snapshot,
  workspaceSessionId
};
