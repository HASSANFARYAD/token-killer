// GENERATED FILE - do not edit. Source: src/runner.js (npm run sync:engine)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isProbablyBinary } from './utils.js';

const POWERSHELL_COMMANDS = new Set([
  'cat',
  'cd',
  'copy',
  'cp',
  'del',
  'dir',
  'echo',
  'erase',
  'gc',
  'gci',
  'get-childitem',
  'get-content',
  'ls',
  'mkdir',
  'move',
  'mv',
  'pwd',
  'remove-item',
  'ren',
  'rename-item',
  'rm',
  'set-content',
  'type',
  'write-output'
]);

// These read stdin when given no file operand. Rewriting them to a cmdlet then
// produces "Get-Content: missing mandatory parameter -Path" instead of reading
// the pipe, so route them to the real command in that case.
const STDIN_READERS = new Set(['cat', 'type', 'gc', 'get-content']);

function hasFileOperand(args) {
  return args.some((arg) => !arg.startsWith('-'));
}

function shouldUsePowerShell(command, args = []) {
  if (process.platform !== 'win32') return false;
  const name = command.toLowerCase();
  if (!POWERSHELL_COMMANDS.has(name)) return false;
  if (STDIN_READERS.has(name) && !hasFileOperand(args)) return false;
  return true;
}

// Spawning with shell:true on Windows hands the arguments to cmd.exe, which
// then interprets the metacharacters inside them: an argument containing
// "&& echo x" ran echo, and one containing "> f.txt" created a file. Wrapping a
// command must never change what it does, so resolve the executable ourselves
// and spawn it directly. Only .cmd/.bat shims genuinely need a shell.
const executableCache = new Map();

// Resolve against PATH in process. Shelling out to where.exe cost ~174ms on
// every single wrapped command, which is a lot to add to something that runs
// constantly; walking PATH with stat calls is effectively free.
//
// This follows the same order Windows itself uses: PATH directories in order,
// and within each directory the extensions in PATHEXT order. That naturally
// picks npm.cmd over the extensionless Unix shim sitting beside it, which
// CreateProcess cannot execute.
function resolveWindowsExecutable(command) {
  if (command.includes('\\') || command.includes('/')) return command;
  if (executableCache.has(command)) return executableCache.get(command);

  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean);
  const directories = (process.env.PATH || process.env.Path || '')
    .split(';')
    .map((directory) => directory.trim())
    .filter(Boolean);
  const hasExtension = extensions.some((extension) => command.toLowerCase().endsWith(extension.toLowerCase()));

  let resolved = null;
  search: for (const directory of directories) {
    const candidates = hasExtension
      ? [command]
      : extensions.map((extension) => `${command}${extension}`);
    for (const candidate of candidates) {
      const full = path.join(directory, candidate);
      try {
        if (fs.statSync(full).isFile()) {
          resolved = full;
          break search;
        }
      } catch {
        // not here; keep looking
      }
    }
  }

  executableCache.set(command, resolved);
  return resolved;
}

// Inside double quotes cmd.exe treats &, |, < and > as literal text, so quoting
// every argument is what makes the .cmd path safe.
function quoteForCmd(value) {
  const escaped = String(value)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}

