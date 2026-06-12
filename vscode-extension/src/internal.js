import fs from 'node:fs';
import path from 'node:path';

function readFiles(args) {
  const files = args.filter((arg) => !arg.startsWith('-'));
  if (!files.length) return { stdout: '', stderr: 'rtk-node read: missing file\n', status: 2 };
  const chunks = [];
  for (const file of files) {
    try {
      chunks.push(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      return { stdout: chunks.join('\n'), stderr: `${file}: ${error.message}\n`, status: 1 };
    }
  }
  return { stdout: chunks.join('\n'), stderr: '', status: 0 };
}

function walk(dir, pattern, out, depth = 0) {
  if (depth > 16) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (['.git', 'node_modules', 'target', 'dist', 'build', '.next'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, pattern, out, depth + 1);
    } else if (!pattern || entry.name.includes(pattern) || full.includes(pattern)) {
      out.push(full);
    }
  }
}

function findFiles(args) {
  const nonFlags = args.filter((arg) => !arg.startsWith('-'));
  const pattern = nonFlags[0]?.replace(/^\*|\*$/g, '') || '';
  const root = nonFlags[1] || '.';
  const out = [];
  walk(root, pattern, out);
  return { stdout: `${out.join('\n')}${out.length ? '\n' : ''}`, stderr: '', status: 0 };
}

export function runInternal(command, args) {
  if (command === 'read') return readFiles(args);
  if (command === 'find') return findFiles(args);
  return null;
}
