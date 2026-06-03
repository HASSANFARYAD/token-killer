import { genericTruncate, normalizeLine, splitLines, dedupeConsecutive } from './utils.js';

const NOISE_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.next', '.cache', '__pycache__']);

function humanSize(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}

function gitStatus(output, config) {
  const lines = splitLines(output).filter(Boolean);
  let branch = null;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  const samples = { staged: [], unstaged: [], untracked: [] };

  for (const raw of lines) {
    const line = normalizeLine(raw);
    if (line.startsWith('On branch ')) branch = line.slice('On branch '.length);
    if (line.startsWith('## ')) branch = line.slice(3).split('...')[0];
    if (/^(new file|modified|deleted|renamed|copied):/.test(line)) {
      staged += 1;
      if (samples.staged.length < 8) samples.staged.push(line);
    }
    if (/^(modified|deleted|both modified):/.test(line)) {
      unstaged += 1;
      if (samples.unstaged.length < 8) samples.unstaged.push(line);
    }
    if (line.startsWith('?? ')) {
      untracked += 1;
      if (samples.untracked.length < 8) samples.untracked.push(line.slice(3));
    }
    if (line.startsWith('Untracked files:')) untracked ||= 0;
  }

  const porcelain = lines.some((line) => /^[ MARC?DU][ MARC?DU]\s+/.test(line));
  if (porcelain) {
    staged = 0;
    unstaged = 0;
    untracked = 0;
    for (const raw of lines) {
      const x = raw[0];
      const y = raw[1];
      const file = raw.slice(3);
      if (raw.startsWith('## ')) continue;
      if (raw.startsWith('?? ')) {
        untracked += 1;
        if (samples.untracked.length < 8) samples.untracked.push(file);
        continue;
      }
      if (x !== ' ' && x !== '?') {
        staged += 1;
        if (samples.staged.length < 8) samples.staged.push(file);
      }
      if (y !== ' ' && y !== '?') {
        unstaged += 1;
        if (samples.unstaged.length < 8) samples.unstaged.push(file);
      }
    }
  }

  const out = [
    `git status${branch ? ` on ${branch}` : ''}`,
    `staged: ${staged}`,
    `unstaged: ${unstaged}`,
    `untracked: ${untracked}`
  ];
  for (const [label, values] of Object.entries(samples)) {
    if (values.length) out.push(`${label} sample: ${values.join(', ')}`);
  }

  return { text: out.join('\n'), truncated: lines.length > out.length };
}

function gitLog(output, config) {
  const lines = splitLines(output).filter(Boolean);
  const commits = [];
  for (const raw of lines) {
    const line = normalizeLine(raw);
    const hash = line.match(/\b[0-9a-f]{7,40}\b/i)?.[0];
    if (!hash) continue;
    const msg = line.replace(/^commit\s+/i, '').replace(hash, '').trim();
    commits.push(`${hash.slice(0, 8)} ${msg}`.trim());
  }
  const selected = commits.length ? commits : lines;
  const result = genericTruncate(selected.join('\n'), { ...config, maxLines: Math.min(config.maxLines, 40) });
  return { ...result, truncated: result.truncated || selected.length < lines.length };
}

function gitOk(output, config, action) {
  const lines = splitLines(output).filter(Boolean);
  const plain = lines.map(normalizeLine);
  const commit = plain.join('\n').match(/\[[^\]]+\s+([0-9a-f]{7,})\]/i)?.[1];
  const branch = plain.join('\n').match(/(?:to|branch)\s+['"]?([^'"\s]+)['"]?/i)?.[1];
  const stats = plain.find((line) => /\d+\s+files?\s+changed/.test(line));
  const msg = ['ok', action, commit?.slice(0, 8), branch, stats].filter(Boolean).join(' ');
  return { text: msg, truncated: lines.length > 1 };
}

function gitDiff(output, config) {
  const lines = splitLines(output);
  const keep = [];
  let contextBudget = 0;
  let omitted = 0;
  const maxContext = config.ultraCompact ? 0 : config.diffContextLines;

  for (const line of lines) {
    const plain = normalizeLine(line);
    const important =
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('@@') ||
      line.startsWith('+') ||
      line.startsWith('-') ||
      plain.includes('Binary files');

    if (important) {
      if (omitted) {
        keep.push(`... (${omitted} unchanged context lines omitted)`);
        omitted = 0;
      }
      keep.push(line);
      contextBudget = maxContext;
      continue;
    }

    if (contextBudget > 0 && plain) {
      keep.push(line);
      contextBudget -= 1;
    } else if (plain) {
      omitted += 1;
    }
  }

  if (omitted) keep.push(`... (${omitted} unchanged context lines omitted)`);
  const deduped = dedupeConsecutive(keep);
  const result = genericTruncate(deduped.join('\n'), config);
  return { ...result, truncated: result.truncated || deduped.length < lines.length };
}

