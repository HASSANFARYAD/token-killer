// CSI sequences (colours, cursor moves).
const CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
// OSC sequences, terminated by BEL or ST. Modern CLIs use OSC 8 for hyperlinks
// and OSC 0/2 to set the window title; the payload includes full URLs, so
// leaving them in both garbles the text and wastes tokens on invisible markup.
const OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g;
// Two-character escapes such as ESC = / ESC > used by some TUIs.
const SIMPLE_ESC_RE = /\x1b[@-Z\\-_]/g;

export function stripAnsi(text) {
  return text
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(SIMPLE_ESC_RE, '');
}

export function maybeStripAnsi(text, keepColors) {
  return keepColors ? text : stripAnsi(text);
}
