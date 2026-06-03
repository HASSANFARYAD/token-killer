const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

export function maybeStripAnsi(text, keepColors) {
  return keepColors ? text : stripAnsi(text);
}