function compactLs(output, config) {
  const lines = splitLines(output);
  const dirs = [];
  const files = [];
  const exts = new Map();
  const dateRe = /\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:\d{4}|\d{2}:\d{2})\s+/;
  const winDirRe = /^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+(AM|PM)\s+(?:(<DIR>)|([\d,]+))\s+(.+)$/i;

  for (const raw of lines) {
    const line = normalizeLine(raw);
    if (!line || line.startsWith('total ')) continue;
    const win = line.match(winDirRe);
    if (win) {
      const isDir = Boolean(win[2]);
      const size = win[3] ? Number(win[3].replace(/,/g, '')) : 0;
      const name = win[4];
      if (!name || name === '.' || name === '..' || NOISE_DIRS.has(name)) continue;
      if (isDir) dirs.push(`${name}/`);
      else {
        files.push(`${name} ${humanSize(size)}`);
        const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : 'no ext';
        exts.set(ext, (exts.get(ext) || 0) + 1);
      }
      continue;
    }
    const date = line.match(dateRe);
    if (!date || date.index === undefined) continue;
    const before = line.slice(0, date.index).trim().split(/\s+/);
    const name = line.slice(date.index + date[0].length);
    const type = before[0]?.[0];
    let size = 0;
    for (let i = before.length - 1; i >= 0; i -= 1) {
      const parsed = Number(before[i]);
      if (Number.isFinite(parsed)) {
        size = parsed;
        break;
      }
    }
    if (!name || name === '.' || name === '..' || NOISE_DIRS.has(name)) continue;
    if (type === 'd') dirs.push(`${name}/`);
    else {
      files.push(`${name} ${humanSize(size)}`);
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : 'no ext';
      exts.set(ext, (exts.get(ext) || 0) + 1);
    }
  }

  if (!dirs.length && !files.length) return genericTruncate(output, config);
  const extSummary = [...exts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, count]) => `${count} ${ext}`)
    .join(', ');
  const out = [...dirs, ...files, '', `Summary: ${files.length} files, ${dirs.length} dirs${extSummary ? ` (${extSummary})` : ''}`];
  return { text: out.join('\n'), truncated: out.length < lines.length };
}

function findOutput(output, config) {
  const lines = splitLines(output).filter(Boolean);
  const byDir = new Map();
  for (const file of lines) {
    const dir = file.includes('/') || file.includes('\\') ? file.replace(/[\\/][^\\/]+$/, '') : '.';
    byDir.set(dir, (byDir.get(dir) || 0) + 1);
  }
  const grouped = [...byDir.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dir, count]) => `${dir}/ ${count} files`);
  const sample = lines.slice(0, config.ultraCompact ? 20 : 60);
  const candidate = [...grouped, '', ...sample].join('\n');
  const result = genericTruncate(candidate.length < output.length ? candidate : sample.join('\n'), config);
  return { ...result, truncated: result.truncated || sample.length < lines.length };
}

function readOutput(output, config) {
  const lines = splitLines(output);
  const filtered = [];
  let blank = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      if (!blank) filtered.push('');
      blank = true;
      continue;
    }
    blank = false;
    if (/^(\/\/|#|--)\s/.test(trimmed)) continue;
    if (/^\/\*|\*\/$/.test(trimmed)) continue;
    filtered.push(line);
  }
  return genericTruncate(filtered.join('\n'), config);
}

function searchMatches(output, config) {
  const lines = splitLines(output).filter(Boolean);
  const files = new Map();
  const passthrough = [];
  const cap = config.ultraCompact ? Math.min(config.matchesPerFile, 3) : config.matchesPerFile;

  for (const raw of lines) {
    const line = normalizeLine(raw);
    const match = line.match(/^(.+?)(?::|-)(\d+)(?::|-)(.*)$/);
    if (!match) {
      passthrough.push(raw);
      continue;
    }
    const [, file, number, text] = match;
    files.set(file, files.get(file) || []);
    files.get(file).push(`${number}: ${text.trim()}`);
  }

  const out = [];
  for (const [file, matches] of files) {
    out.push(`${file} (${matches.length} matches)`);
    for (const match of matches.slice(0, cap)) out.push(`  ${match}`);
    if (matches.length > cap) out.push(`  ... (${matches.length - cap} more matches)`);
  }
  if (passthrough.length) out.push(...passthrough.slice(0, cap));
  if (!out.length && lines.length) out.push(...lines.slice(0, cap));

  return { text: out.join('\n'), truncated: out.length < lines.length };
}

function testOutput(output, config) {
  const lines = splitLines(output);
  const out = [];
  let capture = false;
  let skippedPassing = 0;
  const important = /(FAIL|FAILED|ERROR|Traceback|AssertionError|E\s{3,}|npm ERR!|ERR!|failed|error)/i;
  const summary = /(=+ .* in .* =+|tests? failed|passed|failed|errors?|short test summary|Test Suites:|Tests:|Snapshots:|Time:)/i;

  for (const line of lines) {
    const plain = normalizeLine(line);
    if (important.test(plain)) {
      capture = true;
      out.push(line);
      continue;
    }
    if (summary.test(plain)) {
      out.push(line);
      capture = false;
      continue;
    }
    if (capture && plain) {
      out.push(line);
      if (/^_{5,}|^-{5,}|^={5,}/.test(plain)) capture = false;
      continue;
    }
    if (plain) skippedPassing += 1;
  }

  if (skippedPassing) out.push(`... (${skippedPassing} non-failing lines omitted)`);
  return genericTruncate(out.join('\n'), config);
}

export function classify(command, args = []) {
  const base = command?.split(/[\\/]/).pop()?.toLowerCase();
  if (base === 'git' && args[0] === 'status') return gitStatus;
  if (base === 'git' && args[0] === 'diff') return gitDiff;
  if (base === 'git' && args[0] === 'log') return gitLog;
  if (base === 'git' && ['add', 'commit', 'push', 'pull', 'fetch'].includes(args[0])) {
    return (output, config) => gitOk(output, config, args[0]);
  }
  if (base === 'ls' || base === 'dir') return compactLs;
  if (base === 'find') return findOutput;
  if (base === 'read' || base === 'cat') return readOutput;
  if (base === 'rg' || base === 'grep') return searchMatches;
  if (base === 'pytest') return testOutput;
  if (base === 'npm' && args[0] === 'test') return testOutput;
  return null;
}

export function filterOutput(command, args, output, config) {
  const filter = classify(command, args);
  if (!filter) return genericTruncate(output, config);
  return filter(output, config);
}
