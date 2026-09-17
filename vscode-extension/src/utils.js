// GENERATED FILE - do not edit. Source: src/utils.js (npm run sync:engine)
import { stripAnsi } from './ansi.js';

export function splitLines(text) {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export function byteLength(text) {
  return Buffer.byteLength(text || '', 'utf8');
}

export function lineCount(text) {
  if (!text) return 0;
  return splitLines(text).filter((line) => line.length > 0).length;
}

export function isProbablyBinary(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let nul = 0;
  for (const byte of sample) {
    if (byte === 0) nul += 1;
  }
  return nul > 0;
}

export function dedupeConsecutive(lines) {
  const out = [];
  let previous = null;
  let count = 0;
  const flush = () => {
    if (previous === null) return;
    out.push(previous);
    if (count > 1) out.push(`... (repeated ${count - 1}x)`);
  };

  for (const line of lines) {
    if (line === previous) {
      count += 1;
    } else {
      flush();
      previous = line;
      count = 1;
    }
  }
  flush();
  return out;
}

// Cutting a string by UTF-16 code units can land between the two halves of a
// surrogate pair, leaving a lone surrogate that encodes to U+FFFD and shows up
// as mojibake. Nudge the cut off the boundary.
function cutAfter(text, index) {
  if (index <= 0 || index >= text.length) return index;
  const code = text.charCodeAt(index);
  return code >= 0xDC00 && code <= 0xDFFF ? index - 1 : index;
}

function headSlice(text, length) {
  return text.slice(0, cutAfter(text, length));
}

function tailSlice(text, length) {
  return text.slice(cutAfter(text, Math.max(0, text.length - length)));
}

export function genericTruncate(text, config) {
  const lines = dedupeConsecutive(splitLines(text));
  const maxLines = config.ultraCompact ? Math.min(config.maxLines, 80) : config.maxLines;
  const maxChars = config.ultraCompact ? Math.min(config.maxChars, 8000) : config.maxChars;
  // A failed command reports why it failed at the end of its output, so keep
  // the tail rather than the head when there is not room for both.
  const headShare = config.preserveTail ? 0.25 : 0.65;
  let truncated = false;
  let selected = lines;

  if (selected.length > maxLines) {
    const head = Math.floor(maxLines * headShare);
    selected = [
      ...selected.slice(0, head),
      `... (${selected.length - maxLines} lines truncated)`,
      ...selected.slice(-(maxLines - head))
    ];
    truncated = true;
  }

  let output = selected.join('\n');
  if (output.length > maxChars) {
    const dropped = output.length - maxChars;
    if (config.preserveTail) {
      const head = Math.floor(maxChars * headShare);
      output = `${headSlice(output, head)}\n... (${dropped} chars truncated)\n${tailSlice(output, maxChars - head)}`;
    } else {
      output = `${headSlice(output, maxChars)}\n... (${dropped} chars truncated)`;
    }
    truncated = true;
  }

  return { text: output, truncated };
}

export function normalizeLine(line) {
  return stripAnsi(line).trim();
}
