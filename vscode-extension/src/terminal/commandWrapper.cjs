const { spawn } = require('child_process');
const { parseCommandLine } = require('./commandDetector.cjs');
const { recordOptimization } = require('../dashboard/metrics.cjs');

function filterConfig(settings = {}) {
  const mode = settings.optimizationMode || 'balanced';
  return {
    maxLines: mode === 'aggressive' ? 80 : mode === 'safe' ? 300 : 180,
    maxChars: settings.maxOutputChars || (mode === 'aggressive' ? 8000 : mode === 'safe' ? 32000 : 18000),
    matchesPerFile: mode === 'aggressive' ? 3 : 8,
    diffContextLines: mode === 'aggressive' ? 0 : mode === 'safe' ? 3 : 1,
    ultraCompact: mode === 'aggressive'
  };
}

async function optimizeCommandOutput(input, rawOutput, settings = {}) {
  const { command, args } = parseCommandLine(input);
  const { filterOutput } = await import('../filters.js');
  const result = filterOutput(command, args, rawOutput, filterConfig(settings));
  return { ...result, command: command || input.trim() || 'unknown' };
}

function runShellCommand(input, cwd) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(input, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', (error) => resolve({
      output: error.message,
      exitCode: 1,
      durationMs: Date.now() - started
    }));
    child.on('close', (exitCode) => resolve({
      output: Buffer.concat(chunks).toString('utf8'),
      exitCode: typeof exitCode === 'number' ? exitCode : 1,
      durationMs: Date.now() - started
    }));
  });
}

async function executeAndRecord(context, input, cwd, settings = {}) {
  const run = await runShellCommand(input, cwd);
  const optimized = await optimizeCommandOutput(input, run.output, settings);
  await recordOptimization(context, cwd, optimized.command, run.output, optimized.text, {
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    truncated: optimized.truncated,
    summary: optimized.text
  });
  return { ...run, optimized };
}

module.exports = {
  executeAndRecord,
  filterConfig,
  optimizeCommandOutput
};
