import { spawn, spawnSync } from 'node:child_process';
import { currentSessionId, formatSessionGain } from './stats.js';

function makeSessionId(command) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `rtk-agent-${command || 'shell'}-${suffix}`;
}

export function runAgent(command, args, options = {}) {
  if (!command) {
    console.error('rtk-node agent: missing command');
    console.error('Usage: rtk-node agent <codex|claude|command> [args...]');
    return 2;
  }

  const sessionId = process.env.RTK_SESSION_ID || makeSessionId(command);
  const sessionLabel = process.env.RTK_SESSION_LABEL || `RTK agent: ${[command, ...args].join(' ')}`;
  const env = {
    ...process.env,
    RTK_SESSION_ID: sessionId,
    RTK_SESSION_LABEL: sessionLabel,
    RTK_AGENT_ACTIVE: '1'
  };

  console.error(`[rtk-node] session: ${sessionLabel}`);
  console.error(`[rtk-node] id: ${sessionId}`);

  const target = resolveCommand(command, args);
  const child = spawn(target.command, target.args, {
    stdio: 'inherit',
    shell: false,
    env
  });

  child.on('error', (error) => {
    console.error(`[rtk-node] failed to start ${command}: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[rtk-node] agent exited with signal ${signal}`);
    }
    if (options.summary !== false) {
      console.error('');
      console.error(formatSessionGain(sessionId));
    }
    process.exit(typeof code === 'number' ? code : 1);
  });

  return null;
}

function resolveCommand(command, args) {
  if (process.platform !== 'win32') return { command, args };

  const resolved = resolveWindowsCommand(command);
  if (!resolved || !resolved.toLowerCase().endsWith('.cmd')) {
    return { command: resolved || command, args };
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/c', 'call', resolved, ...args]
  };
}

function resolveWindowsCommand(command) {
  if (command.includes('\\') || command.includes('/')) return command;
  const result = spawnSync('where', [command], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) return command;
  const matches = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return matches.find((line) => line.toLowerCase().endsWith('.cmd'))
    || matches.find((line) => line.toLowerCase().endsWith('.exe'))
    || matches[0]
    || command;
}


export function agentSessionEnv(command, args = []) {
  const sessionId = process.env.RTK_SESSION_ID || makeSessionId(command);
  const sessionLabel = process.env.RTK_SESSION_LABEL || `RTK agent: ${[command, ...args].join(' ')}`;
  return {
    RTK_SESSION_ID: sessionId,
    RTK_SESSION_LABEL: sessionLabel,
    RTK_AGENT_ACTIVE: '1',
    RTK_SESSION_CURRENT: currentSessionId()
  };
}