export function commandForTest(command, args = []) {
  if (!shouldUsePowerShell(command, args)) {
    if (process.platform !== 'win32') {
      return { command, args, options: { shell: false } };
    }

    const resolved = resolveWindowsExecutable(command);
    // Unresolvable: spawn without a shell so it fails with a clean ENOENT
    // rather than handing the string to cmd.exe.
    if (!resolved) return { command, args, options: { shell: false } };

    if (/\.(cmd|bat)$/i.test(resolved)) {
      const line = [resolved, ...args].map(quoteForCmd).join(' ');
      return {
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', `"${line}"`],
        options: { shell: false, windowsVerbatimArguments: true }
      };
    }

    return { command: resolved, args, options: { shell: false } };
  }

  // A failing cmdlet raises a non-terminating error and leaves powershell.exe
  // exiting 0, which reports a failed command to the caller as a success.
  // Reset $LASTEXITCODE, then translate both native exit codes and cmdlet
  // errors ($?) into a real process exit code.
  //
  // powershell.exe -Command appends any trailing arguments to the command
  // text, and they are what populates @args, so the script block invocation
  // has to be the last thing in the string: the exit handling goes inside it.
  const script = '& { '
    + '$global:LASTEXITCODE = 0; '
    + `${command} @args; `
    + '$ok = $?; '
    + 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; '
    + 'if (-not $ok) { exit 1 } '
    + '}';

  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args],
    options: {
      shell: false
    }
  };
}

// Output is captured to a file, so it is bounded by disk rather than memory.
// Still cap what is read back: the point is to shrink output, and no filter
// needs hundreds of megabytes to find the failure. Keep the head and the tail,
// because a command explains itself at the end.
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;

function readCapture(file) {
  let bytes = 0;
  try {
    bytes = fs.statSync(file).size;
  } catch {
    return { buffer: Buffer.alloc(0), truncated: false, bytes: 0 };
  }

  if (bytes <= MAX_CAPTURE_BYTES) {
    try {
      return { buffer: fs.readFileSync(file), truncated: false, bytes };
    } catch {
      return { buffer: Buffer.alloc(0), truncated: false, bytes };
    }
  }

  const half = Math.floor(MAX_CAPTURE_BYTES / 2);
  const head = Buffer.alloc(half);
  const tail = Buffer.alloc(half);
  const handle = fs.openSync(file, 'r');
  try {
    fs.readSync(handle, head, 0, half, 0);
    fs.readSync(handle, tail, 0, half, bytes - half);
  } finally {
    fs.closeSync(handle);
  }

  const marker = Buffer.from(`\n... (${bytes - MAX_CAPTURE_BYTES} bytes of output dropped)\n`, 'utf8');
  return { buffer: Buffer.concat([head, marker, tail]), truncated: true, bytes };
}

export function runCommand(command, args) {
  const started = process.hrtime.bigint();
  const resolved = commandForTest(command, args);
  const capture = path.join(
    os.tmpdir(),
    `sesshush-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.out`
  );

  let fd = null;
  let result;
  let combined = Buffer.alloc(0);
  let captureTruncated = false;
  let capturedBytes = 0;

  try {
    fd = fs.openSync(capture, 'w');
    result = spawnSync(resolved.command, resolved.args, {
      ...resolved.options,
      // Point stdout and stderr at one file rather than two pipes. Two pipes
      // lose the interleaving (all stdout then all stderr, so an error is
      // detached from the line it followed), and a pipe is capped by maxBuffer,
      // which made any command producing more than 64MB fail outright with
      // ENOBUFS even when the command itself had succeeded.
      //
      // stdin is inherited so `producer | sesshush consumer` works; reading it
      // here would block forever on a pipe that never closes.
      stdio: ['inherit', fd, fd],
      env: { ...process.env, SESSHUSH_ACTIVE: '1' }
    });
    fs.closeSync(fd);
    fd = null;

    const captured = readCapture(capture);
    combined = captured.buffer;
    captureTruncated = captured.truncated;
    capturedBytes = captured.bytes;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    try { fs.unlinkSync(capture); } catch { /* best effort */ }
  }

  const ended = process.hrtime.bigint();
  const durationMs = Number(ended - started) / 1_000_000;
  const binary = isProbablyBinary(combined);

  return {
    // stdout and stderr are no longer separable: they are one ordered stream.
    // Callers concatenate them anyway, and the order is what an agent needs.
    stdout: combined.toString('utf8'),
    stderr: '',
    rawBuffer: combined,
    status: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal,
    error: result.error,
    durationMs,
    binary,
    captureTruncated,
    capturedBytes
  };
}
